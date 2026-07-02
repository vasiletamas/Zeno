import { describe, it, expect } from 'vitest'
import { buildIdentityPayload } from '@/lib/chat/debug'
import type { TurnContextCustomer } from '@/lib/chat/turn-context'
import type { RawCustomerInsight } from '@/lib/chat/context-loaders'

function makeCustomer(overrides: Partial<TurnContextCustomer> = {}): TurnContextCustomer {
  return {
    name: null,
    dateOfBirth: null,
    language: 'ro',
    isAnonymous: true,
    gdprConsentAt: null,
    gdprConsentScope: null,
    aiDisclosureAcknowledgedAt: null,
    ...overrides,
  }
}

const baseConversation = {
  productId: null,
  product: null,
  candidateProductId: null,
  candidateSetAt: null,
} as const

const baseArgs = {
  traceId: 't1',
  conversationId: 'conv1',
  messageIndex: 0,
  customerId: 'cust1',
  conversation: baseConversation,
  now: new Date('2026-05-26T12:00:00Z'),
}

describe('buildIdentityPayload', () => {
  it('builds a payload with the expected shape', () => {
    const customer = makeCustomer({
      name: 'Ana',
      dateOfBirth: new Date('1992-01-10T00:00:00Z'),
      isAnonymous: false,
      gdprConsentAt: new Date('2026-05-26T10:00:00Z'),
      gdprConsentScope: 'sales',
      aiDisclosureAcknowledgedAt: new Date('2026-05-26T10:14:00Z'),
    })
    const insights: RawCustomerInsight[] = [
      {
        id: 'i1',
        customerId: 'cust1',
        productId: null,
        category: 'PREFERENCE',
        key: 'language',
        value: 'ro',
        confidence: 0.9,
        source: 'conv-1',
        lastConfirmedAt: new Date('2026-05-20T12:00:00Z'),
        createdAt: new Date('2026-05-20T12:00:00Z'),
        updatedAt: new Date('2026-05-20T12:00:00Z'),
      } as RawCustomerInsight,
    ]

    const payload = buildIdentityPayload({ ...baseArgs, customer, insights })

    expect(payload).toEqual({
      traceId: 't1',
      conversationId: 'conv1',
      messageIndex: 0,
      identity: { cookieId: 'cust1', isAnonymous: false },
      customer: {
        name: 'Ana',
        age: 34,
        language: 'ro',
      },
      consent: {
        gdprConsentAt: '2026-05-26T10:00:00.000Z',
        gdprConsentScope: 'sales',
        aiDisclosureAcknowledgedAt: '2026-05-26T10:14:00.000Z',
      },
      conversation: {
        productId: null,
        productCode: null,
        productName: null,
        candidateProductId: null,
        candidateSetAt: null,
      },
      memory: [
        {
          id: 'i1',
          kind: 'PREFERENCE',
          text: 'language: ro',
          createdAt: '2026-05-20T12:00:00.000Z',
        },
      ],
    })
  })

  it('surfaces candidate and committed product in the conversation block', () => {
    const customer = makeCustomer()
    const conversation = {
      productId: 'p-protect',
      product: { code: 'protect', name: { ro: 'Protect', en: 'Protect' } },
      candidateProductId: 'p-protect',
      candidateSetAt: new Date('2026-05-26T10:30:00Z'),
    }
    const payload = buildIdentityPayload({ ...baseArgs, customer, conversation, insights: [] })
    expect(payload.conversation).toEqual({
      productId: 'p-protect',
      productCode: 'protect',
      productName: 'Protect',
      candidateProductId: 'p-protect',
      candidateSetAt: '2026-05-26T10:30:00.000Z',
    })
  })

  it('returns age=null when dateOfBirth is null', () => {
    const customer = makeCustomer()
    const payload = buildIdentityPayload({ ...baseArgs, customer, insights: [] })
    expect(payload.customer.age).toBeNull()
  })

  it('returns memory=[] when insights is empty', () => {
    const customer = makeCustomer()
    const payload = buildIdentityPayload({ ...baseArgs, customer, insights: [] })
    expect(payload.memory).toEqual([])
  })

  it('decrements age when birthday has not yet occurred this year', () => {
    // DOB November 10, 1992; "now" is May 26, 2026 → still 33, not 34
    const customer = makeCustomer({
      dateOfBirth: new Date('1992-11-10T00:00:00Z'),
    })
    const payload = buildIdentityPayload({ ...baseArgs, customer, insights: [] })
    expect(payload.customer.age).toBe(33)
  })
})
