import authorize from '../../../server/utils/authorize.js';
import { saveCategory } from '../../../server/utils/categories.js';

/*
  Create or update a category by name. Only the properties present in the body change, so
  { name, description } leaves the image alone and { name, image: null } clears it. `newName` renames.
*/
export default async (request, response) => {
  const [authError, auth] = await authorize(request, 'items:update');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const body = request.body || {};
  const changes = {};
  for(const property of ['newName', 'image', 'description', 'tags']){
    if(property in body) changes[property] = body[property];
  }
  const [error, category] = await saveCategory(body.name, changes, { userId: auth.userId });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json({ category });
};
