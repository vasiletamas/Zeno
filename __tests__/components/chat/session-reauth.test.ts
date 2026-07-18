/**
 * T26 (P5.2): the returning-account-holder gate on /chat — pure helpers the
 * SessionReauth component builds its requests from (node-testable; the JSX
 * shell stays thin).
 */
import { describe, it, expect } from 'vitest'
import {
  isReauthRequired,
  reauthStartRequest,
  reauthConfirmRequest,
  freshSessionRequest,
  type SessionInitResponse,
} from '@/components/chat/session-reauth'

describe('session-reauth helpers', () => {
  it('isReauthRequired discriminates the reauth_required response from a normal session', () => {
    expect(isReauthRequired({ status: 'reauth_required', maskedEmail: 'h***@example.ro' } as SessionInitResponse)).toBe(true)
    expect(isReauthRequired({ customerId: 'c1', isNew: false } as SessionInitResponse)).toBe(false)
    expect(isReauthRequired({ customerId: 'c2', isNew: true } as SessionInitResponse)).toBe(false)
  })

  it('reauthStartRequest posts an empty JSON body to the start route', () => {
    const r = reauthStartRequest()
    expect(r.url).toBe('/api/session/reauth/start')
    expect(r.init.method).toBe('POST')
    expect(JSON.parse(String(r.init.body))).toEqual({})
  })

  it('reauthConfirmRequest posts the typed code to the confirm route', () => {
    const r = reauthConfirmRequest('123456')
    expect(r.url).toBe('/api/session/reauth/confirm')
    expect(JSON.parse(String(r.init.body))).toEqual({ code: '123456' })
  })

  it('freshSessionRequest posts fresh:true to /api/session (the explicit continue-without-account path)', () => {
    const r = freshSessionRequest()
    expect(r.url).toBe('/api/session')
    expect(JSON.parse(String(r.init.body))).toEqual({ fresh: true })
  })
})
