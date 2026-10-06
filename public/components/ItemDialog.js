import { html } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import Dialog from '/kempo-ui/components/Dialog.js';
import '/kempo-ui/components/Table.js';
import { getItem, adjustStock } from '/inventory/sdk.js';
import { createItemForm } from '/inventory/components/ItemForm.js';

/*
  The two dialogs every inventory screen needs, shared by the extension's admin page and by any
  site built on it:

    import { openItemDialog, openAdjustDialog } from '/inventory/components/ItemDialog.js';

    openItemDialog({ fields, onSaved: item => reload() });                 // new item
    openItemDialog({ fields, defaults: { sku, name, quantity: 1 }, onSaved: ... });   // new item, SKU, name and quantity filled in
    openItemDialog({ fields, defaults: { category: 'Paint' }, onSaved: ... });   // a category filled in
    openItemDialog({ fields, defaults: { fields: { brand: 'Vallejo' } }, onSaved: ... });   // custom fields filled in
    openItemDialog({ item, fields, onSaved: item => reload() });           // edit an item
    openItemDialog({ fields, askQuantity: false, defaults: { quantity: 1 }, onSaved });   // no quantity box: the item just exists
    openAdjustDialog({ item, onSaved: item => reload() });                 // add or remove stock

  `fields` is the full field list from getFields(). The form shows the default fields plus those of the
  item's category, and swaps them as the Category box changes. `onSaved` runs after the change is stored.
*/

const SCROLL = 'max-height: calc(100vh - 14rem); overflow-y: auto;';

/*
  Edit an item (or add one) in a dialog. The form itself is createItemForm (ItemForm.js). Adding an item
  is better done on a page (see NewItemPage.js): a dialog is too easy to dismiss with a stray tap, and
  everything entered would be lost. So this dialog does not close when you click outside it; only its own
  Cancel button (or the close button) does.
*/
export const openItemDialog = async ({ item = null, fields = [], defaults = {}, askQuantity = true, onSaved = () => {} } = {}) => {
  let context = { linked: {}, media: {} };
  if(item){
    const [error, data] = await getItem(item.id);
    if(error){
      Toast.error(error.msg || 'Failed to load item');
      return null;
    }
    item = data.item;
    context = { linked: data.linked, media: data.media, ownId: item.id };
  }
  const form = createItemForm({ item, fields, defaults, askQuantity, context, inDialog: true });

  const $dialog = Dialog.create(form.$root, {
    title: form.editing ? `Edit ${item.name}` : 'New Item',
    confirmText: form.editing ? 'Save' : 'Create',
    cancelText: 'Cancel',
    overlayClose: false,   // a stray tap outside must not throw away what was entered
    confirmAction: async event => {
      event.keepDialogOpen = true;
      const saved = await form.save();
      if(!saved) return;
      $dialog.close();
      Toast.success(form.editing ? 'Item saved' : 'Item created');
      onSaved(saved);
    },
  });
  return $dialog;
};

export const openAdjustDialog = async ({ item, onSaved = () => {} } = {}) => {
  const [error, data] = await getItem(item.id);
  if(error){
    Toast.error(error.msg || 'Failed to load item');
    return null;
  }
  const $dialog = Dialog.create(html`
    <div class="p" style=${SCROLL}>
      <p class="mb">Current quantity: <strong>${data.item.quantity}</strong></p>
      <div class="mb">
        <label class="d-b mb-sm" for="dlg-delta">Change (negative removes stock)</label>
        <input type="number" id="dlg-delta" class="full" step="1" required>
      </div>
      <div class="mb">
        <label class="d-b mb-sm" for="dlg-reason">Reason</label>
        <select id="dlg-reason" class="full">
          <option value="received">Received</option>
          <option value="sold">Sold / used</option>
          <option value="damaged">Damaged / lost</option>
          <option value="correction">Count correction</option>
          <option value="adjustment">Other</option>
        </select>
      </div>
      <div class="mb">
        <label class="d-b mb-sm" for="dlg-note">Note</label>
        <input type="text" id="dlg-note" class="full">
      </div>
      <h6 class="mb-sm">History</h6>
      <k-table id="historyTable" placeholder="No movements yet."></k-table>
    </div>
  `, {
    title: `Adjust stock: ${data.item.name}`,
    confirmText: 'Apply',
    cancelText: 'Close',
    confirmAction: async event => {
      event.keepDialogOpen = true;
      const delta = Number($dialog.querySelector('#dlg-delta').value);
      if(!Number.isInteger(delta) || delta === 0){
        Toast.error('Enter a non-zero whole number');
        return;
      }
      const [adjustError, adjusted] = await adjustStock(item.id, {
        delta,
        reason: $dialog.querySelector('#dlg-reason').value,
        note: $dialog.querySelector('#dlg-note').value,
      });
      if(adjustError){
        Toast.error(adjustError.msg || 'Failed to adjust stock');
        return;
      }
      $dialog.close();
      Toast.success('Stock updated');
      onSaved(adjusted.item);
    },
  });
  $dialog.querySelector('#historyTable').setData({
    records: data.movements.map(m => ({
      ...m,
      when: new Date(m.created).toLocaleString(),
      change: `${m.delta > 0 ? '+' : ''}${m.delta}`,
      why: m.note ? `${m.reason} - ${m.note}` : m.reason,
      balance: String(m.quantityAfter),
    })),
    fields: [
      { name: 'when', label: 'When', size: 190 },
      { name: 'change', label: 'Change', size: 80 },
      { name: 'why', label: 'Reason', size: 200 },
      { name: 'balance', label: 'Balance', size: 80 },
    ],
  });
  return $dialog;
};
