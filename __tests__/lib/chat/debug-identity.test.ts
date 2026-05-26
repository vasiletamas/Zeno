import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildIdentityPayload } from '@/lib/chat/debug'
import type { TurnContextCustomer } from '@/lib/chat/turn-context'
import type { RawCustomerInsight } from '@/lib/chat/context-loaders'

function makeCustomer(overrides: Partial<TurnContextCustomer> = {}): TurnContextCustomer {
  return {
    name: null,
    dateOfBirth: null,
    extractedProfile: {},
    language: 'ro',
    isAnonymous: true,
    gdprConsentAt: null,
    gdprConsentScope: null,
    aiDisclosureAcknowledgedAt: null,
    ...overrides,
  }
}

const baseArgs = {
  traceId: 't1',
  conversationId: 'conv1',
  messageIndex: 0,
  customerId: 'cust1',
}

describe('buildIdentityPayload', () => {
  afterEach(() => vi.useRealTimers())

  it('builds a payload with the expected shape', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T12:00:00Z'))
    const customer = makeCustomer({
      name: 'Ana',
      dateOfBirth: new Date('1992-01-10T00:00:00Z'),
      extractedProfile: { occupation: 'engineer' },
      isAnonymous: false,
      gdprConsentAt: new Date('2026-05-26T10:00:00Z'),
      gdprConsentScope: 'sales',
      aiDisclosureAcknowledgedAt: new Date('2026-05-26T10:14:00Z'),
    })
    const insights: RawCustomerInsight[] = [
      {
        id: 'i1',
        customerId: 'cust1',
        category: 'preferences',
        key: 'language',
        value: 'ro',
        confidence: 0.9,
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
        extractedProfile: { occupation: 'engineer' },
      },
      consent: {
        gdprConsentAt: '2026-05-26T10:00:00.000Z',
        gdprConsentScope: 'sales',
        aiDisclosureAcknowledgedAt: '2026-05-26T10:14:00.000Z',
      },
      memory: [
        {
          id: 'i1',
          kind: 'preferences',
          text: 'language: ro',
          createdAt: '2026-05-20T12:00:00.000Z',
        },
      ],
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
})
