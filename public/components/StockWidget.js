import DashboardWidget from '/kempo/components/DashboardWidget.js';
import { html, nothing } from '/kempo-ui/lit-all.min.js';
import { getItems, getMovements } from '/inventory/sdk.js';
const stat = (value, label, classes = '') => html`<div class="flex"><div class="h2 m0 ${classes}">${value}</div><div class="small tc-muted">${label}</div></div>`;

/*
  Stock at a glance. Unit and out-of-stock figures are shown only when the page fetched holds every
  item, so they are never an under-count.
*/
export default class StockWidget extends DashboardWidget {
  static properties = {
    ...DashboardWidget.properties,
    total: { state: true },
    units: { state: true },
    outOfStock: { state: true },
    movements: { state: true },
    names: { state: true }
  };

  constructor(){
    super();
    this.total = 0;
    this.units = null;
    this.outOfStock = null;
    this.movements = [];
    this.names = {};
    this.cta = { label: 'New item', icon: 'add', href: '/admin/extension/kempo-inventory/new', permission: 'kempo-inventory:items:create' };
  }

  /*
    Public Methods
  */

  load = async () => {
    const [items, movements] = await Promise.all([
      this.unwrap(getItems({ limit: 500 })),
      this.unwrap(getMovements({ limit: 9 }))
    ]);
    const complete = items.items.length >= items.total;
    this.total = items.total;
    this.units = complete ? items.items.reduce((sum, item) => sum + item.quantity, 0) : null;
    this.outOfStock = complete ? items.items.filter(item => item.quantity <= 0).length : null;
    this.names = Object.fromEntries(items.items.map(item => [item.id, item.name]));
    this.movements = movements.movements;
  };

  /*
    Rendering
  */

  renderContent(){
    if(!this.total) return html`<p class="tc-muted">No items yet.</p>`;
    return html`
      <div class="d-f mb">
        ${stat(this.total, 'Items')}
        ${stat(this.units ?? '\u2014', 'Units')}
        ${stat(this.outOfStock ?? '\u2014', 'Out of stock', this.outOfStock ? 'tc-danger' : '')}
      </div>
      ${this.movements.length ? html`<div class="small tc-muted mbq">Latest movements</div>` : nothing}
      ${this.movements.slice(0, this.height * 2).map(movement => html`
        <div class="d-f pyq bb">
          <span class="flex">${this.names[movement.itemId] || movement.itemId}</span>
          <strong class=${movement.delta < 0 ? 'tc-danger' : ''}>${movement.delta > 0 ? '+' : ''}${movement.delta}</strong>
          <span class="small tc-muted ml">${movement.reason}</span>
        </div>
      `)}
    `;
  }
}

customElements.define('k-inv-widget', StockWidget);
