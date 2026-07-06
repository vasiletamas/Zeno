/**
 * Insight value validation (Task 3.2, D4) — ONE typed gate before ANY
 * CustomerInsight persistence (the extractor and the answer-bump share it).
 * The age=0 class: LLM extractors emit placeholder zeros/unknowns; those
 * must never become "facts" the agent later repeats back to the customer.
 */
import type { InsightKeySpec } from './keys'

/** Per-key numeric sanity ranges; keys without an entry only demand > 0. */
const NUMBER_RANGES: Record<string, { min: number; max: number }> = {
  age: { min: 18, max: 120 },
  familySize: { min: 1, max: 20 },
}

export type InsightValidation =
  | { ok: true; value: string }
  | { ok: false; reason: string }

export function validateInsightValue(spec: InsightKeySpec, value: unknown): InsightValidation {
  switch (spec.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim())
      if (!Number.isFinite(n)) return { ok: false, reason: 'not_a_number' }
      const range = NUMBER_RANGES[spec.key]
      if (range ? n < range.min || n > range.max : n <= 0) {
        return { ok: false, reason: range ? `out_of_range_${range.min}_${range.max}` : 'non_positive' }
      }
      return { ok: true, value: String(n) }
    }
    case 'enum': {
      const s = String(value)
      if (!spec.options?.includes(s)) return { ok: false, reason: 'not_in_options' }
      return { ok: true, value: s }
    }
    case 'boolean': {
      // strict true/false — "yes"/"da"/1 are extractor sloppiness, never facts
      if (value === true || value === false || value === 'true' || value === 'false') {
        return { ok: true, value: String(value) }
      }
      return { ok: false, reason: 'not_strict_boolean' }
    }
    case 'string': {
      const s = String(value).trim()
      if (s.length === 0 || s === '0' || /^(unknown|none|null|undefined|n\/a)$/i.test(s)) {
        return { ok: false, reason: 'empty_or_placeholder' }
      }
      return { ok: true, value: s }
    }
  }
}
