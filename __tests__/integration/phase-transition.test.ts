import { describe, it, expect } from 'vitest'
import { getConversationPhase } from '@/lib/chat/phase'

describe('phase transition lifecycle', () => {
  it('starts in presentation, moves to application on OPEN, returns to presentation on ABANDONED', () => {
    const conv1 = { mode: 'SALES', application: null }
    expect(getConversationPhase(conv1)).toBe('presentation')

    const conv2 = { mode: 'SALES', application: { status: 'OPEN' } }
    expect(getConversationPhase(conv2)).toBe('application')

    const conv3 = { mode: 'SALES', application: { status: 'PAUSED' } }
    expect(getConversationPhase(conv3)).toBe('application')

    const conv4 = { mode: 'SALES', application: { status: 'COMPLETED' } }
    expect(getConversationPhase(conv4)).toBe('presentation')

    const conv5 = { mode: 'SALES', application: { status: 'ABANDONED' } }
    expect(getConversationPhase(conv5)).toBe('presentation')
  })

  it('post_sale mode stays post_sale regardless of application state', () => {
    expect(getConversationPhase({ mode: 'POST_SALE', application: null })).toBe('post_sale')
    expect(getConversationPhase({ mode: 'POST_SALE', application: { status: 'OPEN' } })).toBe('post_sale')
  })
})
