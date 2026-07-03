import { describe, it, expect } from 'vitest'
import { buildSchedule, INSTALLMENTS_BY_FREQUENCY } from '@/lib/engines/payment-schedule'

describe('buildSchedule (D2.4, contradiction #3)', () => {
  const start = new Date('2026-06-12T00:00:00Z')

  it('frequency map is pinned to the SELLABLE set — no monthly (erratum 2, T7.D3)', () => {
    expect(INSTALLMENTS_BY_FREQUENCY).toEqual({ annual: 1, semi_annual: 2, quarterly: 4 })
  })

  it('installments sum EXACTLY to round(premiumAnnual*100); last absorbs the remainder', () => {
    const rows = buildSchedule({ premiumAnnual: 310.33, frequency: 'quarterly', startAt: start })
    expect(rows).toHaveLength(4)
    const annualMinor = Math.round(310.33 * 100) // 31033
    expect(rows.reduce((s, r) => s + r.amountMinor, 0)).toBe(annualMinor)
    expect(rows[0].amountMinor).toBe(Math.floor(annualMinor / 4)) // 7758
    expect(rows[3].amountMinor).toBe(annualMinor - 3 * Math.floor(annualMinor / 4)) // 7759
  })

  it('dueAt: first installment due at start, then evenly spaced by 12/n months', () => {
    const rows = buildSchedule({ premiumAnnual: 300, frequency: 'semi_annual', startAt: start })
    expect(rows[0].dueAt.toISOString()).toBe(start.toISOString())
    expect(rows[1].dueAt.getUTCMonth()).toBe((start.getUTCMonth() + 6) % 12)
  })

  it('annual = single installment of the full premium', () => {
    const rows = buildSchedule({ premiumAnnual: 300, frequency: 'annual', startAt: start })
    expect(rows).toEqual([{ sequence: 1, dueAt: start, amountMinor: 30000 }])
  })
})
