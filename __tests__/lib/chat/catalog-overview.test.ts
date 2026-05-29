import { describe, it, expect } from 'vitest'
import { buildCatalogOverview } from '@/lib/chat/context-loaders'

const protect = {
  insuranceType: 'LIFE',
  name: { ro: 'Protect', en: 'Protect' },
  description: {
    ro: 'Asigurare de viață cu opțiune de tratament medical în străinătate pentru afecțiuni grave.',
    en: 'Life insurance with an optional foreign-treatment add-on for serious illnesses.',
  },
}

describe('buildCatalogOverview', () => {
  it('lists each product with its insuranceType, name and a short description', () => {
    const out = buildCatalogOverview([protect], 'ro')
    expect(out).toContain('LIFE')
    expect(out).toContain('Protect')
    expect(out).toContain('tratament medical în străinătate')
  })

  it('picks the requested language', () => {
    const out = buildCatalogOverview([protect], 'en')
    expect(out).toContain('Life insurance')
    expect(out).not.toContain('Asigurare de viață')
  })

  it('lists multiple products across types, one line each', () => {
    const out = buildCatalogOverview(
      [
        protect,
        { insuranceType: 'AUTO', name: { ro: 'AutoX', en: 'AutoX' }, description: { ro: 'RCA și CASCO.', en: 'Motor.' } },
      ],
      'ro',
    )
    const lines = out.split('\n').filter((l) => l.trim().startsWith('-'))
    expect(lines).toHaveLength(2)
    expect(out).toContain('AUTO')
    expect(out).toContain('AutoX')
  })

  it('truncates a long description to a single line', () => {
    const longDesc = 'Lorem ipsum dolor sit amet. '.repeat(20).trim()
    const out = buildCatalogOverview(
      [{ insuranceType: 'LIFE', name: { ro: 'X', en: 'X' }, description: { ro: longDesc, en: longDesc } }],
      'ro',
    )
    const productLine = out.split('\n').find((l) => l.includes('X'))!
    expect(productLine).not.toContain('\n')
    expect(productLine.length).toBeLessThan(200)
  })

  it('returns an explicit "no active products" sentinel for an empty catalog', () => {
    const out = buildCatalogOverview([], 'ro')
    expect(out.toLowerCase()).toMatch(/no active products|nu conține produse|niciun produs/)
  })

  it('states these are the only products (anti-hallucination grounding)', () => {
    const out = buildCatalogOverview([protect], 'ro')
    expect(out.toLowerCase()).toMatch(/singur|only|nu sunt disponibile|not available/)
  })
})
