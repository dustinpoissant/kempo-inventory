import { authorizeRead, forCaller } from '../../../../server/utils/access.js';
import { getItem, getMovements, getLinked, getMedia } from '../../../../server/utils/items.js';

export default async (request, response) => {
  const [authError, access] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error, item] = await getItem(request.params.id);
  if(error) return response.status(error.code).json({ error: error.msg });
  /* The stock history is all counts, so it is only for people who manage stock. */
  const [, movements] = access.canSeeStock ? await getMovements({ itemId: item.id, limit: 100 }) : [null, []];
  const [, linked] = await getLinked(item);
  const [, media] = await getMedia(item);
  response.json({ item: forCaller(item, access), movements: movements || [], linked: linked || {}, media: media || {} });
};
