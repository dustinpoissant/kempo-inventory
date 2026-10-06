import authorize from '../../../../server/utils/authorize.js';
import { applyImport } from '../../../../server/utils/importFile.js';
import { readStaged, discardStaged } from '../../../../server/utils/importStage.js';

/*
  Step two: { importId, onMatch: 'skip' | 'update' } runs the import of the file uploaded in step one. An
  item or category that already exists is left alone ('skip') or updated with the file's values ('update').

  Top tier only, checked first, and the file must be the caller's own staged upload.
*/
export default async (request, response) => {
  const [authError, auth] = await authorize(request, 'fields:manage');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const { importId, onMatch } = request.body || {};
  if(!['skip', 'update'].includes(onMatch)) return response.status(400).json({ error: 'onMatch must be "skip" or "update"' });

  const staged = await readStaged(importId, auth.userId);
  if(!staged) return response.status(404).json({ error: 'That upload has expired. Choose the file again.' });

  const [error, report] = await applyImport(staged.bytes, { onMatch, userId: auth.userId });
  await discardStaged(importId);
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json(report);
};
