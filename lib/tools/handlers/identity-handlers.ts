/**
 * Identity Handlers (B3.5) — in-chat channel verification commits.
 *
 * start_channel_verification issues ONE challenge (OTP + magic link in the
 * same email) and NEVER discloses whether the target matches an existing
 * account (anti-enumeration, T4.D4). confirm_channel_verification consumes
 * it; when the verified target belongs to another customer, the anonymous
 * shell is claim-and-merged INTO the verified owner inside the gateway
 * transaction — the conversation is repointed and the envelope carries the
 * canonical customerId for the session layer to rebind.
 */
import { issueChallenge, confirmByCode, applyVerifiedClaim, maskVerificationTarget as maskTarget } from '@/lib/customer/verification-service'
import type { ToolHandler } from '@/lib/tools/types'

export const startChannelVerification: ToolHandler = async (args, context) => {
  const channel = args.channel as 'email' | 'sms'
  const target = String(args.target ?? '').trim()
  try {
    if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      return { success: false, error: 'invalid_args: target is not a valid email address.' }
    }
    if (channel === 'sms' && !/^(\+?40|0)\d{9}$/.test(target.replace(/[\s-]/g, ''))) {
      return { success: false, error: 'invalid_args: target is not a valid Romanian phone number.' }
    }
    await issueChallenge(context.customerId, channel, target, context.conversationId, context.db)
    // anti-enumeration: the payload never says whether the target belongs to
    // an account — the same response either way.
    return {
      success: true,
      data: { channelMasked: maskTarget(channel, target) },
      message: channel === 'email'
        ? 'A 6-digit verification code was sent by email (it also contains a one-click link). Ask the customer to read the code back or click the link.'
        : 'A verification challenge was prepared for this phone number.',
      uiAction: { type: 'show_otp_entry', payload: { channel } },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export const requestDocumentUpload: ToolHandler = async (args, _context) => {
  const kind = (args.kind as string | undefined) ?? 'id_card'
  if (kind !== 'id_card') {
    return { success: false, error: 'invalid_args: unsupported document kind.' }
  }
  // The agent never touches the image (Stripe-card pattern, T14.D5): the
  // customer uploads through the GUI control straight to the upload route.
  return {
    success: true,
    data: { kind },
    message: 'A secure upload control is shown to the customer. The document is checked automatically; you will see the result in the state.',
    uiAction: { type: 'show_document_upload', payload: { kind, uploadUrl: '/api/documents/upload' } },
  }
}

export const confirmChannelVerification: ToolHandler = async (args, context) => {
  const code = String(args.code ?? '').trim()
  try {
    const r = await confirmByCode(context.customerId, code, context.db)
    if (!r.ok) {
      const prose: Record<string, string> = {
        no_active_challenge: 'there is no active verification — start one first.',
        code_mismatch: 'the code does not match — ask the customer to re-check it.',
        attempts_exhausted: 'too many wrong attempts — start a fresh verification.',
        expired_or_consumed: 'this verification expired or was already used — start a fresh one.',
      }
      // Task 1.1 (D5): the envelope carries the live attempt budget so the
      // agent can tell the customer how many tries are left instead of
      // silently re-sending a fresh code.
      return {
        success: false,
        error: `${r.reason}: ${prose[r.reason]}`,
        data: r.attemptsRemaining !== undefined ? { attemptsRemaining: r.attemptsRemaining } : undefined,
      }
    }

    // Verified claim path (T4.D4) — shared with the magic-link route so the
    // two presentations cannot diverge; runs inside the gateway tx.
    const claim = await applyVerifiedClaim(r, context.db)
    if (claim.merged) {
      return {
        success: true,
        data: { customerId: claim.customerId, merged: true, channel: r.channel },
        message: 'Channel verified — this contact already had an account, so the conversation now continues on it with the customer’s history.',
      }
    }
    return {
      success: true,
      data: { customerId: context.customerId, verified: true, channel: r.channel },
      message: 'Channel verified.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
