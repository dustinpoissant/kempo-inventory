import ButtonControl from '/kempo-ui/components/controls/ButtonControl.js';
import { html } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Icon.js';

/*
  A labelled control for the table's top bar, drawn like the table's own controls. It reports its action as a
  `toolbarAction` event on the table: { action }. The page does the work.

    <k-inventory-toolbar-control action="export"><k-icon name="download"></k-icon> Export</k-inventory-toolbar-control>
*/
export default class ToolbarControl extends ButtonControl {
  static properties = {
    ...ButtonControl.properties,
    action: { type: String },
  };

  constructor(){
    super();
    this.action = '';
  }

  handleAction(){
    this.host?.dispatchEvent(new CustomEvent('toolbarAction', { detail: { action: this.action } }));
  }

  render(){
    return html`<slot></slot>`;
  }
}

customElements.define('k-inventory-toolbar-control', ToolbarControl);
