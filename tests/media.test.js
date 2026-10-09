import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseUploadProvider } from '../server/utils/media.js';

test('new uploads go to kempo-media whenever it is available, because it sits on kempo-files', () => {
  assert.equal(chooseUploadProvider({ media: true, files: true, thumbs: true }), 'media');
  assert.equal(chooseUploadProvider({ media: true, files: false, thumbs: false }), 'media');
});

test('without kempo-media they go to kempo-files, and with neither there is nowhere to upload', () => {
  assert.equal(chooseUploadProvider({ media: false, files: true, thumbs: true }), 'files');
  assert.equal(chooseUploadProvider({ media: false, files: true, thumbs: false }), 'files');
  assert.equal(chooseUploadProvider({ media: false, files: false, thumbs: false }), null);
});
