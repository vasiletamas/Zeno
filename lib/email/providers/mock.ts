/**
 * Mock Email Provider
 *
 * Logs email details to console for development.
 * Returns a fake messageId. No external dependencies.
 */

import type { EmailProvider } from '../types'

export class MockEmailProvider implements EmailProvider {
  async send(input: {
    to: string
    subject: string
    html: string
    from?: string
    replyTo?: string
  }): Promise<{ messageId: string }> {
    const messageId = `mock_email_${Date.now()}`

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
