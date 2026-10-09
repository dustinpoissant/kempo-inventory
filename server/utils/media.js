import { readFile } from 'fs/promises';
import { getExtension, getSetting, triggerHook } from 'kempo/server/sdk.js';
import { safeFileName } from './mediaSafety.js';
import { DEFAULT_RATIOS, resolveRatio } from './ratio.js';
import { parseMediaId, filesId } from './fieldTypes.js';

/*
  Where item photos and files live. Three optional extensions can take part, and inventory works
  the same with none of them installed:

    kempo-media   a media library: a kempo-files file plus kind, dimensions and alt text, with
                  thumbnails from kempo-thumbs. It requires the other two.
    kempo-files   a file library; a non-public file needs files:download to view
    kempo-thumbs  generates thumbnails for kempo-files (images, and frames from video and audio)

  Nothing here imports them up front. Each is loaded on demand and only counts as available when it
  is both installed as a package and enabled in kempo.

  New uploads go to kempo-media when it is there, because it already is kempo-files with thumbnails;
  only a site with kempo-files alone uploads to kempo-files directly. Stored values keep saying where
  they live, so older ones keep resolving: a bare id is a kempo-media asset, "files:<id>" is a
  kempo-files file.
*/
const loaders = {
  'kempo-media': () => import('kempo-media/sdk'),
  'kempo-files': () => import('kempo-files/sdk'),
  'kempo-thumbs': () => import('kempo-thumbs/sdk'),
};

const loaded = {};

const load = async name => loaded[name] ??= await loaders[name]().catch(() => null);

const available = async name => {
  const [error, extension] = await getExtension({ name });
  if(error || !extension?.enabled) return false;
  return Boolean(await load(name));
};

/*
  What can be used right now. `thumbs` is only true alongside `files`, since that is the only
  place it can generate thumbnails.
*/
export const providers = async () => {
  const [media, files, thumbs] = await Promise.all([available('kempo-media'), available('kempo-files'), available('kempo-thumbs')]);
  return { media, files, thumbs: files && thumbs };
};

export const mediaAvailable = async () => {
  const found = await providers();
  return found.media || found.files;
};

/*
  Which library new uploads go to: 'media', 'files' or null when neither is installed.
*/
export const chooseUploadProvider = found => found.media ? 'media' : found.files ? 'files' : null;

export const uploadProvider = async () => chooseUploadProvider(await providers());

/*
  The aspect ratios images are shown at, as CSS ("4 / 3"): { category, item }. They come from the
  `category_image_ratio` and `item_image_ratio` settings; a blank or invalid one falls back to the default.
*/
export const getImageRatios = async () => {
  const [, category] = await getSetting('kempo-inventory', 'category_image_ratio', DEFAULT_RATIOS.category);
  const [, item] = await getSetting('kempo-inventory', 'item_image_ratio', DEFAULT_RATIOS.item);
  return { category: resolveRatio(category, 'category'), item: resolveRatio(item, 'item') };
};

/* Whether new photos are made public, so people who can only read the inventory can see them. */
export const publicPhotos = async () => {
  const [, value] = await getSetting('kempo-inventory', 'public_photos', true);
  return value !== false && value !== 'false';
};

export const capabilities = async () => {
  const found = await providers();
  return { media: found.media || found.files, providers: found, upload: await uploadProvider(), publicFiles: await publicPhotos() };
};

/*
  The smallest thumbnail that is ready, preferring the one labelled "sm".
*/
const pickThumbnail = rows => {
  const ready = (rows ?? []).filter(row => row.status === 'ready' && row.url);
  return (ready.find(row => row.label === 'sm') ?? ready[0])?.url ?? null;
};

const describeMedia = asset => ({
  id: asset.id,
  kind: asset.kind,
  name: asset.originalName,
  alt: asset.altText,
  path: `/${asset.path}`,
  thumbnail: asset.thumbnailPath ? `/${asset.thumbnailPath}` : null,
  width: asset.width,
  height: asset.height,
});

const describeFile = (file, thumbnails) => ({
  id: filesId(file.id),
  kind: file.kind,
  name: file.name,
  alt: file.altText,
  path: file.alias ? `/${file.alias}` : `/kempo-files/api/files/${file.id}`,
  thumbnail: pickThumbnail(thumbnails),
  width: null,
  height: null,
});

/*
  Looks up stored values. Returns a map of stored id -> a small description of each file; an id
  with no entry means it was deleted from its library, or its library is not available right now.
*/
export const getAssets = async ids => {
  const wanted = [...new Set(ids)];
  if(!wanted.length) return {};
  const found = await providers();
  const parsed = wanted.map(id => ({ id, ...parseMediaId(id) }));
  const result = {};

  const mediaIds = parsed.filter(p => p.provider === 'media');
  if(found.media && mediaIds.length){
    const { getMediaAsset } = await load('kempo-media');
    const lookups = await Promise.all(mediaIds.map(async p => [p.id, await getMediaAsset(p.rawId)]));
    for(const [id, [error, asset]] of lookups) if(!error) result[id] = describeMedia(asset);
  }

  const fileIds = parsed.filter(p => p.provider === 'files');
  if(found.files && fileIds.length){
    const { getFile } = await load('kempo-files');
    const lookups = await Promise.all(fileIds.map(async p => [p, await getFile(p.rawId)]));

    let thumbnails = {};
    if(found.thumbs){
      const { thumbnailsForMany } = await load('kempo-thumbs');
      const [, data] = await thumbnailsForMany(fileIds.map(p => p.rawId));
      thumbnails = data?.bySource ?? {};
    }
    for(const [p, [error, file]] of lookups) if(!error) result[p.id] = describeFile(file, thumbnails[p.rawId]);
  }
  return result;
};

/*
  The bytes of a stored file, for an export: [null, { name, kind, alt, bytes }], or an error when it is
  gone from its library (or the library is not installed).
*/
export const readMedia = async storedId => {
  const { provider, rawId } = parseMediaId(storedId);
  const found = await providers();
  try {
    if(provider === 'files' && found.files){
      const { getFile, filePath } = await load('kempo-files');
      const [error, file] = await getFile(rawId);
      if(error) return [error, null];
      const [pathError, absolute] = await filePath(file);
      if(pathError) return [pathError, null];
      return [null, { name: file.name, kind: file.kind, alt: file.altText ?? '', bytes: await readFile(absolute) }];
    }
    if(provider === 'media' && found.media){
      const { getMediaAsset } = await load('kempo-media');
      const [error, asset] = await getMediaAsset(rawId);
      if(error) return [error, null];
      // The asset's id is its kempo-files file id, and its bytes live in kempo-files
      const { getFile, filePath } = await load('kempo-files');
      const [fileError, file] = await getFile(asset.fileId);
      if(fileError) return [fileError, null];
      const [pathError, absolute] = await filePath(file);
      if(pathError) return [pathError, null];
      return [null, { name: asset.originalName, kind: asset.kind, alt: asset.altText ?? '', bytes: await readFile(absolute) }];
    }
  } catch {
    return [{ code: 404, msg: 'The file could not be read' }, null];
  }
  return [{ code: 409, msg: 'The library holding this file is not installed' }, null];
};

/*
  Stores a file in whichever library new uploads go to (the same choice as an upload from the form), on
  behalf of `userId`, and resolves to [null, storedId]. The caller is responsible for having checked who
  may do this and what the file is (see mediaSafety.js); this is only the storing. A name that is taken is
  retried with a short random suffix, the way the form's uploader does.
*/
export const storeMedia = async ({ name, bytes, altText = '', userId }) => {
  const provider = await uploadProvider();
  if(!provider) return [{ code: 409, msg: 'Uploading needs the kempo-media or kempo-files extension' }, null];
  const safe = safeFileName(name);
  const data = Buffer.from(bytes);
  const withSuffix = () => safe.replace(/(.[^.]*)?$/, ext => `-${Math.random().toString(36).slice(2, 7)}${ext ?? ''}`);
  try {
    if(provider === 'files'){
      const { storeUpload } = await load('kempo-files');
      const [, maxMb] = await getSetting('kempo-files', 'max_upload_size_mb', 250);
      const isPublic = await publicPhotos();
      let attempt = safe;
      for(let n = 0; n < 5; n++){
        const [error, file] = await storeUpload({ name: attempt, data, altText, ownerId: userId, public: isPublic, maxBytes: Number(maxMb) * 1024 * 1024 });
        if(!error){
          await triggerHook('file:uploaded', { file });
          return [null, filesId(file.id)];
        }
        if(error.code !== 409) return [error, null];
        attempt = withSuffix();
      }
      return [{ code: 409, msg: 'No free file name could be found' }, null];
    }
    const { uploadMediaAsset } = await load('kempo-media');
    const [, maxMb] = await getSetting('kempo-media', 'max_upload_size_mb', 250);
    const [error, asset] = await uploadMediaAsset({
      filename: safe, data, altText, uploadedBy: userId, maxBytes: Number(maxMb) * 1024 * 1024, public: await publicPhotos(),
    });
    return error ? [error, null] : [null, asset.id];
  } catch {
    return [{ code: 500, msg: 'The file could not be stored' }, null];
  }
};

/*
  Returns an { code, msg } for the first id that cannot be used, or null when all can: its library
  is not installed (409), or it no longer exists (400).
*/
export const checkAssets = async (ids, label) => {
  const found = await providers();
  for(const id of ids){
    const { provider } = parseMediaId(id);
    if(!found[provider]){
      return { code: 409, msg: `${label}: ${provider === 'files' ? 'kempo-files' : 'kempo-media'} is not installed` };
    }
  }
  const assets = await getAssets(ids);
  const missing = ids.find(id => !assets[id]);
  return missing ? { code: 400, msg: `${label}: a selected file no longer exists in its library` } : null;
};
