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
