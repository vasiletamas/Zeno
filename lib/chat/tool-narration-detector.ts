/**
 * Tool-Narration Detector
 *
 * Scans the assistant's response for phrases that leak the agent's internal
 * tool mechanics to the customer — i.e. Pathology 1: narrating a lookup,
 * confessing it hasn't checked something yet, asking the customer for
 * permission to call a tool, or exposing internal identifiers.
 *
 * Unlike the side-effect validator (where a claim is permitted if the
 * matching tool succeeded), tool narration is NEVER appropriate in
 * customer-facing prose: tool use is invisible infrastructure. The agent
 * should call the tool silently and present the result as its own knowledge.
 *
 * This is an observability/measurement instrument — it lets us quantify the
 * pathology across conversations and detect regressions after the prompt fix.
 */

export type ToolNarrationCategory = 'permission' | 'unchecked' | 'internal'

/**
 * Patterns are intentionally narrow and grounded in real failing transcripts
 * to avoid false positives on legitimate discovery questions or product
 * descriptions. `s[ăa]` / `[șs]` spellings tolerate missing diacritics.
 */
const PHRASE_BLOCKLIST: Record<ToolNarrationCategory, { ro: RegExp[]; en: RegExp[] }> = {
  // Asking the customer's permission to perform a lookup/check.
  permission: {
    ro: [
      /vrei s[ăa] verific/i,
      /vrei s[ăa] caut/i,
      /vrei s[ăa] fac verificarea/i,
      /vrei s[ăa] m[ăa] uit/i,
      /vrei s[ăa] consult/i,
    ],
    en: [
      /do you want me to (check|look|search|verify|pull up)/i,
      /shall i (check|look|verify)/i,
      /should i (check|look|verify)/i,
    ],
  },
  // Confessing it has not looked something up / can't state it without checking.
  unchecked: {
    ro: [
      /nu am reu[șs]it s[ăa] verific/i,
      /nu am verificat/i,
      /f[ăa]r[ăa] s[ăa] verific/i,
      /nu vreau s[ăa] inventez/i,
      /trebuie s[ăa] verific/i,
    ],
    en: [
      /i haven'?t (yet )?(checked|verified|looked)/i,
      /i have not (yet )?(checked|verified|looked)/i,
      /without (first )?checking/i,
    ],
  },
  // Exposing internal mechanics/identifiers to the customer.
  internal: {
    ro: [/identificator(ul)? intern/i],
    en: [/internal (id|identifier)/i],
  },
}

export interface ToolNarrationResult {
  clean: boolean
  violations: Array<{ category: ToolNarrationCategory; matchedPhrase: string }>
}

/**
 * Detect tool-narration / permission-asking leakage in assistant text.
 */
export function detectToolNarration(
  assistantText: string,
  language: 'ro' | 'en',
): ToolNarrationResult {
  const violations: ToolNarrationResult['violations'] = []

  for (const [category, patterns] of Object.entries(PHRASE_BLOCKLIST) as Array<
    [ToolNarrationCategory, { ro: RegExp[]; en: RegExp[] }]
  >) {
    for (const pattern of patterns[language]) {
      const m = assistantText.match(pattern)
      if (m) {
        violations.push({ category, matchedPhrase: m[0] })
      }
    }
  }

  return { clean: violations.length === 0, violations }
}
