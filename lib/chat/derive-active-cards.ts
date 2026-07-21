/**
 * Card-state SSOT (spec 2026-07-20 §1): the server's answer to "what inputs
 * is the customer currently being asked for, and what is each one's status?"
 * Extends the derive-pending-card reload-parity precedent to the full input-
 * card set. Consumed by: the orchestrator's turn-end cards_state SSE event,
 * the /chat/[id] reload seed, and the ON-SCREEN CARDS briefing section.
 *
 * Set contract: only pending obligations appear. `resolved`/`superseded`
 * materialize as ABSENCE — a rendered card whose key is missing renders
 * inert client-side; the briefing prints only present entries.
 */
import { prisma } from '@/lib/db'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { getProfile, getFieldDeferrals } from '@/lib/customer/profile-service'
import { maskVerificationTarget } from '@/lib/customer/verification-service'
import { derivePendingCard } from './derive-pending-card'
import { FIELD_META_FOR_CARDS } from '@/lib/tools/handlers/data-handlers'
import { questionKeyFor, inputCardRank, type ActiveCardEntry } from './card-view'

export type { ActiveCardStatus } from './card-view'
/** Server-side entry: the canonical shared shape (lib/chat/card-view.ts —
 * pure, client-safe) with the briefing hint REQUIRED (spec §5). */
export type ActiveCard = ActiveCardEntry & { hint: string }

export async function deriveActiveCards(conversationId: string): Promise<ActiveCard[]> {
  const snapshot = await loadDomainSnapshot(conversationId)
  const customerId = snapshot.customerId
  const [profile, deferrals] = await Promise.all([getProfile(customerId), getFieldDeferrals(customerId)])
  const cards: ActiveCard[] = []

  // ---- data_field ladder (Ruling 2: email at application start, phone at quote)
  const emailDue = snapshot.application !== null || snapshot.dnt.sessionActive
    || deriveAndExpose(snapshot).actions.available.includes('open_dnt_session')
  const fieldCard = (field: 'email' | 'phone'): ActiveCard => deferrals.includes(field)
    ? { key: `data_field:${field}`, status: 'deferred', hint: `customer declined ${field} for now — do NOT re-ask; resumes only if they offer it` }
    : {
        key: `data_field:${field}`, status: 'active',
        uiAction: { type: 'show_data_field', payload: FIELD_META_FOR_CARDS[field] },
        hint: `the ${field} card owns this input — invite the customer to fill it; do not re-ask in prose`,
      }
  if (!('email' in profile.fields) && emailDue) cards.push(fieldCard('email'))
  if (!('phone' in profile.fields) && snapshot.quote !== null && 'email' in profile.fields) cards.push(fieldCard('phone'))

  // ---- otp: latest unconsumed challenge, INCLUDING expired (expiry is a
  // status, never a disappearance — spec §1; the snapshot's pendingChallenge
  // filters expired, so query directly)
  const challenge = await prisma.verificationChallenge.findFirst({
    where: { customerId, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (challenge && !snapshot.identity.verifiedChannels.includes(challenge.channel as 'email' | 'sms')) {
    const expired = challenge.expiresAt <= new Date()
    // An EXPIRED card is a recovery affordance for the flow that raised it, so
    // it stays in its own conversation: browser-verified 2026-07-21 that a
    // stale expired challenge otherwise greeted a BRAND-NEW conversation with
    // a context-free "Codul a expirat" before the customer had said anything.
    // A LIVE challenge keeps customer scope — the verification blocks the
    // funnel wherever the customer continues (matches snapshot.pendingChallenge
    // and the identity gate, both customer-scoped).
    const foreignExpired = expired && challenge.conversationId !== null && challenge.conversationId !== conversationId
    if (!foreignExpired) cards.push({
      key: `otp:${challenge.channel}`,
      status: expired ? 'expired' : 'active',
      uiAction: { type: 'show_otp_entry', payload: { channel: challenge.channel, target: challenge.target, targetMasked: maskVerificationTarget(challenge.channel as 'email' | 'sms', challenge.target) } },
      hint: expired
        ? 'the code EXPIRED — offer to resend (start_channel_verification); never ask for the old code'
        : 'a code-entry card is live — ask for the 6-digit code or the email link; do not resend unprompted',
    })
  }

  // ---- question: reuse the existing reload-parity derivation verbatim
  // (injecting the in-hand snapshot: same instant as the other families,
  // one snapshot load per derivation)
  const pending = await derivePendingCard(conversationId, snapshot)
  if (pending) {
    const payload = pending.payload as Record<string, unknown>
    // the ONE batch-key literal lives in card-view.ts — questionKeyFor keeps
    // this key construction and the client's cardKeyForUiAction in lockstep
    const code = (payload.code ?? (payload.question as { code?: string | null } | undefined)?.code ?? null) as string | null
    cards.push({ key: questionKeyFor(code), status: 'active', uiAction: pending as ActiveCard['uiAction'], hint: 'the question card owns this input — invite a tap, never enumerate options in prose' })
  }

  // ---- confirm: ledger-derived pending confirmations (existing P0-5 fact)
  for (const tool of snapshot.pendingConfirmationTools ?? []) {
    cards.push({ key: `confirm:${tool}`, status: 'active', hint: `a ${tool} confirmation card awaits the customer's tap — do NOT call ${tool} again` })
  }

  return queueAllButOneInput(cards)
}

/**
 * ONE input card owns the customer's attention (2026-07-21, conv cmruelpy7
 * turn 2: an OTP card and TWO question cards went live together — a 6-digit
 * code and a medical answer demanded at once, with nothing saying which one
 * the conversation was waiting on).
 *
 * The earliest funnel blocker keeps `active` (INPUT_CARD_PRIORITY: identity
 * verification gates every downstream commit, then the questionnaire, then
 * contact collection); every other RENDERABLE input card drops to `queued`.
 * Non-input entries (confirm:*, which carry no uiAction) and cards that are
 * already expired/deferred never take the slot and are left untouched.
 */
function queueAllButOneInput(cards: ActiveCard[]): ActiveCard[] {
  const contenders = cards
    .filter((c) => c.status === 'active' && c.uiAction)
    .sort((a, b) => inputCardRank(a.key) - inputCardRank(b.key))
  const winner = contenders[0]
  if (!winner || contenders.length === 1) return cards
  return cards.map((c) =>
    c === winner || c.status !== 'active' || !c.uiAction
      ? c
      : { ...c, status: 'queued' as const, hint: `queued behind ${winner.key} — do NOT ask for this yet; it becomes available once that card is resolved` },
  )
}
