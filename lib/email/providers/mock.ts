/**
 * Mock Email Provider
 *
 * Logs email details to console for development.
 * Returns a fake messageId. No external dependencies.
 */

import type { EmailProvider } from '../types'

export class MockEmailProvider implements EmailProvider {
  // D4.3 (erratum 2): tests assert outbound sends without a provider
  // injection point — every send is recorded here (console.log kept).
  readonly sent: { to: string; subject: string; html: string }[] = []

  async send(input: {
    to: string
    subject: string
    html: string
    from?: string
    replyTo?: string
  }): Promise<{ messageId: string }> {
    const messageId = `mock_email_${Date.now()}`
    this.sent.push({ to: input.to, subject: input.subject, html: input.html })

    // test seam (B3.5): integration tests read the last send (e.g. to pull
    // the OTP code out of the subject) without a provider injection point
    ;(globalThis as Record<string, unknown>).__lastMockEmail = input

    console.log('[MockEmail] ─────────────────────────────────')
    console.log(`  To:      ${input.to}`)
    console.log(`  Subject: ${input.subject}`)
    console.log(`  From:    ${input.from ?? '(default)'}`)
    if (input.replyTo) {
      console.log(`  ReplyTo: ${input.replyTo}`)
    }
    console.log(`  ID:      ${messageId}`)
    console.log('[MockEmail] ─────────────────────────────────')

    return { messageId }
  }
}
