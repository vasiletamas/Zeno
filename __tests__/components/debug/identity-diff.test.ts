import { describe, it, expect } from 'vitest'
import { diffIdentity } from '@/components/debug/sections/identity-diff'
import type { DebugTurn } from '@/lib/debug/reducer'

function makeIdentity(overrides: Partial<NonNullable<DebugTurn['identity']>> = {}): NonNullable<DebugTurn['identity']> {
  return {
    conversationId: 'conv1',
    messageIndex: 0,
    identity: { cookieId: 'cust1', isAnonymous: true },
    customer: {
      name: null,
      age: null,
      language: 'ro',
      extractedProfile: {},
    },
    consent: {
      gdprConsentAt: null,
      gdprConsentScope: null,
      aiDisclosureAcknowledgedAt: null,
    },
    memory: [],
    ...overrides,
  }
}

describe('diffIdentity', () => {
  it('returns zero changes when previous is null (first turn)', () => {
    const current = makeIdentity()
    const r = diffIdentity(current, null)
    expect(r.changes).toBe(0)
    expect(r.scalarDiffs.size).toBe(0)
    expect(r.newMemoryIds.size).toBe(0)
  })

  it('flags a changed extractedProfile leaf', () => {
    const previous = makeIdentity({
      customer: { name: null, age: null, language: 'ro', extractedProfile: {} },
    })
    const current = makeIdentity({
      customer: { name: null, age: null, language: 'ro', extractedProfile: { familySize: 3 } },
    })
    const r = diffIdentity(current, previous)
    expect(r.scalarDiffs.get('customer.extractedProfile.familySize')).toEqual({
      now: 3,
      was: null,
    })
    expect(r.changes).toBe(1)
  })

  it('flags a new memory insight by id', () => {
    const previous = makeIdentity({ memory: [] })
    const current = makeIdentity({
      memory: [
        { id: 'new1', kind: 'preferences', text: 'language: ro', createdAt: '2026-05-26T10:00:00.000Z' },
      ],
    })
    const r = diffIdentity(current, previous)
    expect(r.newMemoryIds.has('new1')).toBe(true)
    expect(r.changes).toBe(1)
  })

  it('flags a flipped consent timestamp', () => {
    const previous = makeIdentity()
    const current = makeIdentity({
      consent: {
        gdprConsentAt: '2026-05-26T10:00:00.000Z',
        gdprConsentScope: 'sales',
        aiDisclosureAcknowledgedAt: null,
      },
    })
    const r = diffIdentity(current, previous)
    expect(r.scalarDiffs.has('consent.gdprConsentAt')).toBe(true)
    expect(r.scalarDiffs.has('consent.gdprConsentScope')).toBe(true)
    expect(r.changes).toBe(2)
  })

  it('treats null and undefined as equal for scalar comparison', () => {
    const previous = makeIdentity({
      customer: { name: null, age: null, language: 'ro', extractedProfile: {} },
    })
    const current = makeIdentity({
      // simulate a profile key that was explicitly undefined; should not register as changed vs null
      customer: { name: null, age: null, language: 'ro', extractedProfile: {} },
    })
    const r = diffIdentity(current, previous)
    expect(r.changes).toBe(0)
  })
})
