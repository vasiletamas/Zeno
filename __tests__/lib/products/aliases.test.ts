import { describe, it, expect } from 'vitest'
const { stripDiacritics, lookupAlias } = await import('@/lib/products/aliases')

describe('stripDiacritics', () => {
  it('maps Romanian diacritics to ASCII', () => {
    expect(stripDiacritics('locuință')).toBe('locuinta')
    expect(stripDiacritics('LOCUINȚĂ')).toBe('LOCUINTA')
    expect(stripDiacritics('ă î â ș ț')).toBe('a i a s t')
  })
  it('is idempotent and leaves non-Latin unchanged', () => {
    expect(stripDiacritics(stripDiacritics('viață'))).toBe('viata')
    expect(stripDiacritics('日本')).toBe('日本')
  })
})

describe('lookupAlias', () => {
  it('resolves home/casa/locuință → property', () => {
    expect(lookupAlias('home')?.productCode).toBe('property')
    expect(lookupAlias('casa')?.productCode).toBe('property')
    expect(lookupAlias('locuință')?.productCode).toBe('property')
  })
  it('resolves life/auto aliases and is case-insensitive', () => {
    expect(lookupAlias('viață')?.insuranceType).toBe('life')
    expect(lookupAlias('mașină')?.insuranceType).toBe('auto')
    expect(lookupAlias('HOME')).toEqual(lookupAlias('home'))
  })
  it('returns null for unknown terms', () => {
    expect(lookupAlias('nonsense')).toBeNull()
  })
  it('maps life synonyms to the real seeded product code "protect"', () => {
    expect(lookupAlias('viață')?.productCode).toBe('protect')
    expect(lookupAlias('protecție')?.productCode).toBe('protect')
    expect(lookupAlias('life')?.productCode).toBe('protect')
    expect(lookupAlias('protect')?.productCode).toBe('protect')
  })
})
