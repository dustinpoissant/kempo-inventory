import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFieldDefinition, coerceValue, coerceValues, keyFromLabel, parseMediaId, filesId } from '../server/utils/fieldTypes.js';

const field = (type, extra = {}) => ({ key: 'f', label: 'F', type, required: false, options: [], ...extra });

test('keyFromLabel builds camelCase keys', () => {
  assert.equal(keyFromLabel('Reorder level'), 'reorderLevel');
  assert.equal(keyFromLabel('  Manufacturer  '), 'manufacturer');
  assert.equal(keyFromLabel('Unit cost ($)'), 'unitCost');
  assert.equal(keyFromLabel('123'), '');
});

test('field definitions are validated', () => {
  assert.equal(normalizeFieldDefinition({ label: 'Maker', type: 'text' })[1].key, 'maker');
  assert.equal(normalizeFieldDefinition({ type: 'text' })[0].code, 400);
  assert.equal(normalizeFieldDefinition({ label: 'X', type: 'nope' })[0].code, 400);
  assert.equal(normalizeFieldDefinition({ label: 'Name', key: 'name', type: 'text' })[0].code, 400, 'core keys are reserved');
  assert.equal(normalizeFieldDefinition({ label: 'X', key: 'Bad-Key', type: 'text' })[0].code, 400);
  assert.equal(normalizeFieldDefinition({ label: 'Size', type: 'select' })[0].code, 400, 'select needs options');
  const [, select] = normalizeFieldDefinition({ label: 'Size', type: 'select', options: [' S ', 'M', 'S', ''] });
  assert.deepEqual(select.options, ['S', 'M']);
  assert.deepEqual(normalizeFieldDefinition({ label: 'Maker', type: 'text', options: ['x'] })[1].options, []);
});

test('values are coerced per type', () => {
  assert.deepEqual(coerceValue(field('number'), '4.5'), [null, 4.5]);
  assert.equal(coerceValue(field('number'), 'abc')[0].code, 400);
  assert.deepEqual(coerceValue(field('boolean'), 'true'), [null, true]);
  assert.deepEqual(coerceValue(field('boolean'), false), [null, false]);
  assert.deepEqual(coerceValue(field('date'), '2026-02-28'), [null, '2026-02-28']);
  assert.equal(coerceValue(field('date'), '2026-02-30')[0].code, 400);
  assert.equal(coerceValue(field('date'), 'tomorrow')[0].code, 400);
  assert.deepEqual(coerceValue(field('select', { options: ['a', 'b'] }), 'a'), [null, 'a']);
  assert.equal(coerceValue(field('select', { options: ['a', 'b'] }), 'c')[0].code, 400);
  assert.equal(coerceValue(field('item'), 'not-an-id')[0].code, 400);
  assert.deepEqual(coerceValue(field('item'), '0123456789abcdef'), [null, '0123456789abcdef']);
  assert.deepEqual(coerceValue(field('text'), ''), [null, null]);
  assert.equal(coerceValue(field('text'), 'x'.repeat(1001))[0].code, 400);
});

test('media values are a de-duplicated list of ids', () => {
  const media = field('media');
  const a = '0123456789abcdef';
  const b = 'fedcba9876543210';
  assert.deepEqual(coerceValue(media, [a, b, a]), [null, [a, b]]);
  assert.deepEqual(coerceValue(media, `${a}, ${b}`), [null, [a, b]], 'a comma-separated string is accepted');
  assert.deepEqual(coerceValue(media, []), [null, null], 'an empty list clears the field');
  assert.equal(coerceValue(media, ['nope'])[0].code, 400);
  assert.equal(coerceValue(media, Array.from({ length: 21 }, (_, i) => i.toString(16).padStart(16, '0')))[0].code, 400, 'capped at 20 files');
  assert.equal(normalizeFieldDefinition({ label: 'Photos', type: 'media' })[1].type, 'media');
});

test('media ids say which library they live in', () => {
  const a = '0123456789abcdef';
  assert.deepEqual(parseMediaId(a), { provider: 'media', rawId: a }, 'a bare id is a kempo-media asset');
  assert.deepEqual(parseMediaId(filesId(a)), { provider: 'files', rawId: a });
  assert.equal(filesId(a), `files:${a}`);
  assert.deepEqual(coerceValue(field('media'), [a, filesId(a)]), [null, [a, `files:${a}`]], 'the same id in two libraries is two different files');
  assert.equal(coerceValue(field('media'), ['files:nope'])[0].code, 400);
  assert.equal(coerceValue(field('media'), [`other:${a}`])[0].code, 400, 'unknown libraries are refused');
});

test('creating requires required fields, updating only checks what is supplied', () => {
  const fields = [field('text', { key: 'maker', label: 'Maker', required: true }), field('number', { key: 'cost', label: 'Cost' })];
  assert.equal(coerceValues(fields, {})[0].msg, 'Maker is required');
  assert.deepEqual(coerceValues(fields, { maker: 'Acme', cost: '3' })[1], { maker: 'Acme', cost: 3 });
  assert.deepEqual(coerceValues(fields, { cost: '3' }, { partial: true })[1], { cost: 3 });
  assert.equal(coerceValues(fields, { maker: '' }, { partial: true })[0].msg, 'Maker is required', 'cannot clear a required field');
  assert.deepEqual(coerceValues(fields, { maker: 'A', cost: '' })[1], { maker: 'A', cost: null }, 'empty clears an optional value');
});

test('unknown field keys are rejected', () => {
  assert.equal(coerceValues([field('text')], { nope: 1 })[0].msg, 'Unknown field "nope"');
  assert.equal(coerceValues([field('text')], [])[0].code, 400);
});

test('only type changes that cannot lose data are allowed', async () => {
  const { canConvert } = await import('../server/utils/fieldTypes.js');
  assert.equal(canConvert('select', 'text'), true, 'a choice list can become free text');
  assert.equal(canConvert('text', 'longtext'), true);
  assert.equal(canConvert('text', 'text'), true, 'staying the same is fine');
  assert.equal(canConvert('text', 'select'), false, 'values might not be among the choices');
  assert.equal(canConvert('text', 'number'), false);
  assert.equal(canConvert('longtext', 'text'), false, 'could be cut short');
  assert.equal(canConvert('number', 'text'), false);
  assert.equal(canConvert('media', 'text'), false);
});

test('an item shows the default fields plus those of its own category', async () => {
  const { applicableFields } = await import('../server/utils/fieldTypes.js');
  const fields = [
    { key: 'brand', category: '' },
    { key: 'finish', category: 'paint' },
    { key: 'diameter', category: 'filament' },
  ];
  assert.deepEqual(applicableFields(fields, 'Paint').map(f => f.key), ['brand', 'finish']);
  assert.deepEqual(applicableFields(fields, '  paint ').map(f => f.key), ['brand', 'finish']);
  assert.deepEqual(applicableFields(fields, '').map(f => f.key), ['brand']);
  assert.deepEqual(applicableFields(fields, 'Tools').map(f => f.key), ['brand']);
});

test('image aspect ratios are parsed and fall back to the default', async () => {
  const { parseRatio, resolveRatio } = await import('../server/utils/ratio.js');
  assert.equal(parseRatio('16:9'), '16 / 9');
  assert.equal(parseRatio(' 4 / 3 '), '4 / 3');
  assert.equal(parseRatio('1.5'), '1.5 / 1');
  for(const bad of ['', 'wide', '0:1', '1:0', '100:1', '4:3:2', null]) assert.equal(parseRatio(bad), null, String(bad));
  assert.equal(resolveRatio('nonsense', 'category'), '4 / 3');
  assert.equal(resolveRatio('1:1', 'item'), '1 / 1');
});

test('color fields hold a hex colour', () => {
  assert.deepEqual(coerceValue(field('color'), '#FF8800'), [null, '#ff8800']);
  assert.deepEqual(coerceValue(field('color'), '#f80'), [null, '#ff8800']);
  assert.deepEqual(coerceValue(field('color'), '#ff880080'), [null, '#ff880080']);
  assert.deepEqual(coerceValue(field('color'), '#ff8800ff'), [null, '#ff8800'], 'fully opaque is stored without alpha');
  assert.deepEqual(coerceValue(field('color'), ''), [null, null]);
  assert.deepEqual(coerceValue(field('color'), '#f808'), [null, '#ff880088']);
  for(const bad of ['red', 'ff8800', '#ff880', '#gg0000', 'rgb(1,2,3)']) assert.equal(coerceValue(field('color'), bad)[0]?.code, 400, bad);
  assert.equal(normalizeFieldDefinition({ label: 'Shade', type: 'color' })[0], null);
});

test('tags are tidied, de-duplicated and limited', async () => {
  const { normalizeTags, parseTagParam, countTags, MAX_TAG, MAX_TAGS } = await import('../server/utils/tags.js');
  assert.deepEqual(normalizeTags('Acrylic, RED,  red , Water-Based,'), [null, ['acrylic', 'red', 'water-based']]);
  assert.deepEqual(normalizeTags(['  Matte ', 'matte', '', 'Very   Shiny']), [null, ['matte', 'very shiny']]);
  assert.deepEqual(normalizeTags(undefined), [null, []]);
  assert.equal(normalizeTags('x'.repeat(MAX_TAG + 1))[0].code, 400);
  assert.equal(normalizeTags(Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`))[0].code, 400);
  assert.equal(normalizeTags([1])[0].code, 400);
  assert.equal(normalizeTags({})[0].code, 400);
  assert.deepEqual(parseTagParam('Red'), ['red']);
  assert.deepEqual(parseTagParam('["Red","matte"]'), ['red', 'matte']);
  assert.deepEqual(parseTagParam(['A', ' b ']), ['a', 'b']);
  assert.deepEqual(parseTagParam(''), []);
  assert.deepEqual(countTags([['a', 'b'], ['a'], ['a', 'a']]), [{ tag: 'a', count: 3 }, { tag: 'b', count: 1 }]);
});

test('photo fields can force a shape and a maximum size', () => {
  const make = extra => normalizeFieldDefinition({ label: 'Photos', type: 'media', ...extra });
  assert.deepEqual([make({})[1].imageRatio, make({})[1].imageMax], ['', 0]);
  assert.equal(make({ imageRatio: '1:1' })[1].imageRatio, '1 / 1');
  assert.equal(make({ imageRatio: ' 16 / 9 ' })[1].imageRatio, '16 / 9');
  assert.equal(make({ imageRatio: '1.5' })[1].imageRatio, '1.5 / 1');
  assert.equal(make({ imageMax: '1600' })[1].imageMax, 1600);
  for(const bad of ['wide', '0:1', '100:1']) assert.equal(make({ imageRatio: bad })[0].code, 400, bad);
  for(const bad of [-1, 5, 9000, 1.5, 'big']) assert.equal(make({ imageMax: bad })[0].code, 400, String(bad));
  /* other types ignore both */
  assert.deepEqual([normalizeFieldDefinition({ label: 'Maker', type: 'text', imageRatio: '1:1', imageMax: 500 })[1].imageRatio, normalizeFieldDefinition({ label: 'Maker', type: 'text', imageMax: 500 })[1].imageMax], ['', 0]);
});

test('rating fields hold 1 to 5 stars, and no stars is no rating', () => {
  assert.deepEqual(coerceValue(field('rating'), 4), [null, 4]);
  assert.deepEqual(coerceValue(field('rating'), '5'), [null, 5]);
  assert.deepEqual(coerceValue(field('rating'), 0), [null, null], 'no stars clears it');
  assert.deepEqual(coerceValue(field('rating'), ''), [null, null]);
  for(const bad of [6, -1, 2.5, 'lots', '3 stars']) assert.equal(coerceValue(field('rating'), bad)[0]?.code, 400, String(bad));
  assert.equal(normalizeFieldDefinition({ label: 'Opacity', type: 'rating' })[0], null);
});

test('a zip built for an export is read back, stored or deflated', async () => {
  const { buildZip, crc32 } = await import('../server/utils/zip.js');
  const { readZip } = await import('../server/utils/zipRead.js');
  const { deflateRawSync } = await import('node:zlib');
  const text = JSON.stringify({ hello: 'wörld', items: [1, 2, 3] });
  const photo = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 256);
  const zip = await readZip(buildZip([{ name: 'inventory.json', data: Buffer.from(text) }, { name: 'media/1-photo é.jpg', data: photo }]));
  assert.deepEqual(zip.names, ['inventory.json', 'media/1-photo é.jpg']);
  assert.equal(await zip.text('inventory.json'), text);
  assert.deepEqual([...await zip.read('media/1-photo é.jpg')], [...photo]);
  assert.equal(await zip.read('missing.txt'), null);
  assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926, 'the standard CRC-32 check value');

  /* A zip some other tool made, with deflate, is read too: build one by hand around deflated data. */
  const stored = buildZip([{ name: 'a.txt', data: Buffer.from('hello hello hello hello') }]);
  const data = Buffer.from('hello hello hello hello');
  const deflated = deflateRawSync(data);
  const patched = Buffer.from(stored);
  const localSize = 30 + 5;
  const replacement = Buffer.concat([patched.subarray(0, localSize), deflated, patched.subarray(localSize + data.length)]);
  replacement.writeUInt16LE(8, 8);                        // local method
  replacement.writeUInt32LE(deflated.length, 18);        // local compressed size
  const delta = deflated.length - data.length;
  const central = localSize + deflated.length;
  replacement.writeUInt16LE(8, central + 10);            // central method
  replacement.writeUInt32LE(deflated.length, central + 20);
  replacement.writeUInt32LE(replacement.readUInt32LE(replacement.length - 22 + 16) + delta, replacement.length - 22 + 16);
  assert.equal(await (await readZip(replacement)).text('a.txt'), 'hello hello hello hello');
  await assert.rejects(readZip(Buffer.from('not a zip at all')), /not a zip/);
});

test('a zip entry that inflates past the limit is refused', async () => {
  const { buildZip } = await import('../server/utils/zip.js');
  const { readZip } = await import('../server/utils/zipRead.js');
  const { deflateRawSync } = await import('node:zlib');
  /* 1 MB of zeros deflates to about 1 KB: a small entry that inflates to something big. */
  const big = Buffer.alloc(1024 * 1024);
  const deflated = deflateRawSync(big);
  const stored = buildZip([{ name: 'bomb.bin', data: big.subarray(0, 3) }]);
  const localSize = 30 + 'bomb.bin'.length;
  const patched = Buffer.concat([stored.subarray(0, localSize), deflated, stored.subarray(localSize + 3)]);
  patched.writeUInt16LE(8, 8);
  patched.writeUInt32LE(deflated.length, 18);
  const central = localSize + deflated.length;
  patched.writeUInt16LE(8, central + 10);
  patched.writeUInt32LE(deflated.length, central + 20);
  patched.writeUInt32LE(patched.readUInt32LE(patched.length - 22 + 16) + deflated.length - 3, patched.length - 22 + 16);
  assert.equal((await (await readZip(patched)).read('bomb.bin')).length, big.length, 'within the default limit it reads');
  await assert.rejects((await readZip(patched, { maxEntryBytes: 100000 })).read('bomb.bin'), /too large/);
});

test('a file is only accepted as media when its extension and its content agree', async () => {
  const { refuseMedia, safeFileName, extensionOf } = await import('../server/utils/mediaSafety.js');
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
  const jpg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0]);
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  assert.equal(refuseMedia('photo.png', png), null);
  assert.equal(refuseMedia('PHOTO.PNG', png), null, 'the extension is not case sensitive');
  assert.equal(refuseMedia('photo.jpeg', jpg), null);
  assert.match(refuseMedia('fake.png', html), /not a real \.png/, 'a web page named .png');
  assert.match(refuseMedia('photo.jpg', png), /not a real \.jpg/, 'a png named .jpg');
  for(const name of ['page.html', 'run.js', 'setup.exe', 'icon.svg', 'archive.zip', 'noextension', 'photo.png.exe']) assert.match(refuseMedia(name, png) ?? '', /not a photo/, name);
  assert.equal(refuseMedia('empty.png', Buffer.alloc(0)), 'empty');
  assert.equal(refuseMedia('doc.pdf', Buffer.from('%PDF-1.7 ...')), null);
  assert.equal(refuseMedia('clip.mp4', Buffer.from('\u0000\u0000\u0000\u0018ftypmp42')), null);
  assert.equal(extensionOf('a.b.PNG'), 'png');
  assert.equal(safeFileName('../../etc/pass wd?.png'), 'pass wd_.png');
  assert.equal(safeFileName('..\..\evil.png'), 'evil.png');
  assert.equal(safeFileName('...'), 'file');
  assert.ok(safeFileName('x'.repeat(500) + '.png').length <= 100);
});

test('text is stored without leading or trailing spaces, and spaces alone are no value', () => {
  assert.deepEqual(coerceValue(field('text'), '  FolkArt '), [null, 'FolkArt']);
  assert.deepEqual(coerceValue(field('text'), '\tApple Barrel\n'), [null, 'Apple Barrel']);
  assert.deepEqual(coerceValue(field('text'), 'two  inner   spaces'), [null, 'two  inner   spaces'], 'only the ends are trimmed');
  assert.deepEqual(coerceValue(field('text'), '   '), [null, null], 'whitespace only is empty');
  assert.deepEqual(coerceValue(field('longtext'), '\n  A paragraph.\n\nAnother.  \n'), [null, 'A paragraph.\n\nAnother.']);
  assert.deepEqual(coerceValue(field('longtext'), '  '), [null, null]);
  assert.deepEqual(coerceValue(field('select', { options: ['Matte', 'Gloss'] }), ' Matte '), [null, 'Matte'], 'a choice with stray spaces still matches');
  assert.equal(coerceValue(field('select', { options: ['Matte'] }), ' Other ')[0].code, 400);
  assert.equal(coerceValues([field('text', { required: true, label: 'Brand' })], { f: '   ' })[0].code, 400, 'a required field with only spaces is missing');
});
