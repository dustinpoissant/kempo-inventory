import authorize from '../../../../../server/utils/authorize.js';
import { adjustQuantity } from '../../../../../server/utils/items.js';

export default async (request, response) => {
  const [authError, auth] = await authorize(request, 'quantity:adjust');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const { delta, reason, note } = request.body || {};
  const [error, item] = await adjustQuantity(request.params.id, { delta, reason, note, userId: auth.userId });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json({ item });
};
