import { html } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import Dialog from '/kempo-ui/components/Dialog.js';
import '/kempo-ui/components/ImageCrop.js';

/*
  Forces the shape and size of photos as they are added, with Kempo UI's <k-image-crop>.

    import { prepareImages } from '/inventory/components/ImageCropDialog.js';
    const files = await prepareImages(chosenFiles, { ratio: '1 / 1', max: 1600 });   // what to upload

  - With a `ratio` each photo opens in a cropper locked to that shape, so only that shape can be
    saved. "Skip" leaves the photo out. The result is also kept within `max` pixels.
  - With only a `max`, photos are scaled down to fit, silently.
  - With neither, the files are returned untouched.

  Files that are not a still image the browser can edit (GIF, SVG, HEIC, video...) are returned as they
  are: nothing can be cropped there.
*/

const EDITABLE = /^image\/(jpeg|png|webp|bmp)$/;
const OUTPUT_TYPES = { 'image/jpeg': 'image/jpeg', 'image/webp': 'image/webp' };   // anything else is saved as PNG
const EXTENSIONS = { 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/png': '.png' };

/* Scales a photo down so neither side is bigger than `max` (it is never scaled up). */
const shrink = async (file, max) => {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  if(scale === 1){
    bitmap.close?.();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const type = OUTPUT_TYPES[file.type] ?? 'image/png';
  const blob = await new Promise(done => canvas.toBlob(done, type, 0.92));
  return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '') + EXTENSIONS[type], { type }) : file;
};

/* Opens one photo in a cropper locked to `ratio`. Resolves to the cropped File, the original if the browser cannot read it, or null if skipped. */
const crop = (file, ratio, max, { index, total }) => new Promise(resolve => {
  let settled = false;
  const finish = value => {
    if(settled) return;
    settled = true;
    resolve(value);
  };

  const $dialog = Dialog.create(html`
    <div class="p" style="max-height: calc(100vh - 14rem); overflow-y: auto;">
      <p class="tc-muted mb">Drag the box to choose what to keep. It is locked to the shape this photo is saved in.</p>
      <k-image-crop id="inventory-crop" aspect-ratio=${ratio} max-width=${max || 0} max-height=${max || 0}
        type=${OUTPUT_TYPES[file.type] ?? 'image/png'} quality="0.92" label="Choose another photo"
        @error=${() => { Toast.error(`${file.name} could not be opened, so it is uploaded as it is`); finish(file); $dialog.close(); }}></k-image-crop>
    </div>
  `, {
    title: total > 1 ? `Crop photo ${index + 1} of ${total}` : 'Crop photo',
    confirmText: 'Use photo',
    cancelText: 'Skip',
    closeExisting: false,   // the form this photo is being added to stays open underneath
    confirmAction: async event => {
      event.keepDialogOpen = true;
      const $crop = $dialog.querySelector('#inventory-crop');
      finish(await $crop.toFile() ?? null);
      $dialog.close();
    },
    closeCallback: () => finish(null),
  });

  customElements.whenDefined('k-image-crop').then(() => $dialog.querySelector('#inventory-crop')?.loadImage(file));
});

export const prepareImages = async (files, { ratio = '', max = 0 } = {}) => {
  const prepared = [];
  for(const [index, file] of files.entries()){
    if(!EDITABLE.test(file.type) || (!ratio && !max)){
      prepared.push(file);
    } else if(!ratio){
      prepared.push(await shrink(file, max));
    } else {
      const result = await crop(file, ratio, max, { index, total: files.length });
      if(result) prepared.push(result);   // null: skipped
    }
  }
  return prepared;
};
