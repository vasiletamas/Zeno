import { describe, it, expect } from 'vitest'
import { validateContentSet, resolveCoveragePlaceholders } from '@/lib/products/authored-content-validation'

const ro = { field: 'SELL_SPECIFIC_INFO', addonCode: null, locale: 'ro' as const, content: 'fara cifre aici' }
const en = { field: 'SELL_SPECIFIC_INFO', addonCode: null, locale: 'en' as const, content: 'no digits here' }

describe('validateContentSet', () => {
  it('accepts a bilingual numeral-free set', () => {
    expect(validateContentSet([ro, en])).toEqual({ ok: true })
  })
  it('rejects a missing locale with stable reason code missing_locale (M6 publish gate)', () => {
    expect(validateContentSet([ro])).toEqual({
      ok: false, reason: 'missing_locale', params: { group: 'SELL_SPECIFIC_INFO::', missing: 'en' },
    })
  })
  it('rejects raw numerals with numerals_in_authored_content', () => {
    expect(validateContentSet([ro, { ...en, content: 'covers up to 2000000 EUR' }]))
      .toMatchObject({ ok: false, reason: 'numerals_in_authored_content' })
  })
  it('allows {{coverage:CODE}} placeholders — amounts referenced, never retyped (T11.D5)', () => {
    expect(validateContentSet([ro, { ...en, content: 'up to {{coverage:BD_TREATMENT}} abroad' }]))
      .toEqual({ ok: true })
  })
  it('validates array content (key_value_product_points are string lists)', () => {
    const enPoints = { field: 'KEY_VALUE_PRODUCT_POINTS', addonCode: null, locale: 'en' as const, content: ['no exam', 'price of 2 coffees'] }
    const roPoints = { ...enPoints, locale: 'ro' as const, content: ['fara examen'] }
    expect(validateContentSet([roPoints, enPoints])).toMatchObject({ ok: false, reason: 'numerals_in_authored_content' })
  })
})

describe('resolveCoveragePlaceholders', () => {
  it('renders placeholder amounts from coverage rows in the requested locale', () => {
    const out = resolveCoveragePlaceholders('up to {{coverage:BD_TREATMENT}}', { BD_TREATMENT: { amount: 2000000, currency: 'EUR' } }, 'en')
    expect(out).toBe('up to 2,000,000 EUR')
  })
  it('leaves unknown placeholders intact so the seed-integrity check can flag them', () => {
    const out = resolveCoveragePlaceholders('see {{coverage:MISSING}}', {}, 'ro')
    expect(out).toBe('see {{coverage:MISSING}}')
  })
})
