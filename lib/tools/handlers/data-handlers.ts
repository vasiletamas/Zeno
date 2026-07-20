/**
 * Data Handlers — Customer data collection
 *
 * collect_customer_field: validates and saves individual customer fields,
 * then returns a uiAction for the next needed field (or success when done).
 */

import { setDeclaredField, getProfile, type ProfileFieldName } from '@/lib/customer/profile-service'
import { verifiedChannelsFor, maskVerificationTarget } from '@/lib/customer/verification-service'
import { validateCnpChecksum, cnpMatchesDob } from '@/lib/engines/cnp-validation'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { valueNotGroundedError } from './grounding-guard'
import type { ToolHandler, ToolContext } from '@/lib/tools/types'

// ─────────────────────────────────────────────
// Field collection order
// ─────────────────────────────────────────────

// T28 (P5.1) data minimization: the card ladder collects the CONTACT pair
// ONLY. name/DOB/CNP arrive document-grade via ID extraction (T27) and are
// never demanded pre-acceptance; declaredAge is asked conversationally
// ("câți ani ai?") and recorded directly — it is NOT a ladder card.
export const FIELD_ORDER = ['email', 'phone'] as const

type CollectableField = (typeof FIELD_ORDER)[number]

// ─────────────────────────────────────────────
// Field metadata for uiAction payloads
// ─────────────────────────────────────────────

const FIELD_META: Record<
  CollectableField,
  {
    label: { en: string; ro: string }
    type: 'text' | 'email' | 'tel' | 'date' | 'textarea'
    validation?: { pattern?: string; minLength?: number; maxLength?: number }
    placeholder?: { en: string; ro: string }
  }
> = {
  email: {
    label: { en: 'Email address', ro: 'Adresa de email' },
    type: 'email',
    validation: { pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
    placeholder: { en: 'your@email.com', ro: 'email@exemplu.ro' },
  },
  phone: {
    label: { en: 'Phone number', ro: 'Numar de telefon' },
    type: 'tel',
    validation: { pattern: '^(\\+?40|0)\\d{9}$' },
    placeholder: { en: '+40 7XX XXX XXX', ro: '07XX XXX XXX' },
  },
}

// ─────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────

function validateField(
  field: string,
  value: string,
): { valid: boolean; error?: string } {
  const trimmed = value.trim()

  switch (field) {
    case 'name':
      if (trimmed.length < 2) return { valid: false, error: 'Name must be at least 2 characters.' }
      return { valid: true }

    case 'cnp': {
      const cnpPattern = /^[1-9]\d{12}$/
      if (!cnpPattern.test(trimmed)) {
        return { valid: false, error: 'CNP must be exactly 13 digits starting with 1-9.' }
      }
      return { valid: true }
    }

    case 'email': {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailPattern.test(trimmed)) {
        return { valid: false, error: 'Please enter a valid email address.' }
      }
      return { valid: true }
    }

    case 'phone': {
      const phonePattern = /^(\+?40|0)\d{9}$/
      if (!phonePattern.test(trimmed.replace(/[\s-]/g, ''))) {
        return { valid: false, error: 'Please enter a valid Romanian phone number.' }
      }
      return { valid: true }
    }

    case 'dateOfBirth': {
      const date = new Date(trimmed)
      if (isNaN(date.getTime())) {
        return { valid: false, error: 'Please enter a valid date.' }
      }
      // Check age 18-64
      const today = new Date()
      let age = today.getFullYear() - date.getFullYear()
      const monthDiff = today.getMonth() - date.getMonth()
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
        age--
      }
      if (age < 18) return { valid: false, error: 'Must be at least 18 years old.' }
      if (age > 64) return { valid: false, error: 'Must be 64 years old or younger.' }
      return { valid: true }
    }

    // T28: the declared age rates the quote — asked directly in conversation
    // ("câți ani ai?"), recorded here. Integer 18-120, nothing fancier.
    case 'declaredAge': {
      if (!/^\d{1,3}$/.test(trimmed)) return { valid: false, error: 'Declared age must be a whole number.' }
      const age = Number(trimmed)
      if (age < 18 || age > 120) return { valid: false, error: 'Declared age must be between 18 and 120.' }
      return { valid: true }
    }

    case 'address':
      if (!trimmed) return { valid: false, error: 'Address is required.' }
      return { valid: true }

    default:
      return { valid: true }
  }
}

// ─────────────────────────────────────────────
// T19: contact submission IS the consent
// ─────────────────────────────────────────────

/**
 * T19 (P3.4): submitting the email in a field labeled "for identity
 * verification" already authorizes the send — the commit declares a
 * data._autoChain to start_channel_verification so the orchestrator sends
 * the code and renders the OTP card in the SAME turn (T8 single-hop
 * contract), on both the card path and the agent-typed path. The model must
 * never ask "trimit codul...?" again (conv cmrm3fgku00056g0y4eb2hsme
 * messageIndex 66-74: three prose round-trips for one code send).
 *
 * GUARDED declaration (deliberate choice over declare-and-let-the-gateway-
 * reject): the guard mirrors the exposure rule for start_channel_verification
 * — no verified email channel, no live pending challenge — so the happy path
 * never ledgers a rejected hop. PHONE never chains while the SMS transport
 * is undeliverable (T20 owns phone).
 */
async function emailAutoChain(
  context: ToolContext,
  target: string,
): Promise<{ tool: string; args: Record<string, unknown> } | null> {
  if ((await verifiedChannelsFor(context.customerId, context.db)).includes('email')) return null
  // same query shape the snapshot loader uses for identity.pendingChallenge
  const pending = await context.db.verificationChallenge.findFirst({
    where: { customerId: context.customerId, consumedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  })
  if (pending) return null
  return { tool: 'start_channel_verification', args: { channel: 'email', target } }
}

/** The directive _message that rides the collect result when the chain is
 * declared — the model reads it AFTER the hop has already executed. */
const emailAutoChainMessage = (target: string): string =>
  `Contact saved. The verification code was ALREADY sent automatically to ${maskVerificationTarget('email', target)} — a code-entry card is shown. Do NOT ask whether to send the code and do NOT resend.`

// ─────────────────────────────────────────────
// collect_customer_field
// ─────────────────────────────────────────────

export const collectCustomerField: ToolHandler = async (args, context) => {
  const { field, value } = args as { field: string; value: string }

  try {
    // 1. Validate the field value
    const validation = validateField(field, value)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    // T28: residency backs the eligibility fact (op equals 'Romania') — the
    // canonical spelling is normalized deterministically so "românia"/"ROMANIA"
    // never fails the equals rule.
    const trimmedValue = field === 'residency' && /^rom[âa]nia$/i.test(value.trim())
      ? 'Romania'
      : value.trim()

    // T28: name/cnp/dateOfBirth stay SETTABLE (a volunteered value is never
    // refused) but live outside the collection ladder; residency backs the
    // eligibility fact the CNP used to imply.
    const KNOWN_FIELDS: ProfileFieldName[] = ['name', 'cnp', 'dateOfBirth', 'declaredAge', 'email', 'phone', 'address', 'residency']
    if (!KNOWN_FIELDS.includes(field as ProfileFieldName)) {
      return { success: false, error: `Unknown field: ${field}` }
    }

    // B3.3: deterministic CNP validation — the LLM is never the validator
    // (T4-R3). Checksum first, then consistency with an already-declared DOB.
    if (field === 'cnp') {
      if (!validateCnpChecksum(trimmedValue)) {
        return { success: false, error: 'cnp_checksum_invalid: the CNP control digit does not match — ask the customer to re-check the 13 digits.' }
      }
      const stored = await getProfile(context.customerId)
      const dob = stored.fields.dateOfBirth?.value
      if (dob && cnpMatchesDob(trimmedValue, new Date(dob)) === false) {
        return { success: false, error: `cnp_dob_mismatch: the CNP encodes a different birth date than the declared ${dob} — ask the customer which one is correct.` }
      }
    }

    // P0-1 write-guard: profile facts must come from the customer's words
    // (or a confirmed proposal) — never from the model's initiative.
    // Re-declaring the value already on record is idempotent, not invention.
    const existing = (await getProfile(context.customerId)).fields[field as ProfileFieldName]?.value ?? null
    const notGrounded = await valueNotGroundedError(context, trimmedValue, undefined, existing)
    if (notGrounded) return { success: false, error: notGrounded }

    // 2. Write through the SSOT service (declared provenance, mirrors handled there)
    const w = await setDeclaredField(context.customerId, field as ProfileFieldName, trimmedValue, 'collect_customer_field')
    if (w.outcome === 'rejected') {
      return {
        success: false,
        error: 'Cannot overwrite a verified value (field_verified_immutable). A document or operator override is required.',
      }
    }

    // T19: an applied email collect declares the guarded auto-send — the
    // orchestrator executes the hop; this handler only DECLARES it.
    const autoChain = field === 'email' ? await emailAutoChain(context, trimmedValue) : null

    // 3. Ladder auto-advance (spec 2026-07-20 §4). ONLY a ladder-member save
    // may advance the contact ladder (conv cmrrhruba turns 6/10: declaredAge/
    // residency must not demand contact), the next field must be DUE (phone
    // waits for a quote — Ruling 2), and a declared auto-chain hands the turn
    // to the OTP card (turn 8: two competing input cards).
    const isLadderSave = (FIELD_ORDER as readonly string[]).includes(field)
    let nextField: CollectableField | null = null
    if (isLadderSave && !autoChain) {
      const profile = await getProfile(context.customerId)
      for (const f of FIELD_ORDER) {
        if (!(f in profile.fields)) {
          nextField = f
          break
        }
      }
      if (nextField === 'phone') {
        const snap = await loadDomainSnapshot(context.conversationId, context.db)
        if (snap.quote === null) nextField = null
      }
    }

    // 4. Result assembly — card only when the ladder produced a due nextField.
    const baseData: Record<string, unknown> = {
      fieldSaved: field,
      ...(w.mirrorConflict ? { mirrorConflict: w.mirrorConflict } : {}),
      ...(autoChain ? { _autoChain: autoChain } : {}),
    }
    if (nextField) {
      const meta = FIELD_META[nextField]
      return {
        success: true,
        data: { ...baseData, nextField },
        message: `${field} saved. Please provide ${nextField}.`,
        uiAction: {
          type: 'show_data_field',
          payload: {
            field: nextField,
            label: meta.label,
            type: meta.type,
            validation: meta.validation ?? null,
            placeholder: meta.placeholder ?? null,
          } as unknown as Record<string, unknown>,
        },
      }
    }
    return {
      success: true,
      data: baseData,
      message: autoChain ? emailAutoChainMessage(trimmedValue) : `${field} saved.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// defer_customer_field (spec 2026-07-20 §1, Ruling 6)
// ─────────────────────────────────────────────

/**
 * A customer's "not now" on a contact ask is a recorded FACT, not a card
 * operation. The deferral row derives the card to status 'deferred' (Task 8);
 * a later provided value simply supersedes (field presence wins).
 */
export const deferCustomerField: ToolHandler = async (args, context) => {
  const { field, reason } = args as { field: string; reason?: string }
  if (!(FIELD_ORDER as readonly string[]).includes(field)) {
    return { success: false, error: `invalid_args: only contact fields (${FIELD_ORDER.join(', ')}) can be deferred.` }
  }
  await context.db.profileFieldDeferral.create({
    data: { customerId: context.customerId, field, conversationId: context.conversationId, reason: reason ?? null },
  })
  return {
    success: true,
    data: { fieldDeferred: field },
    message: `${field} deferral recorded — do not ask again this conversation; the card is released.`,
  }
}
