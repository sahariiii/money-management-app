export function formatMoney(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

/** Masks a card for display. Only the last 4 digits are ever kept or shown. */
export function maskCard(last4: string) {
  return `•••• ${last4.slice(-4)}`;
}
