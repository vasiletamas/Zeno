import { describe, it, expect, vi, afterEach } from 'vitest'
import { MockEmailProvider, lastMockEmailTo } from '@/lib/email/providers/mock'
import { appBaseUrl } from '@/lib/app-url'

// Task 4.1 (D6): local code visibility — the mock provider prints the OTP
// code + link on ONE parse-free line and records the send on a seam the
// dev endpoint and sim harness can read.

afterEach(() => { vi.restoreAllMocks() })

describe('MockEmailProvider — verification visibility', () => {
  it('prints CODE and LINK on one parse-free line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const provider = new MockEmailProvider()
    await provider.send({
      to: 'maria@example.ro',
      subject: 'Codul tău de verificare: 483920',
      html: '<p>Codul tău de verificare este <strong>483920</strong>.</p><p>Sau apasă direct: <a href="http://localhost:3001/api/auth/verify?token=abc-123">confirmă adresa</a>.</p>',
    })
    const lines = log.mock.calls.map((c) => c.join(' '))
    const codeLine = lines.find((l) => l.includes('CODE:'))
    expect(codeLine).toBeDefined()
    expect(codeLine).toContain('CODE: 483920')
    expect(codeLine).toContain('LINK: http://localhost:3001/api/auth/verify?token=abc-123')
  })

  it('records the last send per target with parsed code + link', async () => {
    const provider = new MockEmailProvider()
    await provider.send({
      to: 'ion@example.ro',
      subject: 'Your verification code: 111111',
      html: '<a href="http://localhost:3001/api/auth/verify?token=t-1">x</a>',
    })
    await provider.send({
      to: 'ion@example.ro',
      subject: 'Your verification code: 222222',
      html: '<a href="http://localhost:3001/api/auth/verify?token=t-2">x</a>',
    })
    const rec = lastMockEmailTo('ion@example.ro')
    expect(rec).toMatchObject({ to: 'ion@example.ro', code: '222222', link: 'http://localhost:3001/api/auth/verify?token=t-2' })
  })

  it('non-verification emails record null code/link and print no CODE line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const provider = new MockEmailProvider()
    await provider.send({ to: 'plain@example.ro', subject: 'Welcome!', html: '<p>Hello</p>' })
    expect(lastMockEmailTo('plain@example.ro')).toMatchObject({ code: null, link: null })
    expect(log.mock.calls.map((c) => c.join(' ')).some((l) => l.includes('CODE:'))).toBe(false)
  })
})

describe('appBaseUrl — ONE link base for every surface', () => {
  it('honors APP_URL', () => {
    vi.stubEnv('APP_URL', 'https://use-zeno.com')
    expect(appBaseUrl()).toBe('https://use-zeno.com')
    vi.unstubAllEnvs()
  })
  it('falls back to the dev port 3001 (dev runs 3001, not 3000)', () => {
    vi.stubEnv('APP_URL', '')
    expect(appBaseUrl()).toBe('http://localhost:3001')
    vi.unstubAllEnvs()
  })
})
