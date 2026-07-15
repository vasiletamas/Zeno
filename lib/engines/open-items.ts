/**
 * deriveOpenItems (E4.2, M2 pinned contract): the customer's open items as
 * {kind, refId, age, nextAction} over the five M2 kinds — application,
 * quote, installment, dnt_expiring, policy_in_progress.
 *
 * PURE over deriveAndExpose OUTPUT — it never recomputes legality. The
 * briefing-integrity invariant applies to re-engagement: nextAction MUST
 * be a currently-exposed action, with escalate_to_human as the
 * always-exposed floor (M10). Kind-preferred actions use the LIVE tool
 * vocabulary (erratum 2 generalized — no retired names).
 */
import type { DerivedStateV3, BlockedAction } from '@/lib/engines/domain-types'
import { DNT_EXPIRY_WINDOW_DAYS } from '@/lib/engagement/config'

export interface ExposedActions { available: string[]; blocked: BlockedAction[] }

export type OpenItemKind = 'application' | 'quote' | 'installment' | 'dnt_expiring' | 'policy_in_progress'
export interface OpenItem { kind: OpenItemKind; refId: string; age: number; nextAction: string }

const DAY = 24 * 60 * 60 * 1000
const FLOOR = 'escalate_to_human' // always exposed (M10)
const ageDays = (sinceIso: string | undefined, now: Date): number =>
  sinceIso ? Math.max(0, Math.floor((now.getTime() - new Date(sinceIso).getTime()) / DAY)) : 0

function pick(preferred: string[], actions: ExposedActions): string {
  return preferred.find((a) => actions.available.includes(a)) ?? FLOOR
}

export function deriveOpenItems(state: DerivedStateV3, actions: ExposedActions, now: Date): OpenItem[] {
  const items: OpenItem[] = []

  if (state.application && (state.application.status === 'OPEN' || state.application.status === 'PAUSED')) {
    items.push({
      kind: 'application', refId: state.application.id, age: ageDays(state.application.createdAt, now),
      nextAction: pick(['write_question_answer', 'select_coverage', 'generate_quote', 'resume_application'], actions),
    })
  }

  if (state.quote && state.quote.status === 'ISSUED' && !state.quote.expired) {
    items.push({
      kind: 'quote', refId: state.quote.id, age: ageDays(state.quote.createdAt, now),
      nextAction: pick(['accept_quote', 'acknowledge_disclosures', 'get_quote_info'], actions),
    })
  }

  if (state.schedule.exists && !state.schedule.settled && state.schedule.nextDueAt !== null) {
    items.push({
      kind: 'installment', refId: state.schedule.id ?? 'schedule', age: ageDays(state.schedule.nextDueAt, now),
      nextAction: pick(['ensure_payment_session', 'get_payment_status'], actions),
    })
  }

  const latest = state.dnt.latest
  if (latest && latest.status === 'ACTIVE') {
    const until = new Date(latest.validUntil).getTime()
    if (until > now.getTime() && until - now.getTime() <= DNT_EXPIRY_WINDOW_DAYS * DAY) {
      items.push({
        kind: 'dnt_expiring', refId: latest.id ?? 'dnt', age: ageDays(latest.signedAt, now),
        nextAction: pick(['open_dnt_session', 'get_dnt_state'], actions),
      })
    }
  }

  if (state.policy && (state.policy.status === 'PENDING_SUBMISSION' || state.policy.status === 'SUBMITTED')) {
    items.push({
      kind: 'policy_in_progress', refId: state.policy.id, age: ageDays(state.policy.createdAt, now),
      nextAction: pick(['get_policy_info'], actions),
    })
  }

  return items
}
