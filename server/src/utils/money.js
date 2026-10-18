// Money is stored as integer cents/paise everywhere in the database and API.
// YouPI-PG's own API takes amount as a decimal-string rupee amount, so these
// helpers are the only place that boundary gets crossed.

export function centsToRupeeString(cents) {
  return (cents / 100).toFixed(2);
}

export function rupeeStringToCents(amount) {
  const value = Math.round(Number(amount) * 100);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid rupee amount: ${amount}`);
  }
  return value;
}
