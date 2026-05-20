/**
 * Side-Effect Claim Validator
 *
 * Scans the assistant's response for phrases that claim side effects
 * (saving, recording, starting, confirming). For each match, the claim
 * is permitted iff at least one tool of the matching category was called
 * this turn AND returned success.
 *
 * Category matching uses the tool definition's `sideEffect` field rather
 * than the result's `confirmation` payload — this means a handler that
 * forgot to populate `confirmation` still counts as "succeeded in category X"
 * for validation purposes.
 *
 * See docs/superpowers/specs/2026-05-20-zeno-tool-mediated-effects-design.md.
 */

import type { ToolCall } from '@/lib/llm/providers/types'
import type { ToolResult } from '@/lib/tools/types'
import { getToolDefinition } from '@/lib/tools/registry'

type Category = 'save' | 'lifecycle' | 'consent' | 'quote'

export const PHRASE_BLOCKLIST: Record<Category, { ro: RegExp[]; en: RegExp[] }> = {
  save: {
    ro: [/am notat/i, /am salvat/i, /am înregistrat(?! consimțământul)/i, /am consemnat/i],
    en: [/i (just )?noted/i, /i saved/i, /i recorded(?! (your )?consent)/i],
  },
  lifecycle: {
    ro: [/am pornit aplicația/i, /am început aplicația/i, /te-am înscris/i, /am creat aplicația/i],
    en: [/i started the application/i, /i created the application/i],
  },
  consent: {
    ro: [/am confirmat consimțământul/i, /am înregistrat consimțământul/i],
    en: [/i recorded (your )?consent/i, /i confirmed (your )?consent/i],
  },
  quote: {
    ro: [/cred că vine cam pe la/i, /aproximativ \d+\s*(ron|lei)/i],
    en: [/about \d+\s*(ron|lei|usd|eur)/i, /roughly \d+\s*(ron|lei|usd|eur)/i],
  },
}

export interface SideEffectValidation {
  valid: boolean
  violations: Array<{ category: Category; matchedPhrase: string }>
}

/**
 * Determine which side-effect categories succeeded this turn by walking
 * the tool calls + results and looking up each tool's `sideEffect`
 * category from the registry.
 */
function succeededCategories(
  toolCalls: ToolCall[],
  toolResults: ToolResult[],
): Set<Category> {
  const succeeded = new Set<Category>()
  // toolResults is parallel-indexed with toolCalls when both are emitted by
  // the same orchestrator loop; we tolerate length mismatch defensively.
  const len = Math.min(toolCalls.length, toolResults.length)
  for (let i = 0; i < len; i++) {
    const result = toolResults[i]
    if (!result.success) continue
    const def = getToolDefinition(toolCalls[i].name)
    if (def?.sideEffect) {
      succeeded.add(def.sideEffect as Category)
    }
  }
  return succeeded
}

/**
 * Validate that every side-effect claim in the assistant's text is backed
 * by a corresponding successful tool call this turn.
 */
export function validateSideEffectClaims(
  assistantText: string,
  toolCalls: ToolCall[],
  toolResults: ToolResult[],
  language: 'ro' | 'en',
): SideEffectValidation {
  const succeeded = succeededCategories(toolCalls, toolResults)

  const violations: SideEffectValidation['violations'] = []
  for (const [cat, patterns] of Object.entries(PHRASE_BLOCKLIST) as Array<[Category, { ro: RegExp[]; en: RegExp[] }]>) {
    if (succeeded.has(cat)) continue
    const list = patterns[language]
    for (const pattern of list) {
      const m = assistantText.match(pattern)
      if (m) {
        violations.push({ category: cat, matchedPhrase: m[0] })
      }
    }
  }

  return { valid: violations.length === 0, violations }
}
