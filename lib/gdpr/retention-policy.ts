/**
 * Retention policy (E3.1, M3) — a typed CONFIG module, NOT a DB table.
 *
 * One declared disposition per data class, split on the never-contracted
 * distinction: a customer who never bought anything has no insurance-law
 * retention duty hanging over their chat history (full erase), while a
 * contracted customer's audit trail is anonymized-and-retained and the
 * legally mandated records (policies, payments, signed DNT, consent proof,
 * commit ledger) are retained outright. Durations and bases carry
 * legalReviewPending — LEGAL/COMPLIANCE INPUT REQUIRED (M3.4) before
 * production; the flags make the pending questions greppable.
 */
export const DATA_CLASSES = [
  'customer_identity',      // Customer name/email/phone/cnp/dob/address
  'customer_profile',       // B0 provenance rows, insights, extracted soft data
  'conversations_messages', // Conversation, Message (user-authored content)
  'dnt_signed',             // signed Dnt aggregates (insurance-law retention)
  'dnt_unsigned_sessions',  // unsigned DntSession drafts
  'applications',           // incl. application-scoped answers
  'quotes',
  'payments_schedules',     // Payment, PaymentSchedule (financial records)
  'policies',
  'consent_events',         // B1 ledger — proof of consent is itself retained
  'commit_ledger',          // A2 ledger — references not values (T14.D5)
  'work_items',
  'documents_evidence',     // Document registry + CustomerDocument evidence records
  'turn_debug',             // short-lived; erase freely
] as const
export type DataClass = (typeof DATA_CLASSES)[number]

export type RetentionDisposition = 'erase' | 'anonymize_retain' | 'retain_mandated'

export interface RetentionPolicy {
  whenNeverContracted: RetentionDisposition
  whenContracted: RetentionDisposition
  legalBasis: string
  retentionYears: number | null   // null = indefinite pending legal input
  legalReviewPending: boolean     // durations & bases flagged for legal confirmation (M3.4)
}

export const RETENTION_POLICIES: Record<DataClass, RetentionPolicy> = {
  customer_identity:      { whenNeverContracted: 'erase', whenContracted: 'anonymize_retain', legalBasis: 'GDPR art.17; AML/insurance retention when contracted', retentionYears: null, legalReviewPending: true },
  customer_profile:       { whenNeverContracted: 'erase', whenContracted: 'erase',            legalBasis: 'soft profile data, no retention duty', retentionYears: 0, legalReviewPending: false },
  conversations_messages: { whenNeverContracted: 'erase', whenContracted: 'anonymize_retain', legalBasis: 'audit trail when contracted', retentionYears: null, legalReviewPending: true },
  dnt_signed:             { whenNeverContracted: 'retain_mandated', whenContracted: 'retain_mandated', legalBasis: 'IDD demands-and-needs record', retentionYears: null, legalReviewPending: true },
  // P0-2: pre-sign collection rides GDPR Art. 6(1)(b) (steps at the data
  // subject's request prior to a contract); the basis lapses with the
  // abandoned request — cleanupUnsignedDntSessions (lib/gdpr/retention-cleanup.ts)
  // deletes drafts inactive beyond UNSIGNED_DNT_RETENTION_DAYS.
  dnt_unsigned_sessions:  { whenNeverContracted: 'erase', whenContracted: 'erase', legalBasis: 'unsigned drafts — Art. 6(1)(b) pre-contractual basis; deleted after the inactivity window by the retention cleanup job', retentionYears: 0, legalReviewPending: false },
  applications:           { whenNeverContracted: 'erase', whenContracted: 'anonymize_retain', legalBasis: 'pre-contractual record when contracted', retentionYears: null, legalReviewPending: true },
  quotes:                 { whenNeverContracted: 'erase', whenContracted: 'anonymize_retain', legalBasis: 'acceptance evidence when contracted', retentionYears: null, legalReviewPending: true },
  payments_schedules:     { whenNeverContracted: 'retain_mandated', whenContracted: 'retain_mandated', legalBasis: 'financial records', retentionYears: null, legalReviewPending: true },
  policies:               { whenNeverContracted: 'retain_mandated', whenContracted: 'retain_mandated', legalBasis: 'insurance contract record', retentionYears: null, legalReviewPending: true },
  consent_events:         { whenNeverContracted: 'retain_mandated', whenContracted: 'retain_mandated', legalBasis: 'proof of consent/withdrawal', retentionYears: null, legalReviewPending: true },
  commit_ledger:          { whenNeverContracted: 'retain_mandated', whenContracted: 'retain_mandated', legalBasis: 'audit substrate; stores references not values', retentionYears: null, legalReviewPending: true },
  work_items:             { whenNeverContracted: 'anonymize_retain', whenContracted: 'anonymize_retain', legalBasis: 'operational record incl. the erasure decision itself', retentionYears: null, legalReviewPending: true },
  documents_evidence:     { whenNeverContracted: 'erase', whenContracted: 'retain_mandated', legalBasis: 'KYC evidence when contracted', retentionYears: null, legalReviewPending: true },
  turn_debug:             { whenNeverContracted: 'erase', whenContracted: 'erase', legalBasis: 'short-lived diagnostics (T14.D5)', retentionYears: 0, legalReviewPending: false },
}

export function dispositionFor(dc: DataClass, ctx: { hasContracted: boolean }): RetentionDisposition {
  const p = RETENTION_POLICIES[dc]
  return ctx.hasContracted ? p.whenContracted : p.whenNeverContracted
}
