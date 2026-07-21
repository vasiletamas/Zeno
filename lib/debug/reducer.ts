/**
 * Pure reducer for the debug panel state.
 *
 * Accumulates debug:* events (forwarded by useChat) into a list of per-turn
 * cards keyed by traceId. Newest turn first; capped at MAX_TURNS to bound
 * memory.
 */

import type {
  DebugCardsBriefedPayload,
  DebugEvent,
  DebugGatePayload,
  DebugIdentityPayload,
  DebugLegalityPayload,
  DebugPromptPayload,
  DebugToolNarrationPayload,
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
  identity?: Omit<DebugIdentityPayload, 'traceId'>
  gate?: Omit<DebugGatePayload, 'traceId'>
  /** F2.1 (T14.D2): per-turn legality snapshots in arrival order, turn_start first. */
  legality?: Omit<DebugLegalityPayload, 'traceId'>[]
  prompt?: Omit<DebugPromptPayload, 'traceId'>
  /** Spec 2026-07-20 §5: the cards the ON-SCREEN CARDS briefing listed for the
   * model at turn start — the offline licence for a card reference (T11
   * amendment, lib/diagnostics/checks-cards.ts). */
  briefedCards?: DebugCardsBriefedPayload['cards']
  toolCalls: DebugTurnToolCall[]
  toolNarration?: Omit<DebugToolNarrationPayload, 'traceId'>
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

    case 'debug:identity': {
      const { traceId, ...rest } = event.data
      return updateTurn(state, traceId, (t) => ({ ...t, identity: rest }))
    }

    case 'debug:gate': {
      const { traceId, ...rest } = event.data
      return updateTurn(state, traceId, (t) => ({ ...t, gate: rest }))
    }

    case 'debug:legality': {
      const { traceId, ...rest } = event.data
      return updateTurn(state, traceId, (t) => ({ ...t, legality: [...(t.legality ?? []), rest] }))
    }

    case 'debug:prompt': {
      const { traceId, ...rest } = event.data
      return updateTurn(state, traceId, (t) => ({ ...t, prompt: rest }))
    }

    case 'debug:cards_briefed': {
      const { traceId, cards } = event.data
      return updateTurn(state, traceId, (t) => ({ ...t, briefedCards: cards }))
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

    case 'debug:tool_narration': {
      const { traceId, ...rest } = event.data
      return updateTurn(state, traceId, (t) => ({ ...t, toolNarration: rest }))
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

export type DebugAction =
  | DebugEvent
  | { type: 'CLEAR' }
  | { type: 'HYDRATE'; turns: DebugTurn[] }

/**
 * Reducer used by DebugProvider. Handles the two control actions (CLEAR,
 * HYDRATE) and delegates every debug:* event to reduceDebugEvent. DebugEvent
 * has an `event` field and no `type` field, so `'type' in action` cleanly
 * distinguishes control actions from events.
 */
export function debugReducer(state: DebugState, action: DebugAction): DebugState {
  if ('type' in action) {
    switch (action.type) {
      case 'CLEAR':
        return EMPTY_STATE
      case 'HYDRATE':
        return { turns: action.turns.slice(0, MAX_TURNS) }
    }
  }
  return reduceDebugEvent(state, action)
}

/**
 * Reduce a full turn's worth of debug events into the single DebugTurn that
 * the panel renders. Used server-side to build the DB payload, so the stored
 * shape and the live UI shape stay identical. Returns null for an empty list.
 */
export function buildTurnDebugPayload(events: DebugEvent[]): DebugTurn | null {
  let state: DebugState = EMPTY_STATE
  for (const event of events) {
    state = reduceDebugEvent(state, event)
  }
  return state.turns[0] ?? null
}
