/*
  Quantity and unit rules, kept pure so they can be tested without a database. A quantity keeps at
  most four decimal places, and is a whole number unless the decimal_quantity setting allows fractions.
*/
export const SCALE = 4;
export const MAX_UNIT = 20;

export const toQuantity = (value, decimals = false) => {
  const number = Number(value);
  if(!Number.isFinite(number)) return NaN;
  if(!decimals && !Number.isInteger(number)) return NaN;
  return Math.round(number * 10 ** SCALE) / 10 ** SCALE;
};

export const checkUnit = value => {
  const unit = String(value ?? '').trim().replace(/\s+/g, ' ');
  if(unit.length > MAX_UNIT) return [{ code: 400, msg: `A unit must be ${MAX_UNIT} characters or fewer` }, null];
  return [null, unit];
};
