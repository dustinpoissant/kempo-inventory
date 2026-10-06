import authorize from '../../../../server/utils/authorize.js';
import { getSetting } from 'kempo/server/sdk.js';
import { previewImport } from '../../../../server/utils/importFile.js';
import { stage } from '../../../../server/utils/importStage.js';

/*
  Step one of an import: the request body IS the file (a .json or a .zip), sent as raw bytes. Checks it and
  reports what importing it would do; changes nothing in the inventory. Keeps the upload for the second step
  and returns its `importId`.

  Top tier only (fields:manage, the kempo-inventory:admin group). The permission is checked before anything
  is read from the upload: a caller without it gets 401/403 and the bytes are never looked at, parsed or
  stored. (kempo-server itself has already received the body by the time any route runs, for every route on
  the site, up to its `maxBodySize`; lower that in the site's kempo-server config to bound it.)
*/
export default async (request, response) => {
  const [authError, auth] = await authorize(request, 'fields:manage');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [, maxMb] = await getSetting('kempo-inventory', 'import_max_mb', 250);
  const bytes = await request.buffer();
  if(!bytes.length) return response.status(400).json({ error: 'No file was uploaded' });
  if(bytes.length > Number(maxMb) * 1024 * 1024) return response.status(413).json({ error: `That file is larger than the ${maxMb} MB import limit` });

  const [error, report] = await previewImport(bytes, { userId: auth.userId });
  if(error) return response.status(error.code).json({ error: error.msg });

  const importId = await stage(bytes, auth.userId, String(request.query.name ?? ''));
  response.json({ ...report, importId });
};
