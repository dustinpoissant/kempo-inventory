import authorize from '../../../server/utils/authorize.js';
import { createField } from '../../../server/utils/fields.js';

export default async (request, response) => {
  const [authError] = await authorize(request, 'fields:manage');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const { key, label, type, description, required, listed, suggest, options, position, category, imageRatio, imageMax } = request.body || {};
  const [error, field] = await createField({ key, label, type, description, required, listed, suggest, options, position, category, imageRatio, imageMax });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.status(201).json({ field });
};
