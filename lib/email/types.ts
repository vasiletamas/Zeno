/**
 * Email Provider Abstraction — Types
 *
 * Defines the interface for the email provider abstraction layer.
 * All providers (Resend, mock) implement the EmailProvider interface.
 */

export interface EmailProvider {
  send(input: {
    to: string
    subject: string
    html: string
    from?: string
    replyTo?: string
  }): Promise<{ messageId: string }>
}
