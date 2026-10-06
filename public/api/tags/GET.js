import { authorizeRead } from '../../../server/utils/access.js';
import { getTags } from '../../../server/utils/tagList.js';

/* Every tag in use, for suggestions and filters: [{ tag, count }]. Readable like items are. */
export default async (request, response) => {
  const [authError] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error, tags] = await getTags({ q: request.query.q, limit: Math.min(parseInt(request.query.limit) || 100, 500) });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json({ tags });
};
