import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html, css, nothing, render } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Table.js';
import '/kempo-ui/components/controls/TcDeleteRecord.js';
import '/kempo-ui/components/controls/TcSearch.js';
import '/kempo-ui/components/Toggle.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/FilterList.js';
import '/kempo-ui/components/FilterItem.js';
import '/inventory/components/ToolbarControl.js';
import '/kempo/components/Permission.js';
import Toast from '/kempo-ui/components/Toast.js';
import Dialog from '/kempo-ui/components/Dialog.js';
import '/inventory/components/RowAction.js';
import { getFields, createField, updateField, deleteField, getCategories } from '/inventory/sdk.js';

/*
  The item fields, as a tab of the inventory page (served at /inventory/components/FieldsManager.js). A field you add for every item
  appears on all of them; a field added for one category only appears on items in that category. Loads when its tab is first shown.

    <k-inventory-fields></k-inventory-fields>
*/
const TYPE_LABELS = {
  text: 'Text',
  longtext: 'Long text',
  number: 'Number',
  boolean: 'Yes / No',
  date: 'Date',
  color: 'Color',
  rating: 'Rating (stars)',
  select: 'Choice list',
  item: 'Link to another item',
  media: 'Photos / files',
};

/* Same rule the server applies, so the key preview matches what gets saved. */
const keyFromLabel = label => {
  const words = String(label ?? '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const key = words.map((w, i) => i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return /^[a-z]/.test(key) ? key.slice(0, 40) : '';
};

const decorate = field => ({
  ...field,
  typeText: TYPE_LABELS[field.type] ?? field.type,
  requiredText: field.required ? 'Yes' : 'No',
  listedText: field.listed ? 'Yes' : 'No',
  ownerText: field.owner || 'Custom',
  scopeText: field.category ? field.categoryName : 'Every item',
  optionsText: field.options.join(', '),
  cropText: field.type === 'media' ? [field.imageRatio ? field.imageRatio.replace(' / ', ':') : '', field.imageMax ? `max ${field.imageMax}px` : ''].filter(Boolean).join(', ') : '',
});

export default class FieldsManager extends ShadowComponent {
  constructor(){
    super();
    this.creatableTypes = Object.keys(TYPE_LABELS);
    this.conversions = {};
    this.categories = [];
    this.allFields = [];
    this.loaded = false;
    /* '' = every field, '*' = the default fields only, otherwise a category key. The category link on the Categories tab sets it. */
    const wanted = new URLSearchParams(location.search).get('category');
    this.scope = wanted ? wanted.trim().replace(/\s+/g, ' ').toLowerCase() : '';
    this.picked = this.scope ? [this.scope] : [];
  }

  connectedCallback(){
    super.connectedCallback();
    if(this.hasAttribute('category')) this.setPicked([this.getAttribute('category')]);
    const pane = this.closest('k-tab-content');
    // Loads when its tab is first opened, so a tab nobody opens makes no requests.
    if(!pane || pane.active) this.start();
    else this.closest('k-tabs')?.addEventListener('tabfirstshown', ({ detail }) => {
      if(detail.tab === pane.name) this.start();
    });
  }

  firstUpdated(){
    this.table.addEventListener('requestDelete', this.requestDelete);
    this.table.addEventListener('toolbarAction', ({ detail: { action } }) => {
      if(action === 'scope') this.picked.length ? this.setPicked([]) : this.openScopePicker();
    });
    this.table.addEventListener('itemAction', ({ detail: { action, record } }) => {
      if(action === 'edit') this.openFieldDialog(record);
    });
    this.renderRoot.querySelector('#newFieldBtn').addEventListener('click', () => this.openFieldDialog(null));
  }

  get table(){
    return this.renderRoot.querySelector('#fieldsTable');
  }

  start = () => {
    if(this.loaded) return;
    this.loaded = true;
    this.load();
  };

  load = async () => {
    const [categoriesError, categoryData] = await getCategories({ includeEmpty: true });
    if(!categoriesError) this.categories = categoryData.categories;
    const [error, data] = await getFields();
    if(error){
      Toast.error(error.msg || 'Failed to load fields');
      return;
    }
    this.creatableTypes = data.types;
    this.conversions = data.conversions ?? {};
    this.allFields = data.fields;
    this.requestUpdate();
    this.renderTable();
  };

  static styles = css`
    .scope.selected:hover { text-decoration: line-through; }
  `;

  scopeLabel(){
    const labels = new Map(this.scopeOptions());
    return this.picked.map(key => labels.get(key) ?? key).join(', ');
  }

  /* A fixed-height, filterable list in a dialog: picking one closes it, and the choice shows as a chip above the table. */
  openScopePicker = () => {
    const $dialog = Dialog.create(html`
      <div class="p">
        <input type="search" class="full m0 rb0" placeholder="Search Categories" aria-label="Search Categories" @input=${event => $dialog.querySelector('k-filter-list').filter(event.target.value)}>
        <k-filter-list class="bl br bb" style="display: block; height: 20rem; overflow-y: auto;">
          ${this.scopeOptions().map(([key, label]) => html`
            <k-filter-item filter-keywords=${label}><a href="#" class="d-b px pyh no-link bb r0" @click=${event => { event.preventDefault(); $dialog.close(); this.setPicked([key]); }}>${label}</a></k-filter-item>
          `)}
        </k-filter-list>
      </div>
    `, { title: 'Show fields for', confirmText: 'Close', cancelText: '' });
  };

  setPicked = keys => {
    this.picked = keys;
    this.scope = keys.length === 1 ? keys[0] : '';
    this.requestUpdate();
    this.renderTable();
  };

  /* The filter's choices: the default fields, then each category, as the names the tags show. */
  scopeOptions(){
    return [['*', 'Every item (default fields)'], ...this.categories.map(c => [c.key, c.name])];
  }

  renderTable(){
    const visible = this.allFields.filter(f => this.picked.length === 0 || this.picked.some(key => key === '*' ? !f.category : f.category === key));
    this.table?.setData({
      records: visible.map(decorate),
      fields: [
        { name: 'label', label: 'Label', size: 200, editable: false },
        { name: 'key', label: 'Key', size: 150, editable: false },
        { name: 'scopeText', label: 'Applies to', size: 170, editable: false },
        { name: 'typeText', label: 'Type', size: 170, editable: false },
        { name: 'requiredText', label: 'Required', size: 90, editable: false },
        { name: 'listedText', label: 'In list', size: 80, editable: false },
        { name: 'optionsText', label: 'Choices', size: 200, editable: false },
        { name: 'cropText', label: 'Photo crop', size: 150, editable: false },
        { name: 'ownerText', label: 'Managed by', size: 170, editable: false },
      ],
    });
  }

  requestDelete = ({ detail: { records, approve, reject } }) => {
    const [record] = records;
    if(record.owner){
      reject();
      Toast.error(`"${record.label}" is managed by the ${record.owner} extension and cannot be deleted here`);
      return;
    }
    Dialog.confirm(`Delete the field "${record.label}"? Its value is removed from ${record.category ? 'every item in that category' : 'every item'}. This action cannot be undone.`, async confirmed => {
      if(!confirmed){ reject(); return; }
      const [error] = await deleteField(record.key, { category: record.category });
      if(error){
        reject();
        Toast.error(error.msg || 'Failed to delete field');
        return;
      }
      approve();
      Toast.success('Field deleted');
      this.load();
    });
  };

  openFieldDialog(field){
    const editing = Boolean(field);
    const managed = editing && Boolean(field.owner);
    let keyTouched = editing;
    const categories = this.categories;
    const scope = this.scope;

    const $dialog = Dialog.create(html`
      <div class="p" style="max-height: calc(100vh - 14rem); overflow-y: auto;">
        ${managed ? html`<p class="mb tc-muted">Managed by the ${field.owner} extension. You can rename it, change its description and choose whether it shows in the list.</p>` : ''}
        <div class="mb">
          <label class="d-b mb-sm" for="fld-label">Label *</label>
          <input type="text" id="fld-label" class="full" .value=${field?.label ?? ''}
            @input=${e => {
              if(keyTouched) return;
              $dialog.querySelector('#fld-key').value = keyFromLabel(e.target.value);
            }}>
        </div>
        <div class="mb">
          <label class="d-b mb-sm" for="fld-scope">Applies to</label>
          <select id="fld-scope" class="full" ?disabled=${editing}>
            <option value="" ?selected=${editing ? !field.category : scope === '' || scope === '*'}>Every item</option>
            ${categories.map(c => html`<option value=${c.name} ?selected=${editing ? c.key === field.category : c.key === scope}>Only ${c.name}</option>`)}
          </select>
        </div>
        <div class="d-f mb" style="gap: var(--spacer);">
          <div class="flex">
            <label class="d-b mb-sm" for="fld-key">Key *</label>
            <input type="text" id="fld-key" class="full" ?disabled=${editing} .value=${field?.key ?? ''}
              @input=${() => { keyTouched = true; }}>
          </div>
          <div class="flex">
            <label class="d-b mb-sm" for="fld-type">Type *</label>
            <select id="fld-type" class="full" ?disabled=${editing && (managed || !this.conversions[field.type]?.length)}>
              ${Object.entries(TYPE_LABELS).filter(([value]) => editing
                ? value === field.type || (!managed && this.conversions[field.type]?.includes(value))
                : this.creatableTypes.includes(value)).map(([value, label]) => html`<option value=${value} ?selected=${value === (field?.type ?? 'text')}>${label}</option>`)}
            </select>
          </div>
        </div>
        <div id="fld-options-row" class="mb" style="display: none;">
          <label class="d-b mb-sm" for="fld-options">Choices (one per line)</label>
          <textarea id="fld-options" class="full" rows="4" ?disabled=${managed} .value=${field?.options.join('\n') ?? ''}></textarea>
        </div>
        <div id="fld-crop-row" class="mb" style="display: none;">
          <div class="d-f" style="gap: var(--spacer);">
            <div class="flex">
              <label class="d-b mb-sm" for="fld-ratio">Force photo shape</label>
              <input type="text" id="fld-ratio" class="full" placeholder="e.g. 1:1, 4:3, 16:9" autocomplete="off" .value=${field?.imageRatio ? field.imageRatio.replace(' / ', ':') : ''}>
            </div>
            <div style="width: 9rem;">
              <label class="d-b mb-sm" for="fld-max">Max size (px)</label>
              <input type="number" id="fld-max" class="full" min="0" max="8000" step="1" placeholder="no limit" .value=${field?.imageMax || ''}>
            </div>
          </div>
          <small class="d-b tc-muted">Photos are cropped to this shape as they are added (a cropper opens, locked to it) and kept within the maximum size. Leave the shape empty to allow any shape; with only a maximum, photos are just scaled down.</small>
        </div>
        <div id="fld-suggest-row" class="mb" style="display: none;">
          <k-toggle id="fld-suggest" .value=${Boolean(field?.suggest)}>Suggest values already used</k-toggle>
          <small class="d-b tc-muted">Offers values from other items as you type, so repeated entries such as a brand stay consistent. Anything new can still be typed.</small>
        </div>
        <div class="mb">
          <label class="d-b mb-sm" for="fld-description">Description</label>
          <input type="text" id="fld-description" class="full" .value=${field?.description ?? ''}>
        </div>
        <div class="d-f mb" style="gap: var(--spacer); align-items: center;">
          ${managed ? '' : html`<k-toggle id="fld-required" .value=${Boolean(field?.required)}>Required</k-toggle>`}
          <k-toggle id="fld-listed" .value=${field ? Boolean(field.listed) : true}>Show in list</k-toggle>
          <div class="flex"></div>
          <div style="width: 7rem;">
            <label class="d-b mb-sm" for="fld-position">Order</label>
            <input type="number" id="fld-position" class="full" step="1" .value=${field?.position ?? 0}>
          </div>
        </div>
      </div>
    `, {
      title: editing ? `Edit ${field.label}` : 'New Field',
      confirmText: editing ? 'Save' : 'Create',
      cancelText: 'Cancel',
      confirmAction: async event => {
        event.keepDialogOpen = true;
        const value = id => $dialog.querySelector(id).value;
        const data = {
          label: value('#fld-label').trim(),
          description: value('#fld-description'),
          listed: $dialog.querySelector('#fld-listed').value === true,
          suggest: $dialog.querySelector('#fld-suggest').value === true,
          position: Number(value('#fld-position') || 0),
        };
        if($type.value === 'media'){
          data.imageRatio = value('#fld-ratio').trim();
          data.imageMax = Number(value('#fld-max') || 0);
        }
        if(!managed){
          data.required = $dialog.querySelector('#fld-required').value === true;
          data.options = value('#fld-options').split('\n').map(o => o.trim()).filter(Boolean);
        }
        if(!data.label){
          Toast.error('A label is required');
          return;
        }
        let error;
        if(editing){
          if(value('#fld-type') !== field.type) data.type = value('#fld-type');
          [error] = await updateField(field.key, data, { category: field.category });
        } else {
          [error] = await createField({ ...data, key: value('#fld-key').trim(), type: value('#fld-type'), category: value('#fld-scope') });
        }
        if(error){
          Toast.error(error.msg || 'Failed to save field');
          return;
        }
        $dialog.close();
        Toast.success(editing ? 'Field saved' : 'Field created');
        this.load();
      },
    });

    const $type = $dialog.querySelector('#fld-type');
    const syncOptions = () => {
      $dialog.querySelector('#fld-options-row').style.display = $type.value === 'select' ? '' : 'none';
      $dialog.querySelector('#fld-suggest-row').style.display = $type.value === 'text' ? '' : 'none';
      $dialog.querySelector('#fld-crop-row').style.display = $type.value === 'media' ? '' : 'none';
    };
    $type.addEventListener('change', syncOptions);
    syncOptions();
  }

  render(){
    return html`
      <p class="mb tc-muted">
        Every item has a SKU, name, category, quantity and description. A field you add for <strong>every item</strong> appears on all of them;
        a field you add for one category (a paint's "Finish", say) only appears on items in that category.
        Fields added by other extensions are managed by those extensions.
      </p>
      <k-table id="fieldsTable" request-delete enable-pages page-size="25" page-size-options="[10,25,50,100]" placeholder="No custom fields yet." filtered-placeholder="No fields match your search.">
        <k-inventory-row-action slot="before" action="edit" icon="edit" title="Edit"></k-inventory-row-action>
        <kc-tc-delete-record slot="after"></kc-tc-delete-record>
        <div slot="top" class="d-f full" style="align-items: center; gap: var(--spacer_h); flex-wrap: wrap;">
          <kc-tc-search style="width: 16rem"></kc-tc-search>
          ${this.hasAttribute('category') ? nothing : html`<k-inventory-toolbar-control action="scope" class="scope${this.picked.length ? ' selected' : ''}">${this.picked.length ? html`<k-icon name="close"></k-icon> ${this.scopeLabel()}` : html`<k-icon name="filter"></k-icon> Category`}</k-inventory-toolbar-control>`}
          <div class="flex"></div>
          <k-permission has="kempo-inventory:fields:manage">
            <button id="newFieldBtn" class="primary m0"><k-icon name="add"></k-icon> New Field</button>
          </k-permission>
        </div>
      </k-table>
    `;
  }
}

customElements.define('k-inventory-fields', FieldsManager);
