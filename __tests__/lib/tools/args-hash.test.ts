import { describe, it, expect } from 'vitest'
import { materialArgsHash } from '@/lib/tools/args-hash'

describe('materialArgsHash', () => {
  it('is stable under key order and strips confirm-class args', () => {
    const a = materialArgsHash('accept_quote', 'quote:q1', { paymentFrequency: 'monthly', confirmAcceptance: true })
    const b = materialArgsHash('accept_quote', 'quote:q1', { confirmToken: 'x', paymentFrequency: 'monthly' })
    expect(a).toBe(b)
  })
  it('differs by targetRef (same verb on a different entity is NOT a replay)', () => {
    expect(materialArgsHash('save_dnt_answer', 'dnt_answer:Q1', { answer: 'da' }))
      .not.toBe(materialArgsHash('save_dnt_answer', 'dnt_answer:Q2', { answer: 'da' }))
  })
})
