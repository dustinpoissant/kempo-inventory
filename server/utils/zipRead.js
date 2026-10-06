/*
  Reads a ZIP file on the server, for importing an inventory export that has its media with it. Only the
  import routes use it, and only after the caller has been checked against the top-tier permission. No dependencies: entries stored as they are, and entries compressed with deflate (what
  Windows, macOS and most tools produce when they re-zip a folder) are inflated with the built-in
  DecompressionStream.

    const zip = await readZip(await file.arrayBuffer());
    zip.names                              // ['inventory.json', 'media/1-photo.jpg', ...]
    await zip.read('inventory.json')       // Uint8Array, or null when there is no such entry
    await zip.text('inventory.json')       // the same, decoded as UTF-8

  Entries are only ever read into memory, looked up by the exact name asked for; nothing is written to disk
  and an entry's name is never used as a path. A deflated entry may inflate to at most `maxEntryBytes`
  (200 MB by default). Not supported: encrypted zips, zip64 and multi-disk archives. An unsupported zip throws an Error with
  a message fit to show a person.
*/

/*
  Inflates a deflated entry, giving up if it grows past `limit` bytes: a zip bomb is a tiny entry that
  inflates to gigabytes, and nothing in the zip's own headers can be trusted to say how big it is.
*/
const inflateRaw = async (bytes, limit) => {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  for(;;){
    const { done, value } = await reader.read();
    if(done) break;
    total += value.length;
    if(total > limit){
      await reader.cancel();
      throw new Error('A file in this zip is too large to read safely.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for(const chunk of chunks){ out.set(chunk, at); at += chunk.length; }
  return out;
};

export const MAX_ENTRY_BYTES = 200 * 1024 * 1024;

export const MAX_ENTRIES = 20000;

export const readZip = async (buffer, { maxEntryBytes = MAX_ENTRY_BYTES, maxEntries = MAX_ENTRIES } = {}) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  /* The end-of-central-directory record is somewhere in the last 64 KB. */
  let end = -1;
  for(let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--){
    if(view.getUint32(i, true) === 0x06054b50){ end = i; break; }
  }
  if(end < 0) throw new Error('This is not a zip file.');
  const count = view.getUint16(end + 10, true);
  let pointer = view.getUint32(end + 16, true);
  if(count === 0xFFFF || pointer === 0xFFFFFFFF) throw new Error('Zip64 archives are not supported.');
  if(count > maxEntries) throw new Error(`This zip has more than ${maxEntries} files.`);

  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  for(let n = 0; n < count; n++){
    if(view.getUint32(pointer, true) !== 0x02014b50) throw new Error('The zip file is damaged.');
    const flags = view.getUint16(pointer + 8, true);
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    if(flags & 1) throw new Error('Encrypted zip files are not supported.');
    if(!name.endsWith('/')) entries.set(name, { method, compressedSize, localOffset });
    pointer += 46 + nameLength + extraLength + commentLength;
  }

  const read = async name => {
    const entry = entries.get(name);
    if(!entry) return null;
    const at = entry.localOffset;
    if(view.getUint32(at, true) !== 0x04034b50) throw new Error('The zip file is damaged.');
    const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
    const raw = bytes.subarray(start, start + entry.compressedSize);
    if(entry.method === 0) return raw;
    if(entry.method === 8) return inflateRaw(raw, maxEntryBytes);
    throw new Error(`"${name}" uses a compression method this reader does not support.`);
  };

  return {
    names: [...entries.keys()],
    has: name => entries.has(name),
    read,
    text: async name => {
      const data = await read(name);
      return data ? decoder.decode(data) : null;
    },
  };
};
