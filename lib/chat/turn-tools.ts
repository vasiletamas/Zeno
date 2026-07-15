/**
 * Per-turn LLM tool list = the engine's exposure set (A3.1).
 *
 * There is no static baseline anymore: what the model can call each turn is
 * exactly deriveAndExpose(...).actions.available (minus internals), so a
 * commit the engine blocks simply is not in the function-calling surface.
 */

import { getToolsForLLM, getToolDefinition } from '@/lib/tools/registry'
import type { ExposedActions } from '@/lib/engines/domain-types'
import type { LLMToolDefinition } from '@/lib/llm/providers/types'

/**
 * The ONE degraded-mode floor (A3 erratum 4): when state derivation fails,
 * both the LLM tool list AND the executor's exposedTools wall use this exact
 * set — reads + the escape hatch, never phase impersonation.
 */
export const DEGRADED_FLOOR = ['get_current_state', 'list_products', 'get_product_info', 'escalate_to_human'] as const

export function buildTurnTools(actions: ExposedActions): LLMToolDefinition[] {
  const names = actions.available.filter((n) => { const d = getToolDefinition(n); return d !== undefined && d.kind !== 'internal' })
  return getToolsForLLM(names)
}
