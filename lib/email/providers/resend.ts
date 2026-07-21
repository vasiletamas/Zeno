/**
 * Resend Email Provider
 *
 * Sends transactional email (verification codes + magic links) through
 * Resend. Two env vars drive it:
 *   - RESEND_API_KEY  — the Resend account's API key (required).
 *   - EMAIL_FROM      — the sender, e.g. "Zeno <auth@your-domain.com>".
 *                       MUST be an address on a domain you have verified in
 *                       Resend, or Resend rejects the send.
 *
 * Switching the sender domain (e.g. from the interim personal domain to the
 * public Zeno domain) is a two-line env change — swap RESEND_API_KEY and
 * EMAIL_FROM — with no code change here.
 */

import { Resend } from 'resend'
import type { EmailProvider } from '../types'

export class ResendEmailProvider implements EmailProvider {
  private resend: Resend

  constructor() {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new Error(
        'RESEND_API_KEY is required when EMAIL_PROVIDER=resend',
      )
    }
    this.resend = new Resend(apiKey)
  }

  async send(input: {
    to: string
    subject: string
    html: string
    from?: string
    replyTo?: string
  }): Promise<{ messageId: string }> {
    // The sender MUST be an address on a Resend-verified domain. We never
    // fall back to a hardcoded default: an unverified default fails silently
    // at Resend, and the interim setup sends from a personal domain that no
    // baked-in default could match. Fail loudly with an actionable message.
    const from = input.from ?? process.env.EMAIL_FROM
    if (!from) {
      throw new Error(
        'EMAIL_FROM is required when EMAIL_PROVIDER=resend — set it to a ' +
          'sender on a domain you verified in Resend, e.g. ' +
          '"Zeno <auth@your-domain.com>".',
      )
    }

    const result = await this.resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      replyTo: input.replyTo,
    })

    if (result.error) {
      throw new Error(
        `Resend failed to send to ${input.to}: ${result.error.message}`,
      )
    }

    return { messageId: result.data?.id ?? 'unknown' }
  }
}
