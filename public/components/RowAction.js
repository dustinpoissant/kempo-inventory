import AdminTableControl from '/admin/components/AdminTableControl.js';
import { html } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Icon.js';

/*
  A k-table row control that tells the page which action was chosen for its row's record.
  The page owns the dialog and the request; this only reports the choice, as an `itemAction`
  event on the table: { action, record }.

    <inventory-row-action action="edit" icon="edit" title="Edit"></inventory-row-action>
*/
export default class RowAction extends AdminTableControl {
  static properties = {
    ...AdminTableControl.properties,
    action: { type: String },
    icon: { type: String },
  };

  constructor(){
    super();
    this.action = '';
    this.icon = 'edit';
  }

  handleAction(){
    const record = this.record;
    if(!record) return;
    this.table.dispatchEvent(new CustomEvent('itemAction', { detail: { action: this.action, record } }));
  }

  render(){ return html`<slot><k-icon name="${this.icon}"></k-icon></slot>`; }
}

customElements.define('inventory-row-action', RowAction);
