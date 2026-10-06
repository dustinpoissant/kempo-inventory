import authorize from '../../../server/utils/authorize.js';
import { createItem } from '../../../server/utils/items.js';

export default async (request, response) => {
  const [authError, auth] = await authorize(request, 'items:create');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const { sku, name, description, category, tags, quantity, fields } = request.body || {};
  const [error, item] = await createItem({ sku, name, description, category, tags, quantity, fields, userId: auth.userId });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.status(201).json({ item });
};
