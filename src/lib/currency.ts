export const DEFAULT_CURRENCY = 'PKR'
export function formatCurrency(amount: number, currency = DEFAULT_CURRENCY): string {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}
