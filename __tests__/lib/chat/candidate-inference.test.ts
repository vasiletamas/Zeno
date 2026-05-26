import { describe, it, expect } from 'vitest'
import { inferCandidate } from '@/lib/chat/candidate-inference'

const PROTECT = { id: 'p-protect', insuranceType: 'LIFE' }
const HOME = { id: 'p-home', insuranceType: 'HOME' }
const LIFE_2 = { id: 'p-life2', insuranceType: 'LIFE' }

describe('inferCandidate', () => {
  it('matches "vreau asigurare de viata" to the single LIFE product', () => {
    expect(inferCandidate('vreau asigurare de viata', null, [PROTECT])).toEqual({
      productId: 'p-protect', confidence: 70,
    })
  })

  it('matches "vreau o asigurare de viață" (with diacritic) to the single LIFE product', () => {
    expect(inferCandidate('vreau o asigurare de viață', null, [PROTECT])).toEqual({
      productId: 'p-protect', confidence: 70,
    })
  })

  it('matches "life insurance" English to the single LIFE product', () => {
    expect(inferCandidate('I want life insurance', null, [PROTECT])).toEqual({
      productId: 'p-protect', confidence: 70,
    })
  })

  it('returns null when no category appears in the message and no interests', () => {
    expect(inferCandidate('buna ziua', null, [PROTECT])).toBeNull()
  })

  it('returns null when the message names a category with no catalog match', () => {
    expect(inferCandidate('vreau asigurare de masina', null, [PROTECT])).toBeNull()
  })

  it('returns null when the message names a category with multiple catalog matches', () => {
    expect(inferCandidate('vreau asigurare de viata', null, [PROTECT, LIFE_2])).toBeNull()
  })

  it('falls back to interests when message yields no match', () => {
    expect(inferCandidate('buna ziua', ['life insurance'], [PROTECT])).toEqual({
      productId: 'p-protect', confidence: 70,
    })
  })

  it('message takes precedence over interests', () => {
    // interests say life, message says home — message wins, no candidate set
    expect(inferCandidate('vreau asigurare de masina', ['life insurance'], [PROTECT])).toBeNull()
  })

  it('returns null when no products match any category', () => {
    expect(inferCandidate('vreau asigurare de viata', null, [HOME])).toBeNull()
  })
})
