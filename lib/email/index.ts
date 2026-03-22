/**
 * Email Provider Resolution
 *
 * Reads EMAIL_PROVIDER env var and returns a singleton instance
 * of the active email provider. Defaults to 'mock' if not set.
 */

import type { EmailProvider } from './types'

let instance: EmailProvider | null = null

export function getEmailProvider(): EmailProvider {
  if (instance) return instance

  const providerName = (
    process.env.EMAIL_PROVIDER ?? 'mock'
  ).toLowerCase()

  switch (providerName) {
    case 'resend': {
      const { ResendEmailProvider } = require('./providers/resend') as {
        ResendEmailProvider: new () => EmailProvider
      }
      instance = new ResendEmailProvider()
      break
    }
    case 'mock': {
      const { MockEmailProvider } = require('./providers/mock') as {
        MockEmailProvider: new () => EmailProvider
      }
      instance = new MockEmailProvider()
      break
    }
    default:
      throw new Error(
        `Unknown email provider: "${providerName}". ` +
          'Valid options: resend, mock',
      )
  }

  return instance
}
