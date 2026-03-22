/**
 * Resend Email Provider
 *
 * Uses the Resend SDK to send transactional emails.
 * Requires RESEND_API_KEY env var. Default from address
 * from EMAIL_FROM env var or 'Zeno <noreply@zeno.ro>'.
 */

import { Resend } from 'resend'
import type { EmailProvider } from '../types'

const DEFAULT_FROM = 'Zeno <noreply@zeno.ro>'

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
    const result = await this.resend.emails.send({
      from: input.from ?? process.env.EMAIL_FROM ?? DEFAULT_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      replyTo: input.replyTo,
    })

    if (result.error) {
      throw new Error(`Resend error: ${result.error.message}`)
    }

    return { messageId: result.data?.id ?? 'unknown' }
  }
}
