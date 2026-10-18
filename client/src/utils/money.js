const SYMBOLS = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$',
  SGD: 'S$',
  AED: 'AED ',
};

export function currencySymbol(currency = 'INR') {
  return SYMBOLS[currency] || `${currency} `;
}

export function formatMoney(cents, currency = 'INR') {
  return `${currencySymbol(currency)}${(cents / 100).toFixed(2)}`;
}

export const SUPPORTED_CURRENCIES = Object.keys(SYMBOLS);
