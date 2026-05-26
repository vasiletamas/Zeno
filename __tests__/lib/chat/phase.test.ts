import { describe, it, expect } from 'vitest'
import { getConversationPhase } from '@/lib/chat/phase'

describe('getConversationPhase', () => {
  it('returns "presentation" when no application exists', () => {
    expect(getConversationPhase({ mode: 'SALES', application: null })).toBe('presentation')
  })

  it('returns "application" when application status is OPEN', () => {
    expect(getConversationPhase({ mode: 'SALES', application: { status: 'OPEN' } })).toBe('application')
  })

  it('returns "application" when application status is PAUSED', () => {
    expect(getConversationPhase({ mode: 'SALES', application: { status: 'PAUSED' } })).toBe('application')
  })

  it('returns "presentation" when application is COMPLETED (abandoned → back to presentation)', () => {
    expect(getConversationPhase({ mode: 'SALES', application: { status: 'COMPLETED' } })).toBe('presentation')
  })

  it('returns "presentation" when application is ABANDONED', () => {
    expect(getConversationPhase({ mode: 'SALES', application: { status: 'ABANDONED' } })).toBe('presentation')
  })

  it('returns "post_sale" when mode is POST_SALE regardless of application status', () => {
    expect(getConversationPhase({ mode: 'POST_SALE', application: { status: 'OPEN' } })).toBe('post_sale')
    expect(getConversationPhase({ mode: 'POST_SALE', application: null })).toBe('post_sale')
  })
})
