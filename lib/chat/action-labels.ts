/**
 * Action-turn message labels (T22).
 *
 * Evidence (2026-07-15 live test): after reload, past card interactions
 * rendered as raw user bubbles "[Action: answer_question]" — the customer
 * could not see what they answered or signed.
 *
 * The route (app/api/chat/route.ts) is the ONLY writer of the synthesized
 * action message; it now persists `ACTION_MESSAGE_PREFIX + actionLabel(...)`
 * — a localized, PII-safe summary derived from the action object at
 * persistence time. MessageBubble classifies persisted content through
 * `renderKind` and renders both the new prefix and the legacy "[Action: …]"
 * marker as muted chips, never raw.
 *
 * PII rules: OTP codes are NEVER echoed; phone is masked to the last 3
 * digits; CNP is masked to the first 3 characters; email rides as-is.
 */

export const ACTION_MESSAGE_PREFIX = '⟦action⟧'

export type ActionLabelLanguage = 'en' | 'ro'

interface ActionLike {
  type: string
  payload?: Record<string, unknown>
}

/** Generic fallback — also the chip label for legacy "[Action: …]" rows. */
export const GENERIC_INTERACTION_LABELS: Record<ActionLabelLanguage, string> = {
  ro: '✓ Interacțiune',
  en: '✓ Interaction',
}

const ANSWER_HEAD: Record<ActionLabelLanguage, string> = {
  ro: '✓ Răspuns',
  en: '✓ Answer',
}

const BOOLEAN_ANSWER: Record<ActionLabelLanguage, Record<'true' | 'false', string>> = {
  ro: { true: 'Da', false: 'Nu' },
  en: { true: 'Yes', false: 'No' },
}

const FIXED_LABELS: Record<string, Record<ActionLabelLanguage, string>> = {
  medical_batch: { ro: '✓ Declarații medicale completate', en: '✓ Medical declarations completed' },
  sign_dnt: { ro: '✓ Analiza de nevoi semnată', en: '✓ Needs analysis signed' },
  sign_medical_declarations: { ro: '✓ Declarații medicale semnate', en: '✓ Medical declarations signed' },
  accept_quote: { ro: '✓ Ofertă acceptată', en: '✓ Quote accepted' },
  cancel_quote: { ro: '✓ Ofertă anulată', en: '✓ Quote cancelled' },
  otp_submit: { ro: '✓ Cod de verificare introdus', en: '✓ Verification code entered' },
  otp_resend: { ro: '✓ Cod retrimis', en: '✓ Code resent' },
  document_uploaded: { ro: '✓ Document încărcat', en: '✓ Document uploaded' },
  payment_complete: { ro: '✓ Plată efectuată', en: '✓ Payment completed' },
  select_tier: { ro: '✓ Pachet selectat', en: '✓ Package selected' },
  select_level: { ro: '✓ Pachet selectat', en: '✓ Package selected' },
  select_coverage: { ro: '✓ Pachet selectat', en: '✓ Package selected' },
}

/** collect_customer_field field names (lib/tools/handlers/data-handlers.ts). */
const FIELD_LABELS: Record<string, Record<ActionLabelLanguage, string>> = {
  email: { ro: 'Email', en: 'Email' },
  phone: { ro: 'Telefon', en: 'Phone' },
  name: { ro: 'Nume', en: 'Name' },
  dateOfBirth: { ro: 'Data nașterii', en: 'Date of birth' },
  declaredAge: { ro: 'Vârstă declarată', en: 'Declared age' },
  cnp: { ro: 'CNP', en: 'CNP' },
  address: { ro: 'Adresă', en: 'Address' },
}

function resolveAnswer(payload: Record<string, unknown>, lang: ActionLabelLanguage): string {
  const raw = payload.answer ?? payload.value ?? payload.newValue
  if (Array.isArray(raw)) return raw.map(String).join(', ')
  if (raw === undefined || raw === null) return ''
  const text = String(raw).trim()
  // The BOOLEAN card posts the literal machine values 'true'/'false' — a
  // customer-facing chip must read "Da"/"Nu", not "true".
  if (text === 'true' || text === 'false') return BOOLEAN_ANSWER[lang][text]
  return text
}

function maskFieldValue(field: string, value: string): string {
  if (field === 'phone') return `***${value.slice(-3)}`
  if (field === 'cnp') {
    return value.length > 3 ? value.slice(0, 3) + '*'.repeat(value.length - 3) : value
  }
  return value
}

/**
 * Human, localized summary of a client-posted action — what the customer
 * sees in the transcript chip after reload. Codes/PII are masked here, at
 * the single writer, so nothing downstream has to remember to.
 */
export function actionLabel(action: ActionLike, lang: ActionLabelLanguage): string {
  const payload = action.payload ?? {}

  switch (action.type) {
    case 'answer_question':
    case 'write_question_answer':
    case 'modify_answer':
    case 'answer_dnt': {
      const answer = resolveAnswer(payload, lang)
      return answer ? `${ANSWER_HEAD[lang]}: ${answer}` : ANSWER_HEAD[lang]
    }

    case 'submit_field': {
      const field = String(payload.field ?? '')
      const label = FIELD_LABELS[field]?.[lang] ?? field
      const value = maskFieldValue(field, String(payload.value ?? ''))
      return `✓ ${label}: ${value}`
    }

    default:
      return FIXED_LABELS[action.type]?.[lang] ?? GENERIC_INTERACTION_LABELS[lang]
  }
}

// Anchored, lowercase-only: matches exactly what the route ever wrote
// ("[Action: sign_dnt]") plus the sim-recorded confirm variant
// ("[Action: confirm sign_dnt]"). Embedded or cased variants are customer
// text and must render as text.
const LEGACY_ACTION_RE = /^\[Action: [a-z_]+(?: [a-z_]+)*\]$/

export type MessageRenderKind =
  | { kind: 'action'; label: string }
  | { kind: 'legacy_action' }
  | { kind: 'text' }

/**
 * Classify persisted user-message content for rendering: the new
 * ⟦action⟧-prefixed chip, the legacy "[Action: …]" marker (generic chip —
 * never shown raw), or ordinary text.
 */
export function renderKind(content: string): MessageRenderKind {
  if (content.startsWith(ACTION_MESSAGE_PREFIX)) {
    return { kind: 'action', label: content.slice(ACTION_MESSAGE_PREFIX.length).trim() }
  }
  if (LEGACY_ACTION_RE.test(content.trim())) {
    return { kind: 'legacy_action' }
  }
  return { kind: 'text' }
}
