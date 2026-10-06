import { authorizeRead } from '../../../server/utils/access.js';
import { getMovements } from '../../../server/utils/items.js';

export default async (request, response) => {
  const [authError, access] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });
  if(!access.canSeeStock) return response.status(403).json({ error: 'Insufficient permissions' });

  const { itemId, limit, offset } = request.query;
  const [error, movements] = await getMovements({
    itemId,
    limit: Math.min(parseInt(limit) || 50, 200),
    offset: parseInt(offset) || 0,
  });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json({ movements });
};
