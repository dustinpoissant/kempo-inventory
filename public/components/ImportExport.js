import { html, render } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import Dialog from '/kempo-ui/components/Dialog.js';
import '/kempo-ui/components/Spinner.js';
import { exportUrl, previewImport, applyImport } from '/inventory/sdk.js';

/*
  The admin's import and export dialogs (top tier only: the server enforces it, the buttons only follow).

    import { openExportDialog, openImportDialog } from '/inventory/components/ImportExport.js';
    openExportDialog();
    openImportDialog({ onDone: () => reload() });

  Two kinds of export, both read by the import:
    - Data only (.json): items, categories and tags, without any photos.
    - With media (.zip): the same data (inventory.json) plus every photo and file (media/).
  See server/utils/importExport.js for exactly what an export holds.
*/

/* ---------- export ---------- */
export const openExportDialog = () => {
  let kind = 'json';
  const draw = () => render(html`
    <p class="mb">Download the whole inventory: every item and category with its tags and field values.</p>
    <label class="d-f mb" style="gap: var(--spacer_h); align-items: flex-start; cursor: pointer;">
      <input type="radio" name="exportKind" value="json" ?checked=${kind === 'json'} @change=${() => { kind = 'json'; }}>
      <span><strong>Data only</strong> (.json)<br><small class="tc-muted">Items, categories, tags and field values. No photos, so it is small and easy to read.</small></span>
    </label>
    <label class="d-f mb" style="gap: var(--spacer_h); align-items: flex-start; cursor: pointer;">
      <input type="radio" name="exportKind" value="zip" ?checked=${kind === 'zip'} @change=${() => { kind = 'zip'; }}>
      <span><strong>With media</strong> (.zip)<br><small class="tc-muted">The same data plus every photo and file, in one zip. Importing it brings the photos back.</small></span>
    </label>`, $body);

  const $body = document.createElement('div');
  $body.className = 'p';
  draw();

  const $dialog = Dialog.create($body, {
    title: 'Export inventory',
    confirmText: 'Download',
    cancelText: 'Cancel',
    confirmAction: async event => {
      event.keepDialogOpen = true;
      const response = await fetch(exportUrl(kind), { credentials: 'same-origin' }).catch(() => null);
      if(!response?.ok){
        const body = await response?.json().catch(() => ({}));
        Toast.error(body?.error || 'The export failed');
        return;
      }
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? `inventory.${kind}`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      const missing = Number(response.headers.get('X-Missing-Media') ?? 0);
      if(missing) Toast.warning(`${missing} photo${missing === 1 ? ' was' : 's were'} missing from the library and left out`);
      $dialog.close();
    },
  });
  return $dialog;
};

/* ---------- import ---------- */

/*
  The file is uploaded as it is to the server, which checks it (preview), keeps it, and later does the import
  (apply). The server opens zips and stores their photos; this page never reads a zip.
*/
export const openImportDialog = ({ onDone = () => {} } = {}) => {
  const state = {
    phase: 'choose',       // choose -> checking -> review -> importing -> done
    fileName: '',
    preview: null,         // the server's report on the file, with its importId
    onMatch: 'skip',
    report: null,
    error: '',
  };

  const $body = document.createElement('div');
  $body.className = 'p';
  $body.style.cssText = 'max-height: calc(100vh - 14rem); overflow-y: auto;';

  const problemList = results => {
    const list = results.filter(r => r.action === 'error');
    return list.length ? html`
      <p class="mt mb-sm tc-danger"><strong>${list.length} problem${list.length === 1 ? '' : 's'}</strong>: these rows will not be imported.</p>
      <ul class="mb" style="max-height: 9rem; overflow-y: auto; padding-left: 1.2rem;">
        ${list.slice(0, 50).map(r => html`<li><small>Row ${r.row}${r.sku || r.name ? html` (${r.sku || r.name})` : ''}: ${r.message}</small></li>`)}
        ${list.length > 50 ? html`<li><small>…and ${list.length - 50} more</small></li>` : ''}
      </ul>` : '';
  };

  const draw = () => {
    const preview = state.preview;
    const summary = preview?.summary;
    render(html`
      ${state.error ? html`<p class="tc-danger mb">${state.error}</p>` : ''}
      ${state.phase === 'choose' || state.phase === 'checking' ? html`
        <p class="mb">Choose an export: a <strong>.json</strong> file (data only) or a <strong>.zip</strong> (data with photos), both made by <strong>Export</strong>.</p>
        <input type="file" id="importFile" accept=".json,.zip,application/json,application/zip" class="full" @change=${choose} ?disabled=${state.phase === 'checking'}>
        ${state.phase === 'checking' ? html`<p class="mt tc-muted"><k-spinner size="sm"></k-spinner> Uploading and checking ${state.fileName}…</p>` : ''}
        <p class="mt tc-muted"><small>The file is checked on the server, which only accepts it from the top permission tier. Fields are not created or changed by an import: a value only comes across when a field with the same key exists here. Photos come across only from a zip, and only real photo, video, audio and PDF files.</small></p>` : ''}
      ${state.phase === 'review' ? html`
        <p class="mb"><strong>${state.fileName}</strong>: ${preview.counts.items} item${preview.counts.items === 1 ? '' : 's'}${preview.counts.categories ? html` and ${preview.counts.categories} categor${preview.counts.categories === 1 ? 'y' : 'ies'}` : ''}${preview.withMedia ? html` with ${preview.mediaFiles} photo${preview.mediaFiles === 1 ? '' : 's'}` : ', no photos'}.</p>
        <ul class="mb">
          <li><strong>${summary.created}</strong> new item${summary.created === 1 ? '' : 's'}</li>
          <li><strong>${summary.updated}</strong> already ${summary.updated === 1 ? 'exists' : 'exist'} (same SKU)</li>
          ${preview.counts.categories ? html`<li><strong>${summary.categoriesCreated}</strong> new categor${summary.categoriesCreated === 1 ? 'y' : 'ies'}, <strong>${summary.categoriesUpdated}</strong> already ${summary.categoriesUpdated === 1 ? 'exists' : 'exist'}</li>` : ''}
          ${summary.ignoredValues ? html`<li class="tc-muted">${summary.ignoredValues} value${summary.ignoredValues === 1 ? '' : 's'} for fields that do not exist here (or do not apply to the item's category) will be ignored</li>` : ''}
        </ul>
        ${summary.updated + summary.categoriesUpdated > 0 ? html`
          <p class="mb-sm"><strong>For the ones that already exist:</strong></p>
          <label class="d-f mb-sm" style="gap: var(--spacer_h); align-items: flex-start; cursor: pointer;">
            <input type="radio" name="onMatch" value="skip" ?checked=${state.onMatch === 'skip'} @change=${() => { state.onMatch = 'skip'; draw(); }}>
            <span><strong>Ignore them</strong><br><small class="tc-muted">Leave what is already here exactly as it is. Only the new ones are added.</small></span>
          </label>
          <label class="d-f mb" style="gap: var(--spacer_h); align-items: flex-start; cursor: pointer;">
            <input type="radio" name="onMatch" value="update" ?checked=${state.onMatch === 'update'} @change=${() => { state.onMatch = 'update'; draw(); }}>
            <span><strong>Update them</strong> with the values in the file<br><small class="tc-muted">A value the file leaves empty never clears anything. A changed quantity is recorded as a stock adjustment.</small></span>
          </label>` : ''}
        ${problemList(preview.results)}` : ''}
      ${state.phase === 'importing' ? html`<p><k-spinner size="sm"></k-spinner> Importing. With photos this can take a while; keep this window open.</p>` : ''}
      ${state.phase === 'done' ? html`
        <p class="mb"><strong>Import finished.</strong></p>
        <ul class="mb">
          <li><strong>${state.report.summary.created}</strong> added</li>
          <li><strong>${state.report.summary.updated}</strong> updated</li>
          <li><strong>${state.report.summary.skipped}</strong> ignored (already existed)</li>
          ${state.report.summary.categoriesCreated + state.report.summary.categoriesUpdated ? html`<li><strong>${state.report.summary.categoriesCreated}</strong> categories added, <strong>${state.report.summary.categoriesUpdated}</strong> updated</li>` : ''}
          ${state.report.uploaded ? html`<li><strong>${state.report.uploaded}</strong> photo${state.report.uploaded === 1 ? '' : 's'} uploaded</li>` : ''}
          ${state.report.skippedFiles?.length ? html`<li class="tc-danger">${state.report.skippedFiles.length} file${state.report.skippedFiles.length === 1 ? '' : 's'} not uploaded: <small>${state.report.skippedFiles.slice(0, 5).map(file => `${file.name} (${file.reason})`).join(', ')}</small></li>` : ''}
        </ul>
        ${problemList(state.report.results)}` : ''}
    `, $body);
  };

  const choose = async event => {
    const [file] = event.target.files;
    if(!file) return;
    state.error = '';
    state.fileName = file.name;
    state.phase = 'checking';
    draw();
    const [error, preview] = await previewImport(file);
    if(error){
      state.error = error.msg || 'The file could not be checked';
      state.phase = 'choose';
      draw();
      return;
    }
    state.preview = preview;
    state.onMatch = 'skip';
    state.phase = 'review';
    draw();
  };

  const run = async () => {
    state.phase = 'importing';
    draw();
    $dialog.confirmText = '…';
    const [error, report] = await applyImport(state.preview.importId, state.onMatch);
    if(error){
      state.error = error.msg || 'The import failed';
      state.phase = error.code === 404 ? 'choose' : 'review';
      $dialog.confirmText = 'Import';
      draw();
      return;
    }
    state.report = report;
    state.phase = 'done';
    $dialog.confirmText = 'Close';
    draw();
    onDone(report);
  };

  draw();
  const $dialog = Dialog.create($body, {
    title: 'Import inventory',
    confirmText: 'Import',
    cancelText: 'Cancel',
    confirmAction: async event => {
      event.keepDialogOpen = true;
      if(state.phase === 'done'){ $dialog.close(); return; }
      if(state.phase !== 'review'){
        Toast.error(state.phase === 'choose' ? 'Choose a file first' : 'Please wait');
        return;
      }
      await run();
    },
  });
  return $dialog;
};
