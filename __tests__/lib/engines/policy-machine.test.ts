import { describe, it, expect } from 'vitest'
import { canPolicyTransition, POLICY_TRANSITIONS } from '@/lib/engines/policy-machine'

describe('policy machine (D4.1, T9.D3: exclusive owners per transition)', () => {
  it('operator pipeline: PENDING_SUBMISSION->SUBMITTED->ACTIVE; pre-activation cancel', () => {
    expect(canPolicyTransition('PENDING_SUBMISSION', 'SUBMITTED', 'operator')).toBe(true)
    expect(canPolicyTransition('SUBMITTED', 'ACTIVE', 'operator')).toBe(true)
    expect(canPolicyTransition('PENDING_SUBMISSION', 'CANCELLED', 'operator')).toBe(true)
    expect(canPolicyTransition('SUBMITTED', 'CANCELLED', 'operator')).toBe(true)
  })
  it('engine owns free-look ACTIVE->CANCELLED; system owns LAPSED/EXPIRED and reinstatement', () => {
    expect(canPolicyTransition('ACTIVE', 'CANCELLED', 'engine')).toBe(true)
    expect(canPolicyTransition('ACTIVE', 'LAPSED', 'system')).toBe(true)
    expect(canPolicyTransition('ACTIVE', 'EXPIRED', 'system')).toBe(true)
    expect(canPolicyTransition('LAPSED', 'ACTIVE', 'system')).toBe(true)
  })
  it('illegal jumps die for every actor: un-cancel, skip-submit, agent anything', () => {
    expect(canPolicyTransition('CANCELLED', 'ACTIVE', 'operator')).toBe(false)
    expect(canPolicyTransition('PENDING_SUBMISSION', 'ACTIVE', 'operator')).toBe(false)
    expect(canPolicyTransition('ACTIVE', 'CANCELLED', 'operator')).toBe(false) // post-activation cancel is the engine's (free-look) — owners are exclusive
    for (const t of POLICY_TRANSITIONS) expect(t.owner).not.toBe('agent') // the agent owns NOTHING
  })
})
