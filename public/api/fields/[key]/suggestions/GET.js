import authorize from '../../../../../server/utils/authorize.js';
import { getSuggestions } from '../../../../../server/utils/suggestions.js';

export default async (request, response) => {
  const [authError] = await authorize(request, 'items:read');
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const { q, limit, category } = request.query;
  const [error, suggestions] = await getSuggestions(request.params.key, { q, limit: parseInt(limit) || 8, category: category ?? '' });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json({ suggestions });
};
