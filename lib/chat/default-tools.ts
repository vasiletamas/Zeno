/**
 * Default discovery tool set — always available to the agent regardless of
 * workflow state. Lets the agent enumerate the product catalogue, look up
 * specific products, and commit a product choice during the pre-workflow phase.
 *
 * See docs/superpowers/specs/2026-05-20-zeno-discovery-toolset-design.md.
 */

export const DEFAULT_DISCOVERY_TOOLS = [
  'list_products',
  'get_product_info',
  'set_candidate_product',
  'record_gdpr_consent',
  'acknowledge_ai_disclosure',
  'get_current_state',
  'set_answer',
  'change_selection',
  'switch_product',
  'preview_product_requirements',
] as const

/**
 * Returns the union of DEFAULT_DISCOVERY_TOOLS and the given tools.
 * Order: baseline first, then the provided tools, with duplicates removed.
 */
export function withDefaultDiscoveryTools(tools: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const t of DEFAULT_DISCOVERY_TOOLS) {
    if (!seen.has(t)) {
      seen.add(t)
      result.push(t)
    }
  }
  for (const t of tools) {
    if (!seen.has(t)) {
      seen.add(t)
      result.push(t)
    }
  }
  return result
}
