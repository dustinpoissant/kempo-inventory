import authorize from '../../../server/utils/authorize.js';
import { deleteCategory } from '../../../server/utils/categories.js';

export default async (request, response) => {
  const [authError, auth] = await authorize(request, 'items:update');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const name = request.body?.name ?? request.query.name;
  const [error, result] = await deleteCategory(name, { userId: auth.userId });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json(result);
};
