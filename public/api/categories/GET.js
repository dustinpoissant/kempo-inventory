import { authorizeRead } from '../../../server/utils/access.js';
import { parseTagParam } from '../../../server/utils/tags.js';
import { getCategories } from '../../../server/utils/categories.js';

export default async (request, response) => {
  const [authError] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error, data] = await getCategories({ includeEmpty: request.query.includeEmpty === 'true', q: request.query.q, tag: parseTagParam(request.query.tag) });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json(data);
};
