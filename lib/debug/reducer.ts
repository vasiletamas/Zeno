/**
 * Pure reducer for the debug panel state.
 *
 * Accumulates debug:* events (forwarded by useChat) into a list of per-turn
 * cards keyed by traceId. Newest turn first; capped at MAX_TURNS to bound
 * memory.
 */

import type {
  DebugEvent,
  DebugGatePayload,
  DebugPromptPayload,
  DebugToolResultPayload,
  DebugTurnEndPayload,
} from '@/lib/chat/debug'

const MAX_TURNS = 50

export interface DebugTurnToolCall {
  round: number
  toolCallId: string
  name: string
  args: Record<string, unknown>
  partition: 'readOnly' | 'writing' | 'background'
  result?: Omit<DebugToolResultPayload, 'traceId' | 'toolCallId'>
}

export interface DebugTurn {
  traceId: string
  conversationId: string
  messageIndex: number
  userMessage: string
  language: 'en' | 'ro'
  startedAt: number
  gate?: Omit<DebugGatePayload, 'traceId'>
  prompt?: Omit<DebugPromptPayload, 'traceId'>
  toolCalls: DebugTurnToolCall[]
  endedAt?: number
  totals?: Omit<DebugTurnEndPayload, 'traceId'>
}

export interface DebugState {
  /** Newest turn first. */
  turns: DebugTurn[]
}

export const EMPTY_STATE: DebugState = { turns: [] }

function updateTurn(
  state: DebugState,
  traceId: string,
  patch: (t: DebugTurn) => DebugTurn,
): DebugState {
  const idx = state.turns.findIndex((t) => t.traceId === traceId)
  if (idx === -1) return state
  const next = state.turns.slice()
  next[idx] = patch(next[idx])
  return { turns: next }
}

export function reduceDebugEvent(state: DebugState, event: DebugEvent): DebugState {
  switch (event.event) {
    case 'debug:turn_start': {
      const turn: DebugTurn = {
        traceId: event.data.traceId,
        conversationId: event.data.conversationId,
        messageIndex: event.data.messageIndex,
        userMessage: event.data.userMessage,
        language: event.data.language,
        startedAt: Date.now(),
        toolCalls: [],
      }
      const turns = [turn, ...state.turns].slice(0, MAX_TURNS)
      return { turns }
    }

    case 'debug:gate': {
      const { traceId, ...rest } = event.data
      return updateTurn(state, traceId, (t) => ({ ...t, gate: rest }))
    }

    case 'debug:prompt': {
      const { traceId, ...rest } = event.data
      return updateTurn(state, traceId, (t) => ({ ...t, prompt: rest }))
    }

    case 'debug:tool_call': {
      const { traceId, ...rest } = event.data
      return updateTurn(state, traceId, (t) => ({
        ...t,
        toolCalls: [...t.toolCalls, rest as DebugTurnToolCall],
      }))
    }

    case 'debug:tool_result': {
      const { traceId, toolCallId, ...rest } = event.data
      return updateTurn(state, traceId, (t) => ({
        ...t,
        toolCalls: t.toolCalls.map((tc) =>
          tc.toolCallId === toolCallId ? { ...tc, result: rest } : tc,
        ),
      }))
    }

    case 'debug:turn_end': {
      const { traceId, ...rest } = event.data
      return updateTurn(state, traceId, (t) => ({
        ...t,
        endedAt: Date.now(),
        totals: rest,
      }))
    }
  }
}
