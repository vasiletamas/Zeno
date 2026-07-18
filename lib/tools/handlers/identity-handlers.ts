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
import type { ToolHandler, ToolContext } from '@/lib/tools/types'

type Db = ToolContext['db']

/**
 * T26: the account is BORN the moment a channel is proven. Find-or-create the
 * User on the CANONICAL customer (a merged shell never gets one) and
 * de-anonymize in the same tx. Settlement's flip stays as belt-and-braces.
 * Returns whether a NEW User row was created.
 */
async function ensureAccount(db: Db, canonicalCustomerId: string, email: string): Promise<boolean> {
  const existing = await db.user.findFirst({
    where: { OR: [{ customerId: canonicalCustomerId }, { email }] },
  })
  await db.customer.update({ where: { id: canonicalCustomerId }, data: { isAnonymous: false } })
  if (existing) return false
  await db.user.create({ data: { email, role: 'CUSTOMER', customerId: canonicalCustomerId } })
  return true
}

/**
 * T27: guarded _autoChain — the ID-upload card rides the OTP-confirm commit
 * so the document demand never ambushes the customer at the payment gate
 * (ensure_payment_session → requires_identity: document:id_card). Guarded
 * like T19's email chain: only when the conversation's product actually
 * requires an id_card for some commit AND none is validated yet.
 */
async function idUploadAutoChain(
  db: Db,
  canonicalCustomerId: string,
  conversationId: string,
): Promise<{ tool: string; args: Record<string, unknown> } | null> {
  const conversation = await db.conversation.findUnique({ where: { id: conversationId }, select: { productId: true } })
  if (!conversation?.productId) return null
  const product = await db.product.findUnique({ where: { id: conversation.productId }, select: { verificationRequirements: true } })
  const requirements = (product?.verificationRequirements ?? {}) as Record<string, string[]>
  const needsIdCard = Object.values(requirements).some((kinds) => Array.isArray(kinds) && kinds.includes('id_card'))
  if (!needsIdCard) return null
  const validated = await db.customerDocument.findFirst({
    where: { customerId: canonicalCustomerId, kind: 'id_card', status: 'validated' },
    select: { id: true },
  })
  if (validated) return null
  return { tool: 'request_document_upload', args: { kind: 'id_card' } }
}

const ID_UPLOAD_DIRECTIVE =
  'The ID-upload card is already shown — the document completes the profile (name, birth date, CNP) automatically with document-grade provenance; do NOT ask for those by mouth.'

export const startChannelVerification: ToolHandler = async (args, context) => {
  const channel = args.channel as 'email' | 'sms'
  const target = String(args.target ?? '').trim()
  try {
    if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      return { success: false, error: 'invalid_args: target is not a valid email address.' }
    }
    if (channel === 'sms') {
      // The SMS transport is not implemented (B3.5 placeholder) — a standing
      // sms challenge could never be satisfied, and Task 1.1's re-send guard
      // would then wall the funnel behind an undeliverable code. Reject with
      // the redirect until a real SMS provider lands.
      // T20: this reject is the DEFENSE-IN-DEPTH layer behind the manifest +
      // zod schema, which both derive from availableVerificationChannels()
      // (lib/channels/availability.ts) and already exclude sms while no
      // SMS_PROVIDER is configured. Keep it even after those layers agree.
      return { success: false, error: 'invalid_args: SMS verification is not available yet — verify the EMAIL address instead (start_channel_verification with channel "email").' }
    }
    await issueChallenge(context.customerId, channel, target, context.conversationId, context.db)
    // anti-enumeration: the payload never says whether the target belongs to
    // an account — the same response either way.
    const channelMasked = maskTarget(channel, target)
    return {
      success: true,
      data: { channelMasked },
      message: channel === 'email'
        ? 'A 6-digit verification code was sent by email (it also contains a one-click link). Ask the customer to read the code back or click the link.'
        : 'A verification challenge was prepared for this phone number.',
      // T29: the card shows the masked target; the raw target rides so the
      // resend affordance can re-issue via start_channel_verification{resend}.
      uiAction: { type: 'show_otp_entry', payload: { channel, targetMasked: channelMasked, target } },
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
      // keepWrites (P0-2): a wrong code DECREMENTS attemptsRemaining — a
      // security rate-limit fact that MUST survive this rejection, or the
      // rollback would hand the attacker unlimited guesses.
      return {
        success: false,
        error: `${r.reason}: ${prose[r.reason]}`,
        data: r.attemptsRemaining !== undefined ? { attemptsRemaining: r.attemptsRemaining } : undefined,
        keepWrites: true,
      }
    }

    // Verified claim path (T4.D4) — shared with the magic-link route so the
    // two presentations cannot diverge; runs inside the gateway tx.
    const claim = await applyVerifiedClaim(r, context.db)
    const canonicalId = claim.merged ? claim.customerId : context.customerId

    // T26: the proven channel is the account-birth moment (same tx).
    const accountCreated = r.channel === 'email'
      ? await ensureAccount(context.db, canonicalId, r.target)
      : false

    // T27: front-load the ID upload — the card rides THIS commit.
    const autoChain = await idUploadAutoChain(context.db, canonicalId, context.conversationId)

    if (claim.merged) {
      return {
        success: true,
        data: {
          customerId: claim.customerId,
          merged: true,
          channel: r.channel,
          accountCreated,
          ...(autoChain ? { _autoChain: autoChain } : {}),
        },
        message:
          'Channel verified — this contact already had an account, so the conversation now continues on it with the customer’s history.' +
          (autoChain ? ` ${ID_UPLOAD_DIRECTIVE}` : ''),
      }
    }
    return {
      success: true,
      data: {
        customerId: context.customerId,
        verified: true,
        channel: r.channel,
        accountCreated,
        ...(autoChain ? { _autoChain: autoChain } : {}),
      },
      message: 'Channel verified.' + (autoChain ? ` ${ID_UPLOAD_DIRECTIVE}` : ''),
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
