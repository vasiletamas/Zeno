import { describe, it, expect } from 'vitest'
import { RETENTION_POLICIES, DATA_CLASSES, dispositionFor } from '@/lib/gdpr/retention-policy'

describe('retention policy table (M3)', () => {
  it('declares a policy for every data class — exhaustive by construction', () => {
    for (const dc of DATA_CLASSES) expect(RETENTION_POLICIES[dc]).toBeDefined()
  })
  it('legally mandated classes are never erasable, even for never-contracted customers', () => {
    for (const dc of ['dnt_signed', 'policies', 'payments_schedules', 'consent_events', 'commit_ledger'] as const) {
      expect(dispositionFor(dc, { hasContracted: true })).not.toBe('erase')
      expect(dispositionFor(dc, { hasContracted: false })).not.toBe('erase')
      expect(RETENTION_POLICIES[dc].legalReviewPending).toBe(true) // durations flagged for legal confirmation
    }
  })
  it('conversations and soft profile data of never-contracted customers are fully erasable', () => {
    expect(dispositionFor('conversations_messages', { hasContracted: false })).toBe('erase')
    expect(dispositionFor('customer_profile', { hasContracted: false })).toBe('erase')
  })
  it('contracted customers get anonymize-retain for conversations (audit trail kept, PII gone)', () => {
    expect(dispositionFor('conversations_messages', { hasContracted: true })).toBe('anonymize_retain')
  })
})
