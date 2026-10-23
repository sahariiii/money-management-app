/** The app's one money format: CAD with 2 decimals, e.g. "$3,800.67". */
export function formatMoney(amount: number, currency = 'CAD') {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Whole dollars, e.g. "$3,801". Only for chart axis ticks, where decimals are noise. */
export function formatMoneyWhole(amount: number, currency = 'CAD') {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

/** Masks a card for display. Only the last 4 digits are ever kept or shown. */
export function maskCard(last4: string) {
  return `•••• ${last4.slice(-4)}`;
}
