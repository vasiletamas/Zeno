/**
 * Payment Provider Resolution
 *
 * Reads PAYMENT_PROVIDER env var and returns a singleton instance
 * of the active payment provider. Defaults to 'mock' if not set.
 *
 * Imports are static (D2.8: the old lazy require() broke under the ESM
 * test runtime); instantiation stays lazy, so providers with env-dependent
 * constructors are only constructed when selected.
 */

import type { PaymentProvider } from './types'
import { StripePaymentProvider } from './providers/stripe'
import { PayUPaymentProvider } from './providers/payu'
import { MockPaymentProvider } from './providers/mock'

let instance: PaymentProvider | null = null

export function getPaymentProvider(): PaymentProvider {
  if (instance) return instance

  const providerName = (
    process.env.PAYMENT_PROVIDER ?? 'mock'
  ).toLowerCase()

  switch (providerName) {
    case 'stripe':
      instance = new StripePaymentProvider()
      break
    case 'payu':
      instance = new PayUPaymentProvider()
      break
    case 'mock':
      instance = new MockPaymentProvider()
      break
    default:
      throw new Error(
        `Unknown payment provider: "${providerName}". ` +
          'Valid options: stripe, payu, mock',
      )
  }

  return instance
}
