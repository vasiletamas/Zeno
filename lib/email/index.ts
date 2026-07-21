/**
 * Email Provider Resolution
 *
 * Reads EMAIL_PROVIDER env var and returns a singleton instance
 * of the active email provider. Defaults to 'mock' if not set.
 */

import type { EmailProvider } from './types'
import { MockEmailProvider } from './providers/mock'
import { ResendEmailProvider } from './providers/resend'

let instance: EmailProvider | null = null

export function getEmailProvider(): EmailProvider {
  if (instance) return instance

  const providerName = (
    process.env.EMAIL_PROVIDER ?? 'mock'
  ).toLowerCase()

  switch (providerName) {
    case 'resend': {
      // Static import, NOT a lazy require(): `require` inside this ESM module
      // fails to resolve ("Cannot find module './providers/resend'"), so
      // EMAIL_PROVIDER=resend threw instead of sending — verification codes
      // would silently stop being delivered while every other test stayed
      // green (pinned by provider-resolution.test.ts). Importing the module
      // is free; the Resend client is only constructed here, and its
      // constructor is what demands RESEND_API_KEY.
      instance = new ResendEmailProvider()
      break
    }
    case 'mock': {
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
