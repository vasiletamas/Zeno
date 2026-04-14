import { describe, it, expect } from 'vitest'
import { ALL_PERSONAS, getPersona, getPersonasByOutcome, DEFAULT_ANSWERS } from '@/lib/simulation/personas'

describe('personas', () => {
  it('exports 8 personas', () => {
    expect(ALL_PERSONAS).toHaveLength(8)
  })

  it('each persona has a unique slug', () => {
    const slugs = ALL_PERSONAS.map(p => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('each persona has required fields', () => {
    for (const p of ALL_PERSONAS) {
      expect(p.slug).toBeTruthy()
      expect(p.name).toBeTruthy()
      expect(p.age).toBeGreaterThan(0)
      expect(['ro', 'en']).toContain(p.language)
      expect(p.maxTurns).toBeGreaterThan(0)
      expect(['purchase', 'abandon', 'escalate']).toContain(p.expectedOutcome)
      expect(p.personality).toBeTruthy()
    }
  })

  it('getPersona returns persona by slug', () => {
    const p = getPersona('skeptic')
    expect(p).toBeDefined()
    expect(p!.name).toBe('Ion Gheorghe')
  })

  it('getPersona returns undefined for unknown slug', () => {
    expect(getPersona('nonexistent')).toBeUndefined()
  })

  it('getPersonasByOutcome filters correctly', () => {
    const purchasers = getPersonasByOutcome('purchase')
    expect(purchasers.length).toBeGreaterThan(0)
    expect(purchasers.every(p => p.expectedOutcome === 'purchase')).toBe(true)

    const abandoners = getPersonasByOutcome('abandon')
    expect(abandoners.length).toBeGreaterThan(0)
  })

  it('DEFAULT_ANSWERS covers all DNT and application question codes', () => {
    expect(DEFAULT_ANSWERS['DNT_CONSULTATION_CONSENT']).toBeDefined()
    expect(DEFAULT_ANSWERS['PACKAGE_CHOICE']).toBeDefined()
    expect(DEFAULT_ANSWERS['BD_CANCER_HISTORY']).toBeDefined()
  })
})
