import { LitElement, html } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import '/kempo-ui/components/Toggle.js';
import '/kempo-ui/components/Combobox.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/ColorPicker.js';
import '/kempo-ui/components/Rating.js';
import { getItems, getFields, getSuggestions, getTags } from '/inventory/sdk.js';
import { prepareImages } from '/inventory/components/ImageCropDialog.js';

/*
  Everything needed to render and read the form inputs for an item's custom fields, shared by the
  extension's own admin page and by any site built on it. A site is expected to compose these
  rather than copy them:

    import { fieldTemplate, readField } from '/inventory/components/ItemFields.js';

    html`${fields.map(f => fieldTemplate(f, item.fields[f.key], { linked, media, ownId: item.id }))}`
    const value = readField($dialog, field);        // throws an Error with a user-facing message

  `ctx` is { linked, media, ownId }, the maps the API returns alongside items.
*/

export const inputId = field => `item-field-${field.key}`;

/*
  A category's key: the name in lower case with its spacing tidied, so "Paint" and " paint " match.
  A field's `category` holds this, or '' when it belongs to every item.
*/
export const categoryKeyOf = name => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/*
  The fields an item in the given category shows: the default ones plus that category's own. `fields`
  is the full list from getFields(); an uncategorised item gets only the default fields.
*/
export const applicableFields = (fields, category) => {
  const key = categoryKeyOf(category);
  return fields.filter(f => !f.category || f.category === key);
};

const MEDIA_ACCEPT = 'image/*,video/*,audio/*,.glb,.gltf,.obj,.fbx,.zip';

/*
  Which library new uploads go to ('media', 'files' or null), decided by the server from what is
  installed: kempo-media when it is there, otherwise kempo-files. Asked once per page.
*/
let infoPromise = null;
const fieldInfo = () => infoPromise ??= getFields().then(([error, data]) => {
  if(error) infoPromise = null;
  return error ? null : data;
});
const uploadProvider = () => fieldInfo().then(data => data?.capabilities.upload ?? null);
/* Whether new uploads are made public (the public_photos setting). */
const uploadsArePublic = () => fieldInfo().then(data => data?.capabilities.publicFiles !== false);

/*
  The aspect ratios images are shown at, from the category_image_ratio and item_image_ratio settings:
  { category, item } as CSS values such as "4 / 3". Asked once per page.
*/
export const imageRatios = () => fieldInfo().then(data => data?.imageRatios ?? {});

/*
  Each uploader resolves to [error, { id, asset }]: the value to store, and a description of the
  file in the shape the inventory API reports it. Their libraries are only ever imported here, when
  an upload actually happens, because both are optional.
*/
const uploadToMedia = async file => {
  const { uploadMedia } = await import('/kempo-media/sdk.js');
  const [error, data] = await uploadMedia(file, { public: await uploadsArePublic() });
  if(error) return [error, null];
  const asset = data.asset;
  return [null, { id: asset.id, asset: {
    id: asset.id,
    kind: asset.kind,
    name: asset.originalName,
    alt: asset.altText,
    path: `/${asset.path}`,
    thumbnail: asset.thumbnailPath ? `/${asset.thumbnailPath}` : null,
  } }];
};

/* kempo-files keeps real filenames and refuses a duplicate, and photos are often all "IMG_0001.jpg". */
const withSuffix = file => {
  const dot = file.name.lastIndexOf('.');
  const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
  const extension = dot > 0 ? file.name.slice(dot) : '';
  return new File([file], `${stem}-${Math.random().toString(36).slice(2, 7)}${extension}`, { type: file.type });
};

/*
  Thumbnails are made after the upload, so a new file has none yet: the preview falls back to the
  image itself, and later loads pick the thumbnail up.
*/
const uploadToFiles = async file => {
  const { uploadFile, urlForFile } = await import('/kempo-files/sdk.js');
  const options = { public: await uploadsArePublic() };
  let [error, data] = await uploadFile(file, options);
  if(error?.code === 409) [error, data] = await uploadFile(withSuffix(file), options);
  if(error) return [error, null];
  const stored = data.file;
  const id = `files:${stored.id}`;
  return [null, { id, asset: { id, kind: stored.kind, name: stored.name, alt: stored.altText ?? '', path: urlForFile(stored), thumbnail: null } }];
};

/*
  A gallery of files with an upload button, bound to an array of kempo-media asset ids.
  `value` is that array; it fires `change` whenever it changes.
*/
export class InventoryMediaField extends LitElement {
  static properties = {
    value: { type: Array },
    assets: { type: Object },
    uploading: { type: Number, state: true },
    max: { type: Number },
    ratioFor: { type: String, attribute: 'ratio-for' }, // 'item' (default) or 'category': whose aspect ratio the previews use
    ratio: { type: String, state: true },
    cropRatio: { type: String, attribute: 'crop-ratio' },   // force photos to this shape as they are added, e.g. '1 / 1'
    cropMax: { type: Number, attribute: 'crop-max' },        // and keep them within this many pixels on a side
  };

  constructor(){
    super();
    this.value = [];
    this.assets = {};
    this.uploading = 0;
    this.max = 20;   // how many files it holds; adding more replaces the oldest
  }

  createRenderRoot(){ return this; }

  changed(){
    this.dispatchEvent(new CustomEvent('change', { bubbles: true }));
  }

  /* The first photo is the primary one: the picture shown on cards and lists. */
  makePrimary = id => {
    this.value = [id, ...this.value.filter(v => v !== id)];
    this.changed();
  };

  remove = id => {
    this.value = this.value.filter(v => v !== id);
    this.changed();
  };

  addFiles = async files => {
    const provider = await uploadProvider();
    if(!provider){
      Toast.error('Uploading needs the kempo-media or kempo-files extension');
      return;
    }
    /*
      A category's picture is always cropped to the category image shape (a setting). A photo field
      crops only when the field says so: its own shape and maximum size.
    */
    const forced = this.ratioFor === 'category' ? ((await imageRatios()).category ?? '') : (this.cropRatio ?? '');
    const prepared = await prepareImages(files, { ratio: forced, max: this.cropMax || 0 });
    for(const file of prepared){
      this.uploading++;
      const [error, uploaded] = await (provider === 'files' ? uploadToFiles : uploadToMedia)(file);
      this.uploading--;
      if(error){
        Toast.error(`${file.name}: ${error.msg}`);
        continue;
      }
      this.assets = { ...this.assets, [uploaded.id]: uploaded.asset };
      this.value = [...this.value, uploaded.id].slice(-this.max);
      this.changed();
    }
  };

  async connectedCallback(){
    super.connectedCallback();
    const ratios = await imageRatios();
    this.ratio = ratios[this.ratioFor || 'item'] ?? '4 / 3';
  }

  render(){
    return html`
      <div class="d-f" style="flex-wrap: wrap; gap: var(--spacer_h); align-items: center;">
        ${this.value.map((id, index) => {
          const asset = this.assets[id];
          const ordered = this.max > 1 && this.value.length > 1;
          return html`
            <div class="media-tile" style="position: relative; width: 5rem; aspect-ratio: ${this.ratio ?? '4 / 3'}; border: 1px solid var(--c_border); border-radius: var(--radius); overflow: hidden; display: flex; align-items: center; justify-content: center;" title=${asset?.name ?? 'Missing file'}>
              ${asset?.thumbnail || asset?.kind === 'image'
                ? html`<img src=${asset.thumbnail ?? asset.path} alt=${asset.alt || asset.name} style="width: 100%; height: 100%; object-fit: cover;">`
                : html`<small style="padding: 2px; text-align: center; word-break: break-all;">${asset?.name ?? 'Missing'}</small>`}
              <button type="button" class="no-btn" style="position: absolute; top: 0; right: 0; background: var(--c_bg); line-height: 1; padding: 2px;" aria-label="Remove" @click=${() => this.remove(id)}><k-icon name="close"></k-icon></button>
              ${ordered ? (index === 0
                ? html`<span class="media-primary" style="position: absolute; left: 0; bottom: 0; right: 0; background: var(--c_bg); font-size: 0.7rem; text-align: center; line-height: 1.4;"><k-icon name="star_filled"></k-icon> Primary</span>`
                : html`<button type="button" class="no-btn media-make-primary" style="position: absolute; left: 0; bottom: 0; right: 0; background: var(--c_bg); font-size: 0.7rem; line-height: 1.4; cursor: pointer;" aria-label="Make this the primary photo" title="Make this the primary photo" @click=${() => this.makePrimary(id)}><k-icon name="star"></k-icon> Make primary</button>`) : ''}
            </div>`;
        })}
        <label class="btn" style="margin: 0; cursor: pointer;">
          <k-icon name="add"></k-icon> ${this.uploading ? `Uploading ${this.uploading}…` : 'Add files'}
          <input type="file" multiple accept=${MEDIA_ACCEPT} style="display: none;"
            @change=${e => { const files = [...e.target.files]; e.target.value = ''; this.addFiles(files); }}>
        </label>
      </div>`;
  }
}

if(!customElements.get('inventory-media-field')) customElements.define('inventory-media-field', InventoryMediaField);

/*
  A colour field's control. Colour is optional, so with nothing chosen it offers a button, because a
  colour picker on its own always has *some* colour. `value` is a hex string, or '' for none.
*/
/*
  Tags are always lower case. Put these two on a <k-tags>: what is typed is converted as it goes in (the
  caret stays where it was), and the chips are made lower case, including ones pasted in. Leaving the box
  does not add what is in it as a tag (see below).

    <k-tags @input=${lowerTagInput} @change=${lowerTagChips} ...>
*/
export const lowerTagInput = event => {
  const input = event.composedPath().find(element => element.id === 'tagsInput');
  if(!input) return;
  /*
    k-tags turns whatever is left in its box into a tag when the box loses focus. Tapping Save with a tag
    half typed would then add a chip, the form would grow a little, and the Save button would move out from
    under the finger. So leaving the box adds nothing; Enter, Tab or a comma add the tag, and readTags()
    picks up what is still in the box when the form is saved.
  */
  if(!input.dataset.keepOnBlur){
    input.dataset.keepOnBlur = 'true';
    input.addEventListener('change', changeEvent => changeEvent.stopImmediatePropagation(), true);
  }
  if(input.value === input.value.toLowerCase()) return;
  const { selectionStart, selectionEnd } = input;
  input.value = input.value.toLowerCase();
  input.setSelectionRange(selectionStart, selectionEnd);
};

export const lowerTagChips = event => {
  const $tags = event.currentTarget;
  const lower = $tags.value.toLowerCase();
  if($tags.value !== lower) $tags.value = lower;
};

/*
  Any CSS colour (the picker can show rgb, hsl, lab...) as the hex the field stores: "#rrggbb", or
  "#rrggbbaa" when it is see-through. The browser does the conversion.
*/
const toHex = css => {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = '#000000';
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  const hex = n => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}${a < 255 ? hex(a) : ''}`;
};

/*
  Tags use Kempo UI's <k-tags>: the tags as chips (click one to remove it), Enter, Tab or a comma adds
  what is typed, and tags already used on other items and categories are offered as you type.

    html`<k-tags id="tags" .value=${tagsValue(item.tags)} .getSuggestions=${suggestTags}></k-tags>`
    const tags = readTags($dialog.querySelector('#tags'));      // a list, including text typed but not yet added
*/
import '/kempo-ui/components/Tags.js';

/* k-tags holds its value as comma-separated text. */
export const tagsValue = tags => (tags ?? []).join(',');

/* The tags already in use that contain what has been typed, for k-tags' ghost-text completion. */
export const suggestTags = async query => {
  const [error, data] = await getTags({ q: query });
  return error ? [] : data.tags.map(entry => entry.tag);
};

/* The tags in a k-tags as a list. Text still in its box is included, so saving never loses a tag the person typed. */
export const readTags = $tags => {
  const pending = $tags.shadowRoot?.getElementById('tagsInput')?.value ?? '';
  return [...new Set(`${$tags.value},${pending}`.split(',').map(tag => tag.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean))];
};

class InventoryColorField extends LitElement {
  static properties = {
    value: { type: String },
  };

  constructor(){
    super();
    this.value = '';
  }

  createRenderRoot(){ return this; }

  set(value){
    this.value = value;
    this.dispatchEvent(new CustomEvent('change', { bubbles: true }));
  }

  render(){
    return this.value
      ? html`<div class="d-f" style="align-items: center; gap: var(--spacer_h);">
          <k-color-picker format="hex" .value=${this.value} @change=${e => {
            e.stopPropagation();
            /* It is a hex field, so a pick made in another format (rgb, hsl...) is converted and shown as hex. */
            const hex = toHex(e.target.value);
            if(e.target.value !== hex){ e.target.format = 'hex'; e.target.value = hex; }
            this.set(hex);
          }}></k-color-picker>
          <span class="tc-muted">${this.value}</span>
          <button type="button" class="btn" @click=${() => this.set('')}>Clear</button>
        </div>`
      : html`<button type="button" class="btn" @click=${() => this.set('#000000')}><k-icon name="add"></k-icon> Choose a color</button>`;
  }
}

if(!customElements.get('inventory-color-field')) customElements.define('inventory-color-field', InventoryColorField);

const searchItems = async (event, ownId) => {
  const $combobox = event.currentTarget;
  const [error, data] = await getItems({ q: event.detail.value, limit: 10 });
  if(error) return;
  $combobox.setOptions(data.items.filter(i => i.id !== ownId).map(i => ({ label: `${i.name} (${i.sku})`, value: i.id })));
};

/*
  Suggestions for a text field that has "suggest" switched on: the values other items already use.
  Free text is still allowed, so a brand seen for the first time is just typed in.
*/
const loadSuggestions = async ($combobox, field, q) => {
  const [error, data] = await getSuggestions(field.key, q, 8, field.category);
  if(!error) $combobox.setOptions(data.suggestions.map(s => s.value));
};

/*
  Offers the most used values the moment the field is focused, before anything is typed. The field
  is also scrolled to the middle of the form: the suggestions open below it, and on a phone a field
  near the bottom of a dialog would leave them hidden behind the buttons.
*/
const preloadSuggestions = ($combobox, field) => {
  setTimeout(() => $combobox.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
  if($combobox.dataset.preloaded) return;
  $combobox.dataset.preloaded = 'true';
  loadSuggestions($combobox, field, '');
};

/*
  The form control for one field, with its label, a required marker and its description.
*/
export const fieldTemplate = (field, value, { linked = {}, media = {}, ownId = null } = {}) => {
  const id = inputId(field);
  const link = field.type === 'item' && value ? linked[value] : null;
  const linkLabel = link ? `${link.name} (${link.sku})` : '';
  let control;
  switch(field.type){
    case 'longtext':
      control = html`<textarea id=${id} class="full" rows="3" .value=${value ?? ''}></textarea>`;
      break;
    case 'number':
      control = html`<input type="number" step="any" id=${id} class="full" .value=${value ?? ''}>`;
      break;
    case 'date':
      control = html`<input type="date" id=${id} class="full" .value=${value ?? ''}>`;
      break;
    case 'color':
      control = html`<inventory-color-field id=${id} .value=${value ?? ''}></inventory-color-field>`;
      break;
    case 'rating':
      control = html`<div class="d-f" style="align-items: center; gap: var(--spacer_h);">
        <k-rating id=${id} .value=${Number(value) || 0}></k-rating>
        <button type="button" class="no-btn tc-muted" style="cursor: pointer;" aria-label="Clear the rating" @click=${e => { e.currentTarget.previousElementSibling.value = 0; }}>clear</button>
      </div>`;
      break;
    case 'boolean':
      control = html`<k-toggle id=${id} .value=${Boolean(value)}></k-toggle>`;
      break;
    case 'select':
      control = html`<select id=${id} class="full">
        <option value="">${field.required ? 'Choose…' : 'None'}</option>
        ${field.options.map(o => html`<option value=${o} ?selected=${o === value}>${o}</option>`)}
      </select>`;
      break;
    case 'item':
      control = html`<k-combobox id=${id} class="full" placeholder="Search items…"
        .value=${linkLabel} data-item-id=${value ?? ''} data-label=${linkLabel}
        @search=${e => searchItems(e, ownId)}
        @select=${e => { e.currentTarget.dataset.itemId = e.detail.value; e.currentTarget.dataset.label = e.detail.label; }}></k-combobox>`;
      break;
    case 'media':
      control = html`<inventory-media-field id=${id} .value=${value ?? []} .assets=${media} .cropRatio=${field.imageRatio ?? ''} .cropMax=${field.imageMax ?? 0}></inventory-media-field>`;
      break;
    default:
      control = field.type === 'text' && field.suggest
        ? html`<k-combobox id=${id} class="full" debounce-ms="150" .value=${value ?? ''}
            empty-message="Nothing saved yet. Type to add one." no-results-message="New value"
            @focusin=${e => preloadSuggestions(e.currentTarget, field)}
            @search=${e => loadSuggestions(e.currentTarget, field, e.detail.value)}></k-combobox>`
        : html`<input type="text" id=${id} class="full" .value=${value ?? ''}>`;
  }
  return html`<div class="mb">
    <label class="d-b mb-sm" for=${id}>${field.label}${field.required ? ' *' : ''}</label>
    ${control}
    ${field.description ? html`<small class="d-b tc-muted">${field.description}</small>` : ''}
  </div>`;
};

/*
  Reads the current value of a field's control. An empty string means "no value".
*/
export const readField = ($root, field) => {
  const $el = $root.querySelector(`#${inputId(field)}`);
  switch(field.type){
    case 'rating':
      return $el.value || '';   // no stars is no rating
    case 'boolean':
      return $el.value === true || $el.value === 'true';
    case 'media':
      return [...$el.value];
    case 'item': {
      const text = ($el.value || '').trim();
      if(!text) return '';
      if($el.dataset.itemId && text === $el.dataset.label) return $el.dataset.itemId;
      throw new Error(`${field.label}: choose an item from the list`);
    }
    default:
      return typeof $el.value === 'string' ? $el.value.trim() : $el.value;
  }
};

/*
  A plain-text rendering of a value, for table cells and summaries. Never returns markup, so it is
  safe to hand to anything that might treat a string as HTML.
*/
export const displayValue = (field, value, { linked = {} } = {}) => {
  if(value === undefined || value === null) return '';
  switch(field.type){
    case 'boolean': return value ? 'Yes' : 'No';
    case 'rating': return '★'.repeat(Number(value)) + '☆'.repeat(5 - Number(value));
    case 'item': return linked[value] ? `${linked[value].name} (${linked[value].sku})` : '(deleted item)';
    case 'media': return value.length === 1 ? '1 file' : `${value.length} files`;
    default: return String(value);
  }
};
