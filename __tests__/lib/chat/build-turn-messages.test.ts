/**
 * D1 (plan 2026-07-06, F3): per-turn dynamic state moves BEHIND the history.
 *
 * Old order was [system stable, system dynamic, system summary?, ...history,
 * user] — the dynamic system message changed every turn, so provider prefix
 * caching stopped at message 2 and the entire history was re-billed at full
 * input price on every turn. New order keeps only stable content before the
 * history and carries the per-turn state inside the final user message; the
 * last history message gets a cache breakpoint so Anthropic reads history
 * from cache (OpenAI prefix caching covers it automatically).
 */
import { describe, it, expect } from 'vitest'
import {
  buildTurnMessages,
  TURN_STATE_HEADER,
  CUSTOMER_MESSAGE_HEADER,
} from '@/lib/chat/build-turn-messages'
import type { Message } from '@/lib/llm/providers/types'

const history: Message[] = [
  { role: 'user', content: 'Vreau o asigurare de viață' },
  { role: 'assistant', content: 'Sigur, hai să vedem ce ți se potrivește.' },
]

describe('buildTurnMessages', () => {
  it('orders: stable system (cached), summary, history (last cached), user envelope', () => {
    const messages = buildTurnMessages({
      stablePrefix: 'STABLE',
      dynamicSuffix: 'Phase: DISCOVERY',
      summaryPrefix: 'earlier: greeted',
      windowMessages: history,
      userMessage: 'da',
    })

    expect(messages.map((m) => m.role)).toEqual(['system', 'system', 'user', 'assistant', 'user'])
    expect(messages[0].content).toBe('STABLE')
    expect(messages[0].cacheHint).toEqual({ breakpoint: 'ephemeral' })
    expect(messages[1].content).toContain('earlier: greeted')
    // no per-turn system message anywhere
    expect(messages.filter((m) => m.role === 'system')).toHaveLength(2)
    // history breakpoint on the LAST window message
    expect(messages[2].cacheHint).toBeUndefined()
    expect(messages[3].cacheHint).toEqual({ breakpoint: 'ephemeral' })
  })

  it('carries the dynamic suffix inside the final user message, customer text last', () => {
    const messages = buildTurnMessages({
      stablePrefix: 'STABLE',
      dynamicSuffix: 'Phase: QUOTE\nOpen objective: acceptance',
      summaryPrefix: null,
      windowMessages: history,
      userMessage: 'cât costă?',
    })

    const user = messages[messages.length - 1]
    expect(user.role).toBe('user')
    expect(user.content).toContain(TURN_STATE_HEADER)
    expect(user.content).toContain('Phase: QUOTE')
    expect(user.content).toContain(CUSTOMER_MESSAGE_HEADER)
    // customer text comes AFTER the state block
    expect(user.content.indexOf('cât costă?')).toBeGreaterThan(user.content.indexOf('Phase: QUOTE'))
    expect(user.content.endsWith('cât costă?')).toBe(true)
  })

  it('without a dynamic suffix the user message is the raw customer text', () => {
    const messages = buildTurnMessages({
      stablePrefix: 'STABLE',
      dynamicSuffix: null,
      summaryPrefix: null,
      windowMessages: [],
      userMessage: 'salut',
    })
    expect(messages).toHaveLength(2)
    expect(messages[1]).toEqual({ role: 'user', content: 'salut' })
  })

  it('does not mutate the caller-owned window messages when stamping the breakpoint', () => {
    const window: Message[] = [{ role: 'assistant', content: 'ok' }]
    buildTurnMessages({
      stablePrefix: 'S',
      dynamicSuffix: 'D',
      summaryPrefix: null,
      windowMessages: window,
      userMessage: 'x',
    })
    expect(window[0].cacheHint).toBeUndefined()
  })
})
