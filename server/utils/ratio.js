/*
  Aspect ratios for images, kept pure so they can be unit tested. A ratio is written "width:height"
  ("4:3", "16:9", "1:1"); "4/3" and a plain number such as "1.5" are accepted too.
*/
export const DEFAULT_RATIOS = { category: '4:3', item: '4:3' };

const LIMIT = 10; // 10:1 either way; anything wilder is almost certainly a typo

/* Returns the ratio as CSS (`aspect-ratio`), e.g. "4 / 3", or null when it is not a usable ratio. */
export const parseRatio = value => {
  const text = String(value ?? '').trim();
  let width;
  let height;
  const pair = text.match(/^(\d+(?:\.\d+)?)\s*[:/xX]\s*(\d+(?:\.\d+)?)$/);
  if(pair){
    width = Number(pair[1]);
    height = Number(pair[2]);
  } else if(/^\d+(?:\.\d+)?$/.test(text)){
    width = Number(text);
    height = 1;
  } else {
    return null;
  }
  if(!(width > 0) || !(height > 0)) return null;
  const ratio = width / height;
  if(ratio > LIMIT || ratio < 1 / LIMIT) return null;
  return `${width} / ${height}`;
};

/* A usable ratio from the setting, or the default for `kind` when it is blank or invalid. */
export const resolveRatio = (value, kind) => parseRatio(value) ?? parseRatio(DEFAULT_RATIOS[kind]);
