/**
 * P1-4 (2026-07-15 hardening): replay identities for application-scoped
 * answer commits must include the application INSTANCE id. Without it a
 * same-value re-answer of the same question in a LATER application (same
 * conversation) hashes identically to the first and replays the stale
 * envelope, silently skipping the new write.
 *
 * Pure unit test on the exported resolveTargetRef — the targetRef feeds the
 * material args hash, so two application instances producing different
 * targetRefs is exactly what stops the cross-instance replay.
 */
import { describe, it, expect } from 'vitest'
import { resolveTargetRef } from '@/lib/tools/gateway'
import type { DerivedStateV3 } from '@/lib/engines/domain-types'

const stateWithApp = (id: string | null): DerivedStateV3 =>
  ({ application: id ? { id } : null } as unknown as DerivedStateV3)

describe('resolveTargetRef application-instance scoping (P1-4)', () => {
  it('write_question_answer includes the application id so two instances never collide', () => {
    const a = resolveTargetRef('write_question_answer', { questionCode: 'Q_SMOKER' }, stateWithApp('app_1'), 'conv')
    const b = resolveTargetRef('write_question_answer', { questionCode: 'Q_SMOKER' }, stateWithApp('app_2'), 'conv')
    expect(a).not.toBe(b)
    expect(a).toContain('app_1')
    expect(b).toContain('app_2')
    expect(a).toContain('Q_SMOKER')
  })

  it('modify_answer includes the application id', () => {
    const a = resolveTargetRef('modify_answer', { questionCode: 'Q_SMOKER' }, stateWithApp('app_1'), 'conv')
    const b = resolveTargetRef('modify_answer', { questionCode: 'Q_SMOKER' }, stateWithApp('app_2'), 'conv')
    expect(a).not.toBe(b)
  })

  it('a same-question answer within the SAME application instance keeps a stable ref (intra-instance replay still works)', () => {
    const a = resolveTargetRef('write_question_answer', { questionCode: 'Q_SMOKER' }, stateWithApp('app_1'), 'conv')
    const b = resolveTargetRef('write_question_answer', { questionCode: 'Q_SMOKER' }, stateWithApp('app_1'), 'conv')
    expect(a).toBe(b)
  })
})
