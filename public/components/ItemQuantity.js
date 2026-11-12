import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import '/kempo-ui/components/Spinner.js';
import { getAllCurrentUserPermissions } from '/kempo/sdk.js';
import { getItem, adjustQuantity } from '/inventory/sdk.js';

const REASONS = { received: 'Received', sold: 'Sold / used', damaged: 'Damaged / lost', correction: 'Count correction', adjustment: 'Other' };

/*
  An item's quantity on its edit page: the count on hand, a form to add or remove stock or to set the count
  outright, and the history. The server sends the count and history only to people who manage quantity, and
  the form only to those who may adjust it. The page sets the `item-id` attribute, and the component loads the
  item when it knows it. A reason is optional.
*/
export default class ItemQuantity extends ShadowComponent {
  static properties = {
    itemId: { type: String, attribute: 'item-id' },
    item: { state: true },
    movements: { state: true },
    permissions: { state: true },
    error: { state: true },
    mode: { state: true },
    amount: { state: true },
    reason: { state: true },
    note: { state: true },
    busy: { state: true },
  };

  constructor(){
    super();
    this.itemId = '';
    this.item = null;
    this.movements = [];
    this.permissions = new Set();
    this.error = '';
    this.mode = 'set';
    this.amount = '';
    this.reason = '';
    this.note = '';
    this.busy = false;
  }

  /*
    Lifecycle callbacks
  */
  updated(changed){
    super.updated(changed);
    if(changed.has('itemId') && this.itemId) this.load();
  }

  /*
    Loading and changing
  */
  get canAdjust(){
    return this.permissions.has('kempo-inventory:quantity:adjust');
  }

  get unit(){
    return this.item?.effectiveUnit ?? '';
  }

  get validAmount(){
    if(this.amount.trim() === '') return false;
    const number = Number(this.amount);
    if(!Number.isFinite(number)) return false;
    return this.mode === 'set' ? number >= 0 : number !== 0;
  }

  load = async () => {
    const [[error, data], [, permissionData]] = await Promise.all([getItem(this.itemId), getAllCurrentUserPermissions()]);
    if(error){
      this.error = error.code === 404 ? 'Item not found.' : error.msg;
      return;
    }
    this.item = data.item;
    this.movements = data.movements;
    this.permissions = new Set(permissionData?.permissions ?? []);
  };

  apply = async () => {
    if(!this.validAmount){
      Toast.error(this.mode === 'set' ? 'Enter the count, zero or more' : 'Enter a number that is not zero');
      return;
    }
    const amount = Number(this.amount);
    this.busy = true;
    const [error, data] = await adjustQuantity(this.item.id, {
      ...(this.mode === 'set' ? { set: amount } : { delta: amount }),
      reason: this.reason,
      note: this.note.trim(),
    });
    this.busy = false;
    if(error){
      Toast.error(error.msg);
      return;
    }
    this.amount = '';
    this.note = '';
    Toast.success(`Quantity is now ${data.item.quantity}${this.unit ? ` ${this.unit}` : ''}`);
    await this.load();
  };

  /*
    View
  */
  renderForm(){
    const setting = this.mode === 'set';
    return html`
      <h4>${setting ? 'Set the count' : 'Add or remove'}</h4>
      <div class="d-f">
        <div class="mb mrq">
          <label class="d-b mbq" for="qtyMode">How</label>
          <select id="qtyMode" class="m0" @change=${event => { this.mode = event.target.value; this.amount = ''; }}>
            <option value="change" ?selected=${!setting}>Add or remove</option>
            <option value="set" ?selected=${setting}>Set to</option>
          </select>
        </div>
        <div class="mb mrq" style="width: 12rem;">
          <label class="d-b mbq" for="qtyAmount">${setting ? 'Count' : 'Change'}${this.unit ? ` (${this.unit})` : ''} <span class="tc-danger">*</span></label>
          <input id="qtyAmount" type="number" step="any" class="full m0" .value=${this.amount}
            @input=${event => { this.amount = event.target.value; }}>
        </div>
      </div>
      <div class="d-f">
        <div class="mb mrq">
          <label class="d-b mbq" for="qtyReason">Reason</label>
          <select id="qtyReason" class="m0" @change=${event => { this.reason = event.target.value; }}>
            <option value="" ?selected=${this.reason === ''}>No reason</option>
            ${Object.entries(REASONS).map(([value, label]) => html`<option value=${value} ?selected=${value === this.reason}>${label}</option>`)}
          </select>
        </div>
        <div class="flex mb mrq" style="min-width: 12rem;">
          <label class="d-b mbq" for="qtyNote">Note</label>
          <input id="qtyNote" type="text" class="full m0" maxlength="200" .value=${this.note}
            @input=${event => { this.note = event.target.value; }}>
        </div>
      </div>
      <button class="primary mb" ?disabled=${this.busy || !this.validAmount} @click=${this.apply}>${setting ? 'Set quantity' : 'Apply change'}</button>`;
  }

  renderHistory(){
    if(!this.movements.length) return html`<p class="tc-muted">No quantity changes yet.</p>`;
    return html`<table>
      <thead><tr><th>When</th><th>Change</th><th>Reason</th><th>Balance</th></tr></thead>
      <tbody>
        ${this.movements.map(movement => html`<tr>
          <td>${new Date(movement.created).toLocaleString()}</td>
          <td>${movement.delta > 0 ? '+' : ''}${movement.delta}</td>
          <td>${REASONS[movement.reason] ?? movement.reason}${movement.note ? ` - ${movement.note}` : ''}</td>
          <td>${movement.quantityAfter}</td>
        </tr>`)}
      </tbody>
    </table>`;
  }

  render(){
    if(!this.itemId) return '';
    if(this.error) return html`<p class="tc-danger">${this.error}</p>`;
    if(!this.item) return html`<k-spinner></k-spinner>`;
    if(this.item.quantity === undefined) return html`<p class="tc-muted">Quantity is only shown to people who manage stock.</p>`;
    return html`
      <h2 class="mb0">${this.item.quantity}${this.unit ? ` ${this.unit}` : ''}</h2>
      <p class="tc-muted mb">On hand</p>
      ${this.canAdjust ? this.renderForm() : ''}
      <h4>History</h4>
      ${this.renderHistory()}
    `;
  }
}

customElements.define('k-inventory-item-quantity', ItemQuantity);
