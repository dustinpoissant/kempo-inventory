import { authorizeRead } from '../../../server/utils/access.js';
import { getFields } from '../../../server/utils/fields.js';
import { FIELD_TYPES, OPTIONAL_TYPES, CONVERSIONS } from '../../../server/utils/fieldTypes.js';
import { capabilities as mediaCapabilities, getImageRatios } from '../../../server/utils/media.js';

export default async (request, response) => {
  const [authError] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  /* ?category=Paint returns just what an item in that category shows (default fields plus its own). */
  const scoped = request.query.category !== undefined;
  const [error, fields] = await getFields(scoped ? { category: request.query.category } : {});
  if(error) return response.status(error.code).json({ error: error.msg });

  /*
    `types` is what can be created right now: a type backed by an extension that is not installed
    is left out, so a client never offers something that would be refused.
  */
  const capabilities = await mediaCapabilities();
  const types = FIELD_TYPES.filter(type => !OPTIONAL_TYPES[type] || capabilities[type]);
  /* `imageRatios` is the aspect ratio (CSS) category and item images are shown at. */
  response.json({ fields, types, capabilities, conversions: CONVERSIONS, imageRatios: await getImageRatios() });
};
