import { describe, it, expect } from 'vitest'
import { classifyEnvelopeFailure } from '@/lib/tools/failure-classification'
import { serializeToolResultForModel } from '@/lib/chat/tool-result-serializer'
import type { CommitResult } from '@/lib/engines/domain-types'

// Task 1.3 (D8): tool failures reach the model as a TYPED contract —
// errorCode ('transient' | 'precondition' | 'validation' | 'permanent') +
// retryable — never a raw string the model has to guess a policy from.

const env = (outcome: CommitResult['outcome'], reason?: CommitResult['reason']): CommitResult =>
  ({ outcome, reason, effects: [] })

describe('classifyEnvelopeFailure', () => {
  it('unavailable → transient, retryable', () => {
    expect(classifyEnvelopeFailure(env('unavailable', 'temporarily_unavailable'))).toEqual({ errorCode: 'transient', retryable: true })
  })
  it('rejected invalid_args → validation, retryable with corrected args', () => {
    expect(classifyEnvelopeFailure(env('rejected', 'invalid_args'))).toEqual({ errorCode: 'validation', retryable: true })
  })
  it('rejected on a domain wall → precondition, NOT retryable', () => {
    expect(classifyEnvelopeFailure(env('rejected', 'dnt_not_signed'))).toEqual({ errorCode: 'precondition', retryable: false })
    expect(classifyEnvelopeFailure(env('rejected', 'handler_rejected'))).toEqual({ errorCode: 'precondition', retryable: false })
  })
  it('requires_* outcomes → precondition, NOT retryable (the follow-up is not a re-call)', () => {
    for (const o of ['requires_confirmation', 'requires_identity', 'requires_consent', 'requires_disclosures'] as const) {
      expect(classifyEnvelopeFailure(env(o, o as CommitResult['reason']))).toEqual({ errorCode: 'precondition', retryable: false })
    }
  })
  it('non-failures classify to null', () => {
    expect(classifyEnvelopeFailure(env('applied'))).toBeNull()
    expect(classifyEnvelopeFailure(env('referred', 'manual_underwriting'))).toBeNull()
    expect(classifyEnvelopeFailure(env('pending'))).toBeNull()
  })
})

describe('serializer carries the failure contract', () => {
  it('serializes errorCode and retryable for failed commits', () => {
    const s = JSON.parse(serializeToolResultForModel({
      success: false,
      envelope: env('unavailable', 'temporarily_unavailable'),
      errorCode: 'transient',
      retryable: true,
      error: 'backend down',
    }))
    expect(s.errorCode).toBe('transient')
    expect(s.retryable).toBe(true)
  })
  it('serializes errorCode and retryable for failed reads (no envelope)', () => {
    const s = JSON.parse(serializeToolResultForModel({
      success: false, error: 'timeout', errorCode: 'transient', retryable: true,
    }))
    expect(s.errorCode).toBe('transient')
    expect(s.retryable).toBe(true)
    expect(s.success).toBe(false)
  })
  it('omits the failure contract on success', () => {
    const s = JSON.parse(serializeToolResultForModel({ success: true, data: { ok: 1 } }))
    expect(s.errorCode).toBeUndefined()
    expect(s.retryable).toBeUndefined()
  })
})
