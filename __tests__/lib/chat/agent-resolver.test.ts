import { describe, it, expect } from 'vitest'
import { resolveAgent } from '@/lib/chat/agent-resolver'

describe('resolveAgent', () => {
  it('returns main-chat for SALES mode', () => {
    expect(resolveAgent('SALES')).toBe('main-chat')
  })
  it('returns main-chat for ONBOARDING mode', () => {
    expect(resolveAgent('ONBOARDING')).toBe('main-chat')
  })
  it('returns main-chat for SUPPORT mode', () => {
    expect(resolveAgent('SUPPORT')).toBe('main-chat')
  })
  it('returns main-chat for CLAIMS mode', () => {
    expect(resolveAgent('CLAIMS')).toBe('main-chat')
  })
  it('returns main-chat for RENEWAL mode', () => {
    expect(resolveAgent('RENEWAL')).toBe('main-chat')
  })
  it('returns main-chat for unknown mode (fallback)', () => {
    expect(resolveAgent('UNKNOWN_MODE')).toBe('main-chat')
  })
})
