import { describe, it, expect } from 'vitest'
import { inferCandidate } from '@/lib/chat/candidate-inference'

const CATALOG_ONE_LIFE = [{ id: 'p-protect', insuranceType: 'LIFE' }]
const CATALOG_MULTI_LIFE = [
  { id: 'p-protect', insuranceType: 'LIFE' },
  { id: 'p-life2', insuranceType: 'LIFE' },
]

describe('auto-candidate-assignment scenarios', () => {
  it('"vreau o asigurare de viata" + single-life-product catalog → Protect with confidence 70', () => {
    const r = inferCandidate('vreau o asigurare de viata', null, CATALOG_ONE_LIFE)
    expect(r).toEqual({ productId: 'p-protect', confidence: 70 })
  })

  it('"buna ziua" + life-product catalog → null (no category mentioned)', () => {
    expect(inferCandidate('buna ziua', null, CATALOG_ONE_LIFE)).toBeNull()
  })

  it('"vreau o asigurare de viata" + multi-life-product catalog → null (ambiguous)', () => {
    expect(inferCandidate('vreau o asigurare de viata', null, CATALOG_MULTI_LIFE)).toBeNull()
  })

  it('"buna ziua" + stored interests ["life insurance"] + single-life catalog → Protect', () => {
    const r = inferCandidate('buna ziua', ['life insurance'], CATALOG_ONE_LIFE)
    expect(r).toEqual({ productId: 'p-protect', confidence: 70 })
  })
})
