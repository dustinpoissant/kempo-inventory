import { html, render } from '/kempo-ui/lit-all.min.js';
import Dialog from '/kempo-ui/components/Dialog.js';
import { createItemForm } from '/inventory/components/ItemForm.js';

/*
  Adding and editing an item are pages, not dialogs. A dialog closes with a stray tap outside it and takes
  everything entered (photos taken with the camera included) with it. These pages keep the work, and warn
  before the browser leaves it (a link, the back button, a refresh, closing the tab) while anything entered
  has not been saved.

    import { mountNewItemPage, mountEditItemPage, safeNext } from '/inventory/components/NewItemPage.js';
    mountNewItemPage({ $container, fields, defaults: { category: 'Paint' }, next: '/category?name=Paint' });
    mountEditItemPage({ $container, item, fields, context, next: '/items/' + item.id });   // item and context from getItem()

  After a save it goes to `next` (a path on this site) and that page shows "Added <name>" or "Saved <name>"
  (see flash.js). "Create and add another" starts a completely empty form instead (a pre-filled SKU, name or
  category is not carried over). `askQuantity` leaves out the starting-quantity box when adding.
*/

/* A path on this site, or the fallback: never another site's address (an open redirect). */
export const safeNext = (value, fallback) => (typeof value === 'string' && /^\/(?!\/|\\)/.test(value) ? value : fallback);

const FLASH_KEY = 'inventory.flash';

/* The message a page shows once, on the next page (see flash.js). */
const flash = message => {
  try { sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message })); } catch { /* the message is just not shown */ }
};

const mountItemPage = ({ $container, item = null, fields = [], defaults = {}, askQuantity = true, context, next = '/', cancelLabel = 'Cancel' } = {}) => {
  const editing = Boolean(item);
  const form = createItemForm({ item, fields, defaults, askQuantity, context });
  let leaving = false;
  let saving = false;

  /* The browser's own "Leave site? Changes you made may not be saved" prompt. */
  const warn = event => {
    if(leaving || !form.isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', warn);
  /* Anything else that wants to move the page (the offline redirect) asks first. */
  window.hasUnsavedInventoryWork = () => !leaving && form.isDirty();

  const go = href => {
    leaving = true;
    location.assign(href);
  };

  const submit = async again => {
    if(saving) return;
    saving = true;
    draw();
    const saved = await form.save();
    saving = false;
    if(!saved){ draw(); return; }
    flash(`${editing ? 'Saved' : 'Added'} ${saved.name}`);
    if(again){
      /*
        A fresh, empty form. The address is what pre-filled the last one (a scanned SKU, a name, the
        category), so those come out of it; where to go when finished (next) stays.
      */
      const params = new URLSearchParams(location.search);
      for(const key of ['sku', 'name', 'category', 'quantity']) params.delete(key);
      go(location.pathname + (params.size ? '?' + params : ''));
    } else {
      go(next);
    }
  };

  const cancel = () => {
    if(!form.isDirty()){ go(next); return; }
    Dialog.confirm('Discard what you have entered? It will be lost.', confirmed => { if(confirmed) go(next); });
  };

  const $actions = document.createElement('div');
  $actions.className = 'd-f mt-lg';
  $actions.style.cssText = 'gap: var(--spacer_h); flex-wrap: wrap;';
  const draw = () => render(html`
    <button type="button" class="btn success" id="saveItem" ?disabled=${saving} @click=${() => submit(false)}>${saving ? 'Saving…' : editing ? 'Save' : 'Create item'}</button>
    ${editing ? '' : html`<button type="button" class="btn" id="saveAnother" ?disabled=${saving} @click=${() => submit(true)}>Create and add another</button>`}
    <button type="button" class="btn" id="cancelItem" ?disabled=${saving} @click=${cancel}>${cancelLabel}</button>`, $actions);
  draw();

  $container.replaceChildren(form.$root, $actions);
  return { form, go };
};

export const mountNewItemPage = options => mountItemPage({ ...options, item: null });

export const mountEditItemPage = ({ item, ...options } = {}) => mountItemPage({ ...options, item });
