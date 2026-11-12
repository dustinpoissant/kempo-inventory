import { authorizeRead } from '../../../../server/utils/access.js';
import { getItem, getMovements, getLinked, getMedia } from '../../../../server/utils/items.js';

export default async (request, response) => {
  const [authError, access] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error, item] = await getItem(request.params.id);
  if(error) return response.status(error.code).json({ error: error.msg });
  /* The item page shows the count and history to everyone who can read it; who made a change is only for people who manage quantity. */
  const [, found] = await getMovements({ itemId: item.id, limit: 100 });
  const movements = (found || []).map(({ userId, ...movement }) => access.canSeeQuantity ? { ...movement, userId } : movement);
  const [, linked] = await getLinked(item);
  const [, media] = await getMedia(item);
  response.json({ item, movements, linked: linked || {}, media: media || {} });
};
