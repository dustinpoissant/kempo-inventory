import Dialog from '/kempo-ui/components/Dialog.js';

/*
  Scan barcodes with the device's camera. Two ways in:

    import { scanBarcode, startScanner } from '/inventory/components/BarcodeScanner.js';

    const code = await scanBarcode();                 // a dialog; the code's text, or null if cancelled

    const scanner = await startScanner({ video, onCode: code => ... });   // your own <video>, keeps going
    scanner.setPaused(true);                          // ignore codes for a while (e.g. a form is open)
    scanner.stop();                                   // release the camera

  Uses the browser's own BarcodeDetector where it exists (Chrome on Android), which is fast and
  needs no code of ours. Everywhere else (iPhone, Firefox, most desktops) it falls back to ZXing,
  bundled in /inventory/vendor/ so nothing is loaded from a CDN.

  Cameras are only available to pages served over HTTPS (or from localhost), so on a plain-http
  address this explains why rather than failing silently.
*/

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'codabar', 'itf', 'qr_code', 'data_matrix', 'pdf417', 'aztec'];

const CONSTRAINTS = { video: { facingMode: { ideal: 'environment' } }, audio: false };

/*
  How long a code has to be out of view before it counts as a new scan. Long enough that a code
  flickering in and out of focus is not read twice, short enough that picking up the next bottle
  of the same paint is.
*/
const GAP_MS = 700;

const POLL_MS = 120;

/*
  Why the camera cannot be used here, as a sentence for the user, or null when it can.
*/
export const cameraProblem = () => {
  if(!window.isSecureContext){
    return 'The camera only works on secure (https) pages. Open this site over https, or from localhost.';
  }
  if(!navigator.mediaDevices?.getUserMedia) return 'This browser cannot access a camera.';
  return null;
};

export const explainCameraError = error => {
  if(error?.name === 'NotAllowedError') return 'Camera access was blocked. Allow the camera for this site in the browser settings, then try again.';
  if(error?.name === 'NotFoundError') return 'No camera was found on this device.';
  if(error?.name === 'NotReadableError') return 'The camera is in use by another app.';
  return error?.message ? `Could not start the camera: ${error.message}` : 'Could not start the camera.';
};

/*
  The native detector, or null when this browser has none or supports none of our formats.
*/
const nativeDetector = async () => {
  if(!('BarcodeDetector' in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = FORMATS.filter(format => supported.includes(format));
    return formats.length ? new window.BarcodeDetector({ formats }) : null;
  } catch {
    return null;
  }
};

/*
  Starts the camera in `video` and calls `onCode(text)` once each time a code comes into view. The
  same code is not reported again until it has been out of view for a moment, so holding a bottle
  still gives one scan, and scanning the next bottle of the same paint gives another.

  Rejects (with the underlying camera error, or an Error carrying a sentence for the user) if the
  camera cannot be started. Resolves to { stop, setPaused }.
*/
export const startScanner = async ({ video, onCode }) => {
  const problem = cameraProblem();
  if(problem) throw new Error(problem);

  video.setAttribute('playsinline', '');
  video.muted = true;
  video.autoplay = true;

  let stopped = false;
  let paused = false;
  let armed = true;
  let lastSeen = 0;
  let stopCamera = () => {};

  /* `text` is the code in view this frame, or null when there is none. */
  const frame = text => {
    if(stopped) return;
    const now = performance.now();
    if(text){
      lastSeen = now;
      if(armed && !paused){
        armed = false;
        onCode(text);
      }
    } else if(now - lastSeen > GAP_MS){
      armed = true;
    }
  };

  const detector = await nativeDetector();

  if(detector){
    const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    stopCamera = () => stream.getTracks().forEach(track => track.stop());
    video.srcObject = stream;
    await video.play();
    const look = async () => {
      if(stopped) return;
      try {
        const [found] = await detector.detect(video);
        frame(found?.rawValue ?? null);
      } catch {
        frame(null);   // a frame that cannot be read is just a frame without a code in it
      }
      setTimeout(look, POLL_MS);
    };
    look();
  } else {
    const { BrowserMultiFormatReader } = await import('/inventory/vendor/zxing-browser.js');
    const controls = await new BrowserMultiFormatReader().decodeFromConstraints(CONSTRAINTS, video, result => {
      frame(result ? result.getText() : null);
    });
    stopCamera = () => controls.stop();
  }

  return {
    stop(){
      stopped = true;
      stopCamera();
    },
    /*
      Resuming does not re-fire a code that is still in view: it has to leave and come back, which
      is what stops a result being dismissed and then immediately scanned again.
    */
    setPaused(value){
      paused = value;
      if(!value) armed = false;
    },
  };
};

/*
  A one-shot scan in a dialog: resolves to the code's text, or null if cancelled.
*/
export const scanBarcode = ({ title = 'Scan a barcode' } = {}) => new Promise(resolve => {
  let finished = false;
  let scanner = null;

  const $video = document.createElement('video');
  $video.style.cssText = 'width: 100%; max-height: 55vh; background: #000; border-radius: var(--radius);';

  const $status = document.createElement('p');
  $status.className = 'tc-muted mt';
  $status.textContent = 'Starting the camera…';

  const $content = document.createElement('div');
  $content.className = 'p';
  $content.append($video, $status);

  const finish = value => {
    if(finished) return;
    finished = true;
    scanner?.stop();
    if(value) navigator.vibrate?.(60);
    $dialog.close();
    resolve(value);
  };

  /*
    closeExisting: false, because this is usually opened from inside another dialog (the item
    form), which Dialog.create would otherwise close.
  */
  const $dialog = Dialog.create($content, {
    title,
    cancelText: 'Cancel',
    closeExisting: false,
    closeCallback: () => finish(null),
  });

  startScanner({ video: $video, onCode: finish })
    .then(started => {
      if(finished){
        started.stop();   // closed before the camera finished starting
        return;
      }
      scanner = started;
      $status.textContent = 'Point the camera at a barcode';
    })
    .catch(error => {
      if(finished) return;
      $status.textContent = cameraProblem() ?? explainCameraError(error);
      $video.style.display = 'none';
    });
});
