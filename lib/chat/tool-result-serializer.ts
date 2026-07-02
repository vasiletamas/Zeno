import type { ToolResult } from '@/lib/tools/types'

/**
 * Serialize a ToolResult for transmission to the model. Includes success, data,
 * error, message, and confirmation (if present, with its provenance). The
 * confirmation field is critical: it tells the model what side effect was
 * performed, preventing re-confirmation loops.
 */
export function serializeToolResultForModel(toolResult: ToolResult): string {
  // Commits: the gateway envelope IS the contract — serialized verbatim so
  // the model reads outcome/effects/reason codes, never prose-only errors
  // (A2.9).
  if (toolResult.envelope !== undefined) {
    return JSON.stringify({ envelope: toolResult.envelope, data: toolResult.data })
  }
  const payload: Record<string, unknown> = { success: toolResult.success }
  if (toolResult.data !== undefined) payload.data = toolResult.data
  if (toolResult.error !== undefined) payload.error = toolResult.error
  if (toolResult.message !== undefined) payload.message = toolResult.message
  if (toolResult.confirmation !== undefined) payload.confirmation = toolResult.confirmation
  return JSON.stringify(payload)
}
