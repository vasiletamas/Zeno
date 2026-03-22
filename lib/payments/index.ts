/**
 * Payment Provider Resolution
 *
 * Reads PAYMENT_PROVIDER env var and returns a singleton instance
 * of the active payment provider. Defaults to 'mock' if not set.
 */

import type { PaymentProvider } from './types'

let instance: PaymentProvider | null = null

export function getPaymentProvider(): PaymentProvider {
  if (instance) return instance

  const providerName = (
    process.env.PAYMENT_PROVIDER ?? 'mock'
  ).toLowerCase()

  switch (providerName) {
    case 'stripe': {
      // Dynamic import to avoid loading Stripe SDK when not needed
      const { StripePaymentProvider } = require('./providers/stripe') as {
        StripePaymentProvider: new () => PaymentProvider
      }
      instance = new StripePaymentProvider()
      break
    }
    case 'payu': {
      const { PayUPaymentProvider } = require('./providers/payu') as {
        PayUPaymentProvider: new () => PaymentProvider
      }
      instance = new PayUPaymentProvider()
      break
    }
    case 'mock': {
      const { MockPaymentProvider } = require('./providers/mock') as {
        MockPaymentProvider: new () => PaymentProvider
      }
      instance = new MockPaymentProvider()
      break
    }
    default:
      throw new Error(
        `Unknown payment provider: "${providerName}". ` +
          'Valid options: stripe, payu, mock',
      )
  }

  return instance
}
