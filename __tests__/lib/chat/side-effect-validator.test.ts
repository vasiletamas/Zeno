import { describe, it, expect } from 'vitest'
import { validateSideEffectClaims } from '@/lib/chat/side-effect-validator'

describe('validateSideEffectClaims', () => {
  it('flags "am notat" when no save-category tool was called', () => {
    const result = validateSideEffectClaims(
      'Am notat: 80 mp. Acum, care e suprafața utilă?',
      [],
      [],
      'ro',
    )
    expect(result.valid).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations[0].category).toBe('save')
  })

  it('allows "am notat" when a save-category tool was called and succeeded', () => {
    const result = validateSideEffectClaims(
      'Am notat răspunsul tău.',
      [{ id: 't1', name: 'save_application_answer', arguments: {} } as any],
      [{ success: true }] as any,
      'ro',
    )
    expect(result.valid).toBe(true)
  })

  it('flags "am notat" when a save tool was called but failed', () => {
    const result = validateSideEffectClaims(
      'Am notat răspunsul tău.',
      [{ id: 't1', name: 'save_application_answer', arguments: {} } as any],
      [{ success: false, error: 'db down' }] as any,
      'ro',
    )
    expect(result.valid).toBe(false)
  })

  it('flags "am pornit aplicația" when no lifecycle tool was called', () => {
    const result = validateSideEffectClaims(
      'Perfect, am pornit aplicația pentru tine.',
      [],
      [],
      'ro',
    )
    expect(result.valid).toBe(false)
    expect(result.violations[0].category).toBe('lifecycle')
  })

  it('allows "am pornit aplicația" when start_application succeeded', () => {
    const result = validateSideEffectClaims(
      'Perfect, am pornit aplicația pentru tine.',
      [{ id: 't1', name: 'start_application', arguments: {} } as any],
      [{ success: true }] as any,
      'ro',
    )
    expect(result.valid).toBe(true)
  })

  it('flags "I started the application" when no lifecycle tool was called', () => {
    const result = validateSideEffectClaims(
      'I started the application for you.',
      [],
      [],
      'en',
    )
    expect(result.valid).toBe(false)
    expect(result.violations[0].category).toBe('lifecycle')
  })

  it('returns valid for plain conversational text', () => {
    const result = validateSideEffectClaims(
      'Ce vrei să acoperi: doar locuința sau și bunurile?',
      [],
      [],
      'ro',
    )
    expect(result.valid).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('flags multiple categories in the same message', () => {
    const result = validateSideEffectClaims(
      'Am notat răspunsul și am pornit aplicația.',
      [],
      [],
      'ro',
    )
    expect(result.valid).toBe(false)
    const categories = new Set(result.violations.map((v) => v.category))
    expect(categories.has('save')).toBe(true)
    expect(categories.has('lifecycle')).toBe(true)
  })

  it('flags consent claim without record_gdpr_consent call', () => {
    const result = validateSideEffectClaims(
      'Am confirmat consimțământul GDPR.',
      [],
      [],
      'ro',
    )
    expect(result.valid).toBe(false)
    expect(result.violations[0].category).toBe('consent')
  })

  it('allows consent phrase when record_gdpr_consent succeeded', () => {
    const result = validateSideEffectClaims(
      'Am confirmat consimțământul.',
      [{ id: 't1', name: 'record_gdpr_consent', arguments: {} } as any],
      [{ success: true }] as any,
      'ro',
    )
    expect(result.valid).toBe(true)
  })
})
