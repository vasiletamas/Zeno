/**
 * T23: the acceptance card's pure logic — the frequency comparison rows are
 * computed from the bundle's precomputed premium fields (equal yearly totals
 * visible), the Accept action exists only once the disclosures are
 * acknowledged (or just posted) AND a frequency is chosen, and every posted
 * action adapts to the right tool call. gui-actor commits are confirmed by
 * construction, so no confirmToken rides any click.
 */
import { describe, it, expect } from 'vitest'
import { buildFrequencyRows, buildAcceptAction, buildAckAction } from '@/components/chat/rich/acceptance-card'
import { adaptAction } from '@/lib/chat/action-adapter'

const PREMIUM = { annual: 540, semiAnnual: 270, quarterly: 135, currency: 'RON' }

describe('buildFrequencyRows (pure card logic)', () => {
  it('builds one comparison row per offered option with equal yearly totals', () => {
    expect(buildFrequencyRows(PREMIUM, ['annual', 'semi_annual', 'quarterly'])).toEqual([
      { option: 'annual', perInstallment: 540, installments: 1, totalPerYear: 540 },
      { option: 'semi_annual', perInstallment: 270, installments: 2, totalPerYear: 540 },
      { option: 'quarterly', perInstallment: 135, installments: 4, totalPerYear: 540 },
    ])
  })

  it('only options the product offers appear', () => {
    expect(buildFrequencyRows(PREMIUM, ['annual']).map((r) => r.option)).toEqual(['annual'])
  })

  it('a variant the quote did not price is dropped even when offered', () => {
    const rows = buildFrequencyRows({ ...PREMIUM, semiAnnual: null, quarterly: null }, ['annual', 'semi_annual', 'quarterly'])
    expect(rows.map((r) => r.option)).toEqual(['annual'])
  })

  it('totals are rounded to 2 decimals from the precomputed per-installment fields', () => {
    const rows = buildFrequencyRows({ annual: 541, semiAnnual: 270.5, quarterly: 135.25, currency: 'RON' }, ['annual', 'semi_annual', 'quarterly'])
    expect(rows.find((r) => r.option === 'semi_annual')!.totalPerYear).toBe(541)
    expect(rows.find((r) => r.option === 'quarterly')!.totalPerYear).toBe(541)
  })
})

describe('buildAcceptAction (gated Accept)', () => {
  it('null until (acked || justAcked) AND a frequency is selected', () => {
    expect(buildAcceptAction({ acked: false, frequency: 'annual' })).toBeNull()
    expect(buildAcceptAction({ acked: true, frequency: null })).toBeNull()
    expect(buildAcceptAction({ acked: false, justAcked: false, frequency: null })).toBeNull()
  })

  it('acked + frequency → accept_quote with the ELECTED paymentOption (the hard-coded annual is dead)', () => {
    expect(buildAcceptAction({ acked: true, frequency: 'quarterly' })).toEqual({
      type: 'accept_quote',
      payload: { paymentOption: 'quarterly' },
    })
  })

  it('a just-posted ack counts before the turn returns', () => {
    expect(buildAcceptAction({ acked: false, justAcked: true, frequency: 'semi_annual' })).toEqual({
      type: 'accept_quote',
      payload: { paymentOption: 'semi_annual' },
    })
  })

  it('round-trips through adaptAction to a tokenless accept_quote call (one gui click applies)', () => {
    const call = adaptAction(buildAcceptAction({ acked: true, frequency: 'quarterly' })!)
    expect(call).toMatchObject({ name: 'accept_quote', arguments: { paymentOption: 'quarterly' } })
    expect(call!.arguments).not.toHaveProperty('confirmToken')
  })
})

describe('acceptance-card action round-trips', () => {
  it('the ack checkbox posts acknowledge_disclosures and adapts to the commit', () => {
    const action = buildAckAction()
    expect(action).toEqual({ type: 'acknowledge_disclosures', payload: {} })
    const call = adaptAction(action)
    expect(call).toMatchObject({ name: 'acknowledge_disclosures', arguments: {} })
    expect(call!.arguments).not.toHaveProperty('confirmToken')
  })

  it('open_acceptance (the QuoteCard primary button) adapts to the get_acceptance_bundle read', () => {
    const call = adaptAction({ type: 'open_acceptance', payload: {} })
    expect(call).toMatchObject({ name: 'get_acceptance_bundle', arguments: {} })
  })
})
