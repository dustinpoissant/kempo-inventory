import authorize from '../../../server/utils/authorize.js';
import { buildExport } from '../../../server/utils/importExport.js';
import { buildZip } from '../../../server/utils/zip.js';

/*
  Downloads the inventory: ?format=json is the data on its own, ?format=zip is the data (inventory.json)
  together with every photo and file it uses (media/). The whole inventory leaves in one file, so it is
  limited to the top tier, the people who set the inventory up (the fields:manage permission, held by
  the kempo-inventory:admin group).
*/
export default async (request, response) => {
  const [authError] = await authorize(request, 'fields:manage');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const format = request.query.format === 'zip' ? 'zip' : 'json';
  const [error, built] = await buildExport({ withMedia: format === 'zip' });
  if(error) return response.status(error.code).json({ error: error.msg });

  const stamp = new Date().toISOString().slice(0, 10);
  const json = Buffer.from(JSON.stringify(built.data, null, 2), 'utf8');
  const body = format === 'zip'
    ? buildZip([{ name: 'inventory.json', data: json }, ...built.files.map(file => ({ name: file.path, data: file.bytes }))])
    : json;

  response.setHeader('Content-Type', format === 'zip' ? 'application/zip' : 'application/json; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="inventory-${stamp}.${format}"`);
  response.setHeader('Cache-Control', 'no-store');
  if(built.missingMedia) response.setHeader('X-Missing-Media', String(built.missingMedia));
  response.status(200);
  response.end(body);
};
