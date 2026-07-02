import { describe, it, expect } from 'vitest'
import { issueConfirmToken, verifyConfirmToken } from '@/lib/tools/confirm-token'

const SECRET = 'test-secret'
describe('signed state-fingerprint confirm token (T2.D3)', () => {
  it('round-trips for identical conversation/tool/args/fingerprint', () => {
    const t = issueConfirmToken(SECRET, 'conv-1', 'accept_quote', 'hash-1', 'fp-1')
    expect(verifyConfirmToken(SECRET, t, 'conv-1', 'accept_quote', 'hash-1', 'fp-1')).toBe(true)
  })
  it('rejects when the state fingerprint changed (TOCTOU: terms changed between preview and confirm)', () => {
    const t = issueConfirmToken(SECRET, 'conv-1', 'accept_quote', 'hash-1', 'fp-1')
    expect(verifyConfirmToken(SECRET, t, 'conv-1', 'accept_quote', 'hash-1', 'fp-CHANGED')).toBe(false)
  })
  it('cannot be minted without the secret (LLM cannot self-confirm)', () => {
    const forged = issueConfirmToken('guess', 'conv-1', 'accept_quote', 'hash-1', 'fp-1')
    expect(verifyConfirmToken(SECRET, forged, 'conv-1', 'accept_quote', 'hash-1', 'fp-1')).toBe(false)
  })
})
