/**
 * Spec-side taxonomy weld (F1.5, T12.D5 §3).
 *
 * Deviation from the plan literal: the pinned import path
 * '@/lib/engines/commit-contract' does not exist — Block A's CommitOutcome/
 * CommitEffect unions live in lib/engines/domain-types.ts.
 */
import type { CommitOutcome, CommitEffect } from '@/lib/engines/domain-types'

export const COMMIT_OUTCOMES = [
  'applied', 'rejected', 'referred', 'pending', 'unavailable',
  'requires_confirmation', 'requires_identity', 'requires_consent', 'requires_disclosures',
] as const satisfies readonly CommitOutcome[]

export const COMMIT_EFFECTS = [
  'advance_phase', 're_rating', 'cascade_invalidate', 'cascade_expand',
  'questions_removed', 'eligibility_recheck', 'terminal',
] as const satisfies readonly CommitEffect[]

// Compile-time exhaustiveness: a union member missing from the arrays is a type error.
type AssertNever<T extends never> = T
export type _OutcomesExhaustive = AssertNever<Exclude<CommitOutcome, (typeof COMMIT_OUTCOMES)[number]>>
export type _EffectsExhaustive = AssertNever<Exclude<CommitEffect, (typeof COMMIT_EFFECTS)[number]>>

export const TAXONOMY = [...COMMIT_OUTCOMES, ...COMMIT_EFFECTS] as const

/** Union members the .feature does not mention yet. The delivered 2026-07-03
 * spec already carries the M10 amendments (unavailable/pending appear in the
 * catalog taxonomy and the quote-generation Examples), so this starts EMPTY —
 * the state the plan had F3 drive it to. */
export const PENDING_SPEC_AMENDMENTS: readonly string[] = []
