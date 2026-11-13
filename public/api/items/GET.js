import { authorizeRead, forCaller } from '../../../server/utils/access.js';
import { parseTagParam } from '../../../server/utils/tags.js';
import { getItems } from '../../../server/utils/items.js';

export default async (request, response) => {
  const [authError, access] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const { q, category, tag, uncategorised, filters, owner, limit, offset, ids } = request.query;

  /* `ids` is a JSON list of item ids (or one id): exactly those items, in the order the database gives them. */
  let wantedIds;
  if(ids){
    try {
      const parsed = JSON.parse(ids);
      wantedIds = Array.isArray(parsed) ? parsed.map(String).slice(0, 200) : [String(ids)];
    } catch {
      wantedIds = [String(ids)];
    }
  }

  let parsedFilters = {};
  if(filters){
    try {
      parsedFilters = JSON.parse(filters);
    } catch {
      return response.status(400).json({ error: 'filters must be a JSON object' });
    }
    if(parsedFilters === null || typeof parsedFilters !== 'object' || Array.isArray(parsedFilters)){
      return response.status(400).json({ error: 'filters must be a JSON object' });
    }
  }

  const [error, data] = await getItems({
    q,
    category,
    tag: parseTagParam(tag),
    uncategorised: uncategorised === 'true',
    filters: parsedFilters,
    owner,
    ids: wantedIds,
    limit: Math.min(parseInt(limit) || 50, 200),
    offset: parseInt(offset) || 0,
  });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json({ ...data, items: data.items.map(item => forCaller(item, access)) });
};
