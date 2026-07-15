/**
 * Email Provider Resolution
 *
 * Reads EMAIL_PROVIDER env var and returns a singleton instance
 * of the active email provider. Defaults to 'mock' if not set.
 */

import type { EmailProvider } from './types'
import { MockEmailProvider } from './providers/mock'

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
      // Static import (unlike resend below): dependency-free, and the lazy
      // require() path does not resolve under the ESM test runner.
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
