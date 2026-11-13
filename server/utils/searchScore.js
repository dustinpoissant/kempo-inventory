/*
  Scoring a search of the inventory, with no database access so it can be tested without a server.

  A search is cut into words (tokens). Each token is matched on its own against the properties of an item (or category), and the
  best match for it counts: a match in the name is worth more than one in the description. The tokens' scores are averaged, so
  "blue filament" scores an item whose name matches "blue" and whose category matches "filament" by combining both. An entry
  must match every token somewhere to be found at all.

  A score is 0 to 1, higher is better, 0 meaning no match.
*/

const MAX_TOKENS = 8;

/* The words of a search, lowercase, each once. Capped so a very long search cannot make a very long query. */
export const tokensOf = search => [...new Set(String(search ?? '').toLowerCase().split(/\s+/).filter(Boolean))].slice(0, MAX_TOKENS);

const wordsOf = text => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/* How well one token matches one text: 1 when it is the whole text, 0.95 a whole word of it, 0.85 the start of a word, 0.6 inside one, 0 not at all. */
export const tokenMatch = (token, text) => {
  const lower = String(text ?? '').toLowerCase();
  if(!lower.includes(token)) return 0;
  if(lower === token) return 1;
  const words = wordsOf(lower);
  if(words.includes(token)) return 0.95;
  if(words.some(word => word.startsWith(token))) return 0.85;
  return 0.6;
};

/*
  `fields` is [{ text, weight }]: the properties to look in and how much a match in each is worth (1 for the name). Each token takes
  the best of its matches, and the score is the mean of those.
*/
export const scoreEntry = ({ tokens, fields }) => {
  if(!tokens.length) return 0;
  let total = 0;
  for(const token of tokens){
    const best = Math.max(0, ...fields.map(({ text, weight = 1 }) => tokenMatch(token, text) * weight));
    if(!best) return 0;
    total += best;
  }
  return Math.round(total / tokens.length * 10000) / 10000;
};
