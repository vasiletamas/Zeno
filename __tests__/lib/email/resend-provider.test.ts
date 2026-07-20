import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the Resend SDK so no network call happens. `mockSend` is captured
// by the factory (Vitest allows factory references only for names starting
// with "mock"), and stands in for `resend.emails.send`.
const mockSend = vi.fn()
vi.mock('resend', () => ({
  // A regular function (not an arrow) so `new Resend(...)` works; returning
  // an object makes `new` yield it. The vi.fn wrapper still records the
  // constructor args so we can assert the API key was passed.
  Resend: vi.fn(function () {
    return { emails: { send: mockSend } }
  }),
}))

import { ResendEmailProvider } from '@/lib/email/providers/resend'
import { Resend } from 'resend'

const ResendCtor = Resend as unknown as ReturnType<typeof vi.fn>

describe('ResendEmailProvider', () => {
  beforeEach(() => {
    mockSend.mockReset()
    ResendCtor.mockClear()
    vi.stubEnv('RESEND_API_KEY', 're_test_key')
    vi.stubEnv('EMAIL_FROM', 'Zeno <auth@personal.example>')
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('throws when RESEND_API_KEY is missing', () => {
    vi.stubEnv('RESEND_API_KEY', '')
    expect(() => new ResendEmailProvider()).toThrow(/RESEND_API_KEY/)
  })

  it('constructs the SDK with the configured API key', () => {
    new ResendEmailProvider()
    expect(ResendCtor).toHaveBeenCalledWith('re_test_key')
  })

  it('maps every field and sends from EMAIL_FROM', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email_123' }, error: null })
    const provider = new ResendEmailProvider()

    const res = await provider.send({
      to: 'maria@example.ro',
      subject: 'Codul tău de verificare: 483920',
      html: '<p>483920</p>',
      replyTo: 'support@personal.example',
    })

    expect(mockSend).toHaveBeenCalledWith({
      from: 'Zeno <auth@personal.example>',
      to: 'maria@example.ro',
      subject: 'Codul tău de verificare: 483920',
      html: '<p>483920</p>',
      replyTo: 'support@personal.example',
    })
    expect(res).toEqual({ messageId: 'email_123' })
  })

  it('lets a per-call from override EMAIL_FROM', async () => {
    mockSend.mockResolvedValue({ data: { id: 'e1' }, error: null })
    const provider = new ResendEmailProvider()

    await provider.send({ to: 'x@example.ro', subject: 's', html: 'h', from: 'Other <o@d.com>' })

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ from: 'Other <o@d.com>' }))
  })

  it('throws a clear error when neither from nor EMAIL_FROM is set — never sends', async () => {
    vi.stubEnv('EMAIL_FROM', '')
    const provider = new ResendEmailProvider()

    await expect(
      provider.send({ to: 'x@example.ro', subject: 's', html: 'h' }),
    ).rejects.toThrow(/EMAIL_FROM/)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('surfaces a Resend API error (e.g. unverified domain)', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: 'The domain is not verified', name: 'validation_error' },
    })
    const provider = new ResendEmailProvider()

    await expect(
      provider.send({ to: 'x@example.ro', subject: 's', html: 'h' }),
    ).rejects.toThrow(/domain is not verified/)
  })

  it('returns "unknown" messageId when the response carries no id', async () => {
    mockSend.mockResolvedValue({ data: null, error: null })
    const provider = new ResendEmailProvider()

    const res = await provider.send({ to: 'x@example.ro', subject: 's', html: 'h' })
    expect(res.messageId).toBe('unknown')
  })
})
