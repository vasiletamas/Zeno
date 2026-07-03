/**
 * Pure schedule engine (D2.4, contradiction #3) — integer money, no DB.
 *
 * The schedule built here at acceptance is the live money truth from that
 * moment on: integer minor units (bani) summing EXACTLY to
 * round(premiumAnnual*100), the last installment absorbing the division
 * remainder. The frequency map is the SELLABLE set — monthly is NOT
 * sellable (T7.D3, D2 erratum 2): it kills the monthly-undercharge class
 * (12 × rounded-down monthly < annual). accept_quote and
 * change_payment_option validate election against
 * Product.paymentFrequencyOptions ∩ this map.
 */
export const INSTALLMENTS_BY_FREQUENCY = { annual: 1, semi_annual: 2, quarterly: 4 } as const
export type PaymentFrequency = keyof typeof INSTALLMENTS_BY_FREQUENCY
export interface InstallmentRow { sequence: number; dueAt: Date; amountMinor: number }

export function buildSchedule(input: { premiumAnnual: number; frequency: PaymentFrequency; startAt: Date }): InstallmentRow[] {
  const n = INSTALLMENTS_BY_FREQUENCY[input.frequency]
  const annualMinor = Math.round(input.premiumAnnual * 100)
  const base = Math.floor(annualMinor / n)
  const monthsStep = 12 / n
  return Array.from({ length: n }, (_, i) => {
    const dueAt = new Date(input.startAt)
    dueAt.setUTCMonth(dueAt.getUTCMonth() + i * monthsStep)
    return { sequence: i + 1, dueAt, amountMinor: i === n - 1 ? annualMinor - base * (n - 1) : base }
  })
}
