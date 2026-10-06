/*
  What an import will accept as a photo or file from a zip. Pure, so it can be tested without a server.

  A name that ends in .png says nothing about what the bytes are, and a zip comes from whoever made it,
  so a file is only accepted when BOTH hold: its extension is one of the photo, video, audio and PDF
  types the media libraries take, and the first bytes of the file really are that type. A web page,
  script or program renamed to .png (or any extension not listed) is refused.
*/
const SIGNATURES = {
  png: bytes => startsWith(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  jpg: bytes => startsWith(bytes, [0xFF, 0xD8, 0xFF]),
  gif: bytes => startsWith(bytes, [0x47, 0x49, 0x46, 0x38]),
  webp: bytes => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP',
  bmp: bytes => ascii(bytes, 0, 2) === 'BM',
  avif: bytes => ascii(bytes, 4, 8) === 'ftyp',
  mp4: bytes => ascii(bytes, 4, 8) === 'ftyp',
  mov: bytes => ascii(bytes, 4, 8) === 'ftyp' || ascii(bytes, 4, 8) === 'moov' || ascii(bytes, 4, 8) === 'wide',
  m4a: bytes => ascii(bytes, 4, 8) === 'ftyp',
  webm: bytes => startsWith(bytes, [0x1A, 0x45, 0xDF, 0xA3]),
  mp3: bytes => ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0),
  wav: bytes => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE',
  ogg: bytes => ascii(bytes, 0, 4) === 'OggS',
  pdf: bytes => ascii(bytes, 0, 5) === '%PDF-',
};
const ALIASES = { jpeg: 'jpg' };

const ascii = (bytes, from, to) => String.fromCharCode(...bytes.subarray(from, to));
const startsWith = (bytes, signature) => signature.every((byte, i) => bytes[i] === byte);

export const ALLOWED_EXTENSIONS = Object.keys(SIGNATURES).concat(Object.keys(ALIASES));

export const extensionOf = name => {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(name ?? ''));
  return match ? match[1].toLowerCase() : '';
};

/* Returns null when the file is acceptable, otherwise a short reason it is not. */
export const refuseMedia = (name, bytes) => {
  const extension = ALIASES[extensionOf(name)] ?? extensionOf(name);
  const check = SIGNATURES[extension];
  if(!check) return 'not a photo, video, audio or PDF file';
  if(!bytes?.length) return 'empty';
  if(!check(bytes)) return `its content is not a real .${extension} file`;
  return null;
};

/* A name safe to hand to a file library: no path, no odd characters, a sensible length. */
export const safeFileName = (name, fallback = 'file') => {
  const base = String(name ?? '').split(/[\\/]/).pop().replace(/[^A-Za-z0-9._ ()-]+/g, '_').replace(/^[.\s]+/, '').slice(0, 100);
  return base || fallback;
};
