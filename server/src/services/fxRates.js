// Live exchange rates from Frankfurter (https://frankfurter.dev), a free,
// open-source, no-API-key-required service built on European Central Bank
// reference rates. Used only to show an approximate combined total when a
// user's balances span more than one currency — the per-currency figures
// (always exact) remain the source of truth everywhere else in the app.
const cache = new Map(); // base currency -> { rates, fetchedAt }
const TTL_MS = 60 * 60 * 1000; // 1 hour — these are daily reference rates, no need to refetch often

async function getRatesFrom(base) {
  const cached = cache.get(base);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.rates;

  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}`);
    if (!res.ok) throw new Error(`FX rate fetch failed: HTTP ${res.status}`);
    const data = await res.json();
    const rates = { [base]: 1, ...data.rates };
    cache.set(base, { rates, fetchedAt: Date.now() });
    return rates;
  } catch (err) {
    console.warn(`FX rate fetch for ${base} failed (${err.message}); using last known rates if any.`);
    return cached?.rates || null; // null signals "no conversion available"
  }
}

/**
 * Converts an integer-cents amount from one currency to another. Returns
 * null (never a wrong number) if no rate could be obtained.
 */
export async function convertCents(cents, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return cents;
  const rates = await getRatesFrom(fromCurrency);
  const rate = rates?.[toCurrency];
  if (!rate) return null;
  return Math.round(cents * rate);
}

/**
 * Converts a list of { currency, netCents } buckets into one total in
 * toCurrency. Buckets that fail to convert are reported separately rather
 * than silently dropped or left unconverted-but-summed.
 */
export async function convertBuckets(buckets, toCurrency) {
  let totalCents = 0;
  const unconverted = [];
  for (const b of buckets) {
    const converted = await convertCents(b.netCents, b.currency, toCurrency);
    if (converted === null) {
      unconverted.push(b);
    } else {
      totalCents += converted;
    }
  }
  return { totalCents, currency: toCurrency, unconverted };
}
