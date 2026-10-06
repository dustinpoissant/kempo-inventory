const MAX = 20;

/*
  Ranks values for a typed prefix: ones that start with it first, then the most used, then
  alphabetically. Values that differ only in case ("vallejo", "Vallejo") are one suggestion, shown
  the way it is most often written. Pure, so it can be tested without a database.
*/
export const rankSuggestions = (rows, term = '', limit = 8) => {
  const needle = term.trim().toLowerCase();
  const merged = new Map();
  for(const { value, uses } of rows){
    const key = value.toLowerCase();
    const entry = merged.get(key) ?? { total: 0, spellings: new Map() };
    entry.total += uses;
    entry.spellings.set(value, (entry.spellings.get(value) ?? 0) + uses);
    merged.set(key, entry);
  }

  return [...merged.entries()]
    .map(([key, entry]) => ({
      key,
      value: [...entry.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      uses: entry.total,
    }))
    .sort((a, b) =>
      Number(b.key.startsWith(needle)) - Number(a.key.startsWith(needle))
      || b.uses - a.uses
      || a.value.localeCompare(b.value))
    .slice(0, Math.min(Math.max(limit, 1), MAX))
    .map(({ value, uses }) => ({ value, uses }));
};
