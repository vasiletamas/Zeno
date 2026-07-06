/**
 * P0-1 anti-fabrication write-guard (pure, no DB) — deterministic grounding
 * of a value the agent is about to persist against what the CUSTOMER
 * actually said. Prompt rules proved insufficient (production-readiness
 * P0 #1: family-size "2" persisted after five bare "da" replies; the
 * suitability-driving life-subtype fabricated) — this module is the engine
 * backstop, consumed by the four value-writing handlers (write_dnt_answer,
 * write_question_answer, modify_answer, collect_customer_field) and by the
 * questionnaire_answer_fabricated diagnostics check, so the write-time rule
 * and the post-hoc audit can never drift.
 *
 * Grounding paths (any one suffices):
 *  - customer_words:      the normalized value (digits, RO number words,
 *                         free text) appears in recent customer messages
 *  - option_label:        a distinctive word of the chosen enum option's
 *                         value/labels appears in recent customer messages
 *                         ("din salariu" grounds salary_pension)
 *  - confirmed_proposal:  the agent PROPOSED the value (it appears in recent
 *                         assistant messages) and the latest customer message
 *                         is an affirmation — the ratified CONTEXT-HIT flow
 *  - customer_words (boolean): true/false rides the customer's da/nu
 *
 * Deliberately narrow (ratchet rule): widen only with recorded evidence,
 * never weaken to silence a finding.
 */
import { stripDiacritics } from '@/lib/products/aliases'

export interface GroundingOption { value: string; label?: string | { en?: string; ro?: string } }

export interface GroundingInput {
  /** the normalized value about to be written */
  value: string
  /** enum options when the target question has them — widens the anchor to labels */
  options?: GroundingOption[]
  /** the value ALREADY on record for this field/question — re-declaring it is
   * idempotent, not fabrication (run cmr9eli9n: email re-collected 15 turns
   * after the customer gave it, far outside any sane message window) */
  storedValue?: string | null
  /** recent CUSTOMER prose, oldest -> newest (the last entry is the latest) */
  userMessages: string[]
  /** recent ASSISTANT prose, oldest -> newest */
  assistantMessages: string[]
}

export type GroundingBasis = 'customer_words' | 'option_label' | 'confirmed_proposal' | 'already_recorded' | null

const norm = (s: string): string => stripDiacritics(String(s).toLowerCase()).replace(/\s+/g, ' ').trim()

// 0..10 — evidence-driven; widen with recorded cases, never pre-emptively
const RO_NUMBER_WORDS: Record<string, string[]> = {
  '0': ['zero', 'niciun', 'nicio', 'niciunul'],
  '1': ['unu', 'un', 'o', 'singur', 'singura'],
  '2': ['doi', 'doua', 'amandoi', 'amandoua'],
  '3': ['trei'], '4': ['patru'], '5': ['cinci'], '6': ['sase'],
  '7': ['sapte'], '8': ['opt'], '9': ['noua'], '10': ['zece'],
}

const AFFIRMATIONS = /^(da|ok|okay|sigur|desigur|confirm(at)?|exact|corect|bine|perfect|yes|sure|accept)\b/
const BOOLEAN_TRUE = new Set(['true', 'da', 'yes'])
const BOOLEAN_FALSE = new Set(['false', 'nu', 'no'])
// connective words that appear in every label — matching them grounds nothing
const STOPWORDS = new Set(['pentru', 'fara', 'sau', 'din', 'de', 'la', 'cu', 'si', 'care', 'este', 'sunt', 'alte', 'alta', 'and', 'the', 'for', 'with', 'other'])

const wordBoundaryHit = (haystack: string, needle: string): boolean =>
  new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(haystack)

/** Distinctive anchor words for an enum option: its value token split on
 * non-alphanumerics + its label words, ≥4 chars, minus connectives. */
function optionAnchorWords(value: string, options: GroundingOption[] | undefined): string[] {
  const opt = options?.find((o) => norm(o.value) === norm(value))
  if (!opt) return []
  const labels: string[] = [opt.value]
  if (typeof opt.label === 'string') labels.push(opt.label)
  else if (opt.label) labels.push(...([opt.label.en, opt.label.ro].filter(Boolean) as string[]))
  const words = labels.flatMap((l) => norm(l).split(/[^a-z0-9]+/))
  return [...new Set(words.filter((w) => w.length >= 4 && !STOPWORDS.has(w)))]
}

function valueAppearsIn(value: string, prose: string): boolean {
  const v = norm(value)
  if (v.length === 0) return false
  // short/numeric values must stand alone ("2" must not anchor inside "2000")
  if (/^\d+\+?$/.test(v) || v.length <= 2) {
    const digits = v.replace(/\+$/, '')
    if (wordBoundaryHit(prose, digits)) return true
    return (RO_NUMBER_WORDS[digits] ?? []).some((w) => wordBoundaryHit(prose, w))
  }
  // ISO dates: the customer's format is theirs (29.02.1996), and the CNP the
  // customer typed ENCODES the date (yymmdd) — both are legitimate anchors,
  // not fabrication.
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const [, y, mo, d] = iso
    if (prose.includes(v)) return true
    if (prose.includes(`${y.slice(2)}${mo}${d}`)) return true // CNP-embedded yymmdd
    const dayFirst = new RegExp(`(^|[^0-9])0?${Number(d)}[./ -]0?${Number(mo)}[./ -]${y}($|[^0-9])`)
    return dayFirst.test(prose)
  }
  return prose.includes(v)
}

export function isValueGrounded(input: GroundingInput): { grounded: boolean; basis: GroundingBasis } {
  const userProse = norm(input.userMessages.join(' \n '))
  const assistantProse = norm(input.assistantMessages.join(' \n '))
  const v = norm(input.value)

  if (input.storedValue != null && norm(input.storedValue) === v) {
    return { grounded: true, basis: 'already_recorded' }
  }

  // booleans ride the customer's own da/nu — word-boundary, either polarity
  // (the question's phrasing decides polarity, which prose cannot re-derive)
  if (BOOLEAN_TRUE.has(v) || BOOLEAN_FALSE.has(v)) {
    if (/(^|[^a-z0-9])(da|nu|yes|no|ok|sigur|confirm|corect)($|[^a-z0-9])/.test(userProse)) {
      return { grounded: true, basis: 'customer_words' }
    }
    return { grounded: false, basis: null }
  }

  if (valueAppearsIn(input.value, userProse)) return { grounded: true, basis: 'customer_words' }

  const anchors = optionAnchorWords(input.value, input.options)
  if (anchors.some((w) => wordBoundaryHit(userProse, w))) return { grounded: true, basis: 'option_label' }

  // confirmed proposal: the value (or its option anchors) in the AGENT's
  // recent prose + the LATEST customer message is an affirmation
  const latest = norm(input.userMessages[input.userMessages.length - 1] ?? '')
  if (AFFIRMATIONS.test(latest)) {
    if (valueAppearsIn(input.value, assistantProse) || anchors.some((w) => wordBoundaryHit(assistantProse, w))) {
      return { grounded: true, basis: 'confirmed_proposal' }
    }
  }

  return { grounded: false, basis: null }
}
