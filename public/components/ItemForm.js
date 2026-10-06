import { html, render, nothing } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import { getItems, getCategories, createItem, updateItem } from '/inventory/sdk.js';
import { fieldTemplate, readField, applicableFields, inputId, tagsValue, suggestTags, readTags, lowerTagInput, lowerTagChips } from '/inventory/components/ItemFields.js';
import { scanBarcode } from '/inventory/components/BarcodeScanner.js';

/*
  The item form, on its own: a container element holding every box, with no dialog around it, so the same
  form can sit in a dialog (editing an item) or fill a page (adding one, see NewItemPage.js).

    const form = createItemForm({ item, fields, defaults, askQuantity });
    parent.append(form.$root);
    const saved = await form.save();     // the saved item, or null (a problem was already shown to the person)
    form.isDirty();                      // has anything been changed since it opened? (for "unsaved work" warnings)

  `fields` is the full field list from getFields(): the form shows the default fields plus those of the
  item's category, and swaps them as the Category box changes. `defaults` pre-fills a new item
  ({ sku, name, quantity, category, tags, fields }); `askQuantity: false` leaves out the starting
  quantity box (the item just exists, with defaults.quantity).
*/

/*
  Fills the Category box with the categories already in use the first time it is focused. The box
  is also scrolled to the middle of the form so the list is not hidden behind the buttons.
*/
const offerCategories = async $combobox => {
  setTimeout(() => $combobox.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
  if($combobox.dataset.loaded) return;
  $combobox.dataset.loaded = 'true';
  const [error, data] = await getCategories({ includeEmpty: true });   // categories made in the admin count even before an item uses them
  if(!error) $combobox.setOptions(data.categories.map(c => c.name));
};

export const createItemForm = ({ item = null, fields = [], defaults = {}, askQuantity = true, context = { linked: {}, media: {} }, inDialog = false } = {}) => {
  const editing = Boolean(item);
  /* An item an extension owns keeps its SKU, name and category: the server refuses changes to them, so the boxes are not offered. */
  const locked = editing && Boolean(item.owner);
  const $root = document.createElement('div');
  if(inDialog){
    $root.className = 'p';
    $root.style.cssText = 'max-height: calc(100vh - 14rem); overflow-y: auto;';
  }

  /*
    A hardware barcode scanner types the code and then presses Enter, which a dialog would take as
    "submit the form". In the SKU box Enter just moves on to the name instead.
  */
  const skuKeydown = event => {
    if(event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    $root.querySelector('#dlg-name')?.focus();
  };

  const scan = async () => {
    const code = (await scanBarcode())?.trim();
    if(!code) return;
    $root.querySelector('#dlg-sku').value = code;
    if(code === item?.sku) return;
    const [, found] = await getItems({ q: code, limit: 5 });
    const clash = found?.items.find(i => i.sku.toLowerCase() === code.toLowerCase() && i.id !== item?.id);
    if(clash) Toast.warning(`"${code}" is already used by ${clash.name}`);
  };

  /*
    The custom fields shown depend on the category typed in the box. What was typed in a field is kept
    when the category changes, so a field both categories share does not lose it.
  */
  const kept = {};
  let shown = [];
  const showFields = () => {
    const $box = $root.querySelector('#dlg-fields');
    if(!$box) return;
    const next = applicableFields(fields, $root.querySelector('#dlg-category')?.value ?? '');
    if(next.length === shown.length && next.every((f, i) => f === shown[i])) return;
    for(const field of shown){
      try { kept[field.key] = readField($root, field); } catch { /* an incomplete value is not worth keeping */ }
    }
    /* Files uploaded in this form are not in the item's media list yet, so carry their details across too. */
    for(const field of shown){
      if(field.type !== 'media') continue;
      const $media = $root.querySelector(`#${inputId(field)}`);
      if($media?.assets) context.media = { ...context.media, ...$media.assets };
    }
    shown = next;
    /*
      Cleared first, so every field is built fresh. Re-rendering over the old fields reuses their parts
      by position, which left a second, stale copy of a field (a photo picker the save then ignored)
      whenever the category's fields changed the order.
    */
    render(nothing, $box);
    render(html`${shown.map(f => fieldTemplate(f, f.key in kept ? kept[f.key] : (item?.fields[f.key] ?? defaults.fields?.[f.key]), context))}`, $box);
  };

  render(html`
    ${locked ? html`<p class="mb tc-muted">Managed by the ${item.owner} extension. Its SKU, name and category can only be changed there; everything else, including stock, you can edit here.</p>` : ''}
    <div class="d-f mb" style="gap: var(--spacer);">
      <div class="flex">
        <label class="d-b mb-sm" for="dlg-sku">SKU *</label>
        <div class="d-f" style="gap: var(--spacer_h);">
          <input type="text" id="dlg-sku" class="flex" style="width: auto; min-width: 0;" autocapitalize="off" autocomplete="off"
            .value=${item?.sku ?? defaults.sku ?? ''} ?disabled=${locked} @keydown=${skuKeydown}>
          <button type="button" class="btn" id="dlg-scan" ?disabled=${locked} @click=${scan}>Scan</button>
        </div>
      </div>
      ${editing || !askQuantity ? '' : html`<div style="width: 9rem;"><label class="d-b mb-sm" for="dlg-qty">Starting quantity</label><input type="number" id="dlg-qty" class="full" min="0" step="1" .value=${String(defaults.quantity ?? 0)}></div>`}
    </div>
    <div class="mb"><label class="d-b mb-sm" for="dlg-name">Name *</label><input type="text" id="dlg-name" class="full" ?disabled=${locked} .value=${item?.name ?? defaults.name ?? ''}></div>
    <div class="mb">
      <label class="d-b mb-sm" for="dlg-category">Category</label>
      <k-combobox id="dlg-category" class="full" debounce-ms="150" ?disabled=${locked} .value=${item?.category ?? defaults.category ?? ''}
        empty-message="No categories yet. Type to add one." no-results-message="New category"
        @focusin=${e => offerCategories(e.currentTarget)}
        @search=${showFields} @select=${() => setTimeout(showFields)} @change=${() => setTimeout(showFields)} @focusout=${() => setTimeout(showFields, 150)}></k-combobox>
    </div>
    <div class="mb"><label class="d-b mb-sm" for="dlg-tags">Tags</label><k-tags id="dlg-tags" .value=${tagsValue(item?.tags ?? defaults.tags)} .getSuggestions=${suggestTags} @input=${lowerTagInput} @change=${lowerTagChips}></k-tags></div>
    <div class="mb"><label class="d-b mb-sm" for="dlg-description">Description</label><textarea id="dlg-description" class="full" rows="2" .value=${item?.description ?? ''}></textarea></div>
    <div id="dlg-fields"></div>
  `, $root);
  showFields();

  /* Everything the person has entered, as one string, for telling whether anything has changed. */
  const snapshot = () => {
    const values = {};
    for(const field of shown){
      try { values[field.key] = readField($root, field); } catch { values[field.key] = '?'; }
    }
    return JSON.stringify({
      sku: $root.querySelector('#dlg-sku')?.value ?? '',
      name: $root.querySelector('#dlg-name')?.value ?? '',
      description: $root.querySelector('#dlg-description')?.value ?? '',
      category: $root.querySelector('#dlg-category')?.value ?? '',
      quantity: $root.querySelector('#dlg-qty')?.value ?? '',
      tags: readTags($root.querySelector('#dlg-tags')),
      values,
    });
  };
  /* Taken once the boxes have settled (the tags box and the category list fill themselves in just after they appear). */
  let opened = null;
  setTimeout(() => { opened = snapshot(); }, 800);
  const isDirty = () => opened !== null && snapshot() !== opened;
  const markSaved = () => { opened = snapshot(); };

  const save = async () => {
    const values = {};
    try {
      for(const field of shown) values[field.key] = readField($root, field);
    } catch(error) {
      Toast.error(error.message);
      return null;
    }
    const data = {
      sku: $root.querySelector('#dlg-sku').value.trim(),
      name: $root.querySelector('#dlg-name').value.trim(),
      description: $root.querySelector('#dlg-description').value,
      category: ($root.querySelector('#dlg-category').value || '').trim(),
      tags: readTags($root.querySelector('#dlg-tags')),
      fields: values,
    };
    if(!data.sku || !data.name){
      Toast.error('SKU and name are required');
      return null;
    }
    if(locked) for(const property of ['sku', 'name', 'category']) delete data[property];
    let error;
    let saved;
    if(editing){
      [error, saved] = await updateItem(item.id, data);
    } else {
      /* Blank fields are left out on create so hooks can tell "not provided" from a value. */
      data.fields = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && !(Array.isArray(v) && !v.length)));
      if(!data.category) delete data.category;
      if(!data.tags.length) delete data.tags;
      data.quantity = askQuantity ? Number($root.querySelector('#dlg-qty').value || 0) : Number(defaults.quantity ?? 0);
      [error, saved] = await createItem(data);
    }
    if(error){
      Toast.error(error.msg || `Failed to ${editing ? 'save' : 'create'} item`);
      return null;
    }
    markSaved();
    return saved.item;
  };

  return { $root, save, isDirty, markSaved, editing };
};
