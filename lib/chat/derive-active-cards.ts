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

export type ActiveCardStatus = 'active' | 'expired' | 'deferred'
export interface ActiveCard {
  key: string
  status: ActiveCardStatus
  /** Renderable payload — INPUT cards only (data_field/otp/question). */
  uiAction?: { type: string; payload: Record<string, unknown> } | null
  /** Briefing conduct hint, server-authored (spec §5). */
  hint: string
}

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
    cards.push({
      key: `otp:${challenge.channel}`,
      status: expired ? 'expired' : 'active',
      uiAction: { type: 'show_otp_entry', payload: { channel: challenge.channel, target: challenge.target, targetMasked: maskVerificationTarget(challenge.channel as 'email' | 'sms', challenge.target) } },
      hint: expired
        ? 'the code EXPIRED — offer to resend (start_channel_verification); never ask for the old code'
        : 'a code-entry card is live — ask for the 6-digit code or the email link; do not resend unprompted',
    })
  }

  // ---- question: reuse the existing reload-parity derivation verbatim
  const pending = await derivePendingCard(conversationId)
  if (pending) {
    const payload = pending.payload as Record<string, unknown>
    const code = (payload.code ?? (payload.question as { code?: string } | undefined)?.code ?? 'batch') as string
    cards.push({ key: `question:${code}`, status: 'active', uiAction: pending as ActiveCard['uiAction'], hint: 'the question card owns this input — invite a tap, never enumerate options in prose' })
  }

  // ---- confirm: ledger-derived pending confirmations (existing P0-5 fact)
  for (const tool of snapshot.pendingConfirmationTools ?? []) {
    cards.push({ key: `confirm:${tool}`, status: 'active', hint: `a ${tool} confirmation card awaits the customer's tap — do NOT call ${tool} again` })
  }

  return cards
}
