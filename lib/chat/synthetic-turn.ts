/**
 * T13 seam: seed the standard tool loop with a GUI-originated (synthetic)
 * tool execution. The card click's assistant+tool exchange becomes ordinary
 * loop history, so the follow-up LLM rounds can CHAIN — the old path
 * narrated over a TOOL-LESS stream call and generate_quote was structurally
 * unreachable in the same turn as the medical signature (conv
 * cmrm3fgku00056g0y4eb2hsme messageIndex 58).
 */
import type { Message, ToolCall } from '@/lib/llm/providers/types'
import type { ToolResult } from '@/lib/tools/types'
import { serializeToolResultForModel } from './tool-result-serializer'

/** The two messages that prime the loop: the assistant "call" the GUI made
 * on the model's behalf, then its serialized result — exactly the shape the
 * loop itself pushes after an LLM-initiated round. */
export function seedSyntheticLoopMessages(tc: ToolCall, result: ToolResult): [Message, Message] {
  return [
    { role: 'assistant', content: '', toolCalls: [tc] },
    { role: 'tool', content: serializeToolResultForModel(result), toolCallId: tc.id },
  ]
}

/**
 * T8 seam (design 2026-07-15 §3.4): a commit handler may declare
 * `data._autoChain = {tool, args}` — a deterministic single follow-up the
 * orchestrator executes through the normal pipeline (gateway legality,
 * ledger, uiAction emission) before the LLM rounds. Only an APPLIED gui
 * commit chains; the shape is validated defensively (a malformed
 * declaration is ignored, never thrown on). The orchestrator caps the chain
 * at EXACTLY ONE hop — a chained result's own _autoChain is ignored; chains
 * of judgment stay with the model inside the tool loop.
 */
export function extractAutoChain(result: ToolResult): { tool: string; args: Record<string, unknown> } | null {
  if (result.envelope?.outcome !== 'applied') return null
  const data = (result.envelope.data ?? result.data ?? {}) as Record<string, unknown>
  const decl = data._autoChain
  if (!decl || typeof decl !== 'object' || Array.isArray(decl)) return null
  const { tool, args } = decl as { tool?: unknown; args?: unknown }
  if (typeof tool !== 'string' || tool.length === 0) return null
  return { tool, args: args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {} }
}
