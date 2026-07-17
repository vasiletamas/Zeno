/**
 * Shared impossibility lexicon (T16, P3.2). ONE source of truth for the two
 * surfaces that hunt false "I can't" claims about funnel actions:
 *
 *  - ONLINE:  lib/chat/outbound-guard.ts — checks the model's DRAFT against
 *    the freshest exposure set before the customer sees it (self-repair).
 *  - OFFLINE: lib/diagnostics/checks-supersession.ts (stale_gate_claim) —
 *    the T13 ratchet over recorded conversations.
 *
 * Both import THESE exports (the diagnostics test asserts import equality),
 * so the detector class can never drift between the live guard and the
 * offline net. All patterns run over diacritic-stripped, lowercased prose
 * (stripDiacritics + toLowerCase — same normalization on both surfaces).
 */

/** Romanian impossibility phrasings (diacritic-stripped: "îl" → "il"). */
export const IMPOSSIBILITY_RO = /nu (mai )?(poate|pot|se poate)|nu este posibil|imposibil|nu (il|o) pot/

/** English impossibility phrasings. */
export const IMPOSSIBILITY_EN = /cannot|can'?t|unable|not (currently )?(possible|available)|unavailable/

/** Union of both languages — the offline check scans mixed-language
 * transcripts, so it matches either. */
export const IMPOSSIBILITY = new RegExp(`${IMPOSSIBILITY_RO.source}|${IMPOSSIBILITY_EN.source}`)

/**
 * Funnel-action → domain keywords (diacritic-stripped, lowercased).
 * sign_dnt deliberately requires "semna" NEAR "analiz" in the same clause:
 * a bare "semna" would collide with medical-declaration signing and let a
 * truthful "nu pot semna declarațiile" trigger a spurious sign_dnt repair.
 */
export const ACTION_DOMAINS: Record<string, RegExp> = {
  generate_quote: /calcul|cotati|pret|ofert/,
  sign_dnt: /semna[^.!?\n]*analiz|analiza[^.!?\n]*semna/,
  sign_medical_declarations: /declarati/,
  ensure_payment_session: /plat/,
  start_channel_verification: /cod|verific/,
  set_application: /aplicat/,
}

/** Chars scanned on each side of a domain-keyword match for an
 * impossibility phrase — "calcularea nu poate fi finalizată" flags, an
 * unrelated "nu pot" three sentences away does not. */
export const PROXIMITY_WINDOW = 80

/**
 * A domain keyword NEAR an impossibility phrase (± PROXIMITY_WINDOW chars).
 * `prose` must already be normalized (diacritic-stripped, lowercased).
 * Returns the evidence window (trimmed) or null.
 */
export function impossibilityNearDomain(
  prose: string,
  domain: RegExp,
  impossibility: RegExp,
): string | null {
  for (const m of prose.matchAll(new RegExp(domain.source, 'g'))) {
    const idx = m.index ?? 0
    const windowText = prose.slice(Math.max(0, idx - PROXIMITY_WINDOW), idx + m[0].length + PROXIMITY_WINDOW)
    if (impossibility.test(windowText)) return windowText.trim()
  }
  return null
}
