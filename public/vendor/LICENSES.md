# Vendored libraries

Bundled copies, so the barcode scanner works without loading anything from a CDN at runtime.

| File | Package | Licence |
|---|---|---|
| zxing-browser.js | `@zxing/browser` 0.1.5 | MIT |
| zxing-library.js | `@zxing/library` 0.21.0 | MIT |
| ts-custom-error.js | `ts-custom-error` 3.3.1 | MIT |

They are the jsDelivr `+esm` builds of those packages, with their imports rewritten to point at each
other. To update, download the new `+esm` builds and repeat that rewrite.
