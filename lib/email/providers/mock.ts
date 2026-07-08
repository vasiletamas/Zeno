/**
 * Mock Email Provider
 *
 * Logs email details to console for development.
 * Returns a fake messageId. No external dependencies.
 */

import type { EmailProvider } from '../types'

/** Task 4.1 (D6): a recorded send with the verification bits pre-parsed. */
export interface RecordedMockEmail {
  to: string
  subject: string
  html: string
  code: string | null
  link: string | null
  sentAt: string
}

// Keyed per target on globalThis so the dev endpoint, the sim harness and
// the provider (re-instantiated across Next.js HMR module copies) all read
// the same log.
const LOG_KEY = '__mockEmailLogByTarget'
function logByTarget(): Map<string, RecordedMockEmail> {
  const g = globalThis as Record<string, unknown>
  if (!(g[LOG_KEY] instanceof Map)) g[LOG_KEY] = new Map<string, RecordedMockEmail>()
  return g[LOG_KEY] as Map<string, RecordedMockEmail>
}

/** The last mock send to a target, verification bits parsed — dev-only seam. */
export function lastMockEmailTo(target: string): RecordedMockEmail | null {
  return logByTarget().get(target) ?? null
}

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

    // Task 4.1 (D6): verification bits parsed once, recorded per target for
    // the dev endpoint / sim harness.
    const code = (input.subject.match(/\b(\d{6})\b/) ?? input.html.match(/\b(\d{6})\b/))?.[1] ?? null
    const link = input.html.match(/href="([^"]*\/api\/auth\/verify\?token=[^"]*)"/)?.[1] ?? null
    logByTarget().set(input.to, { to: input.to, subject: input.subject, html: input.html, code, link, sentAt: new Date().toISOString() })

    console.log('[MockEmail] ─────────────────────────────────')
    console.log(`  To:      ${input.to}`)
    console.log(`  Subject: ${input.subject}`)
    console.log(`  From:    ${input.from ?? '(default)'}`)
    if (input.replyTo) {
      console.log(`  ReplyTo: ${input.replyTo}`)
    }
    console.log(`  ID:      ${messageId}`)
    // ONE parse-free line for humans and harnesses (Task 4.1, D6)
    if (code || link) {
      console.log(`[MockEmail] CODE: ${code ?? '(none)'}  LINK: ${link ?? '(none)'}`)
    }
    console.log('[MockEmail] ─────────────────────────────────')

    return { messageId }
  }
}
