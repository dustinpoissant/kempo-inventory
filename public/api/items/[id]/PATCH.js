import authorize from '../../../../server/utils/authorize.js';
import { updateItem } from '../../../../server/utils/items.js';

export default async (request, response) => {
  const [authError, auth] = await authorize(request, 'items:update');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const { sku, name, description, category, tags, fields } = request.body || {};
  const [error, item] = await updateItem(request.params.id, { sku, name, description, category, tags, fields, userId: auth.userId });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json({ item });
};
