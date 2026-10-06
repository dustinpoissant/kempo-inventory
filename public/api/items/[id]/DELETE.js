import authorize from '../../../../server/utils/authorize.js';
import { deleteItem } from '../../../../server/utils/items.js';

export default async (request, response) => {
  const [authError, auth] = await authorize(request, 'items:delete');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error, result] = await deleteItem(request.params.id, { userId: auth.userId });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json(result);
};
