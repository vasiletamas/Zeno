/**
 * PayU Payment Provider
 *
 * PayU REST API integration using test/sandbox mode.
 * Uses plain fetch calls (no official SDK).
 * Requires PAYU_MERCHANT_ID and PAYU_SECRET_KEY env vars.
 *
 * PayU uses a redirect-based flow: the customer is redirected to PayU's
 * hosted page, which redirects back on completion.
 */

import crypto from 'crypto'
import { appBaseUrl } from '@/lib/app-url'
import type {
  PaymentProvider,
  PaymentIntent,
  PaymentStatus,
  WebhookEvent,
} from '../types'

const PAYU_API_BASE = 'https://secure.snd.payu.com' // sandbox

function getPayUConfig() {
  const merchantId = process.env.PAYU_MERCHANT_ID
  const secretKey = process.env.PAYU_SECRET_KEY
  if (!merchantId || !secretKey) {
    throw new Error(
      'PAYU_MERCHANT_ID and PAYU_SECRET_KEY must be set for PayU provider.',
    )
  }
  return { merchantId, secretKey }
}

async function getAccessToken(
  merchantId: string,
  secretKey: string,
): Promise<string> {
  const response = await fetch(`${PAYU_API_BASE}/pl/standard/user/oauth/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: merchantId,
      client_secret: secretKey,
    }),
  })

  if (!response.ok) {
    throw new Error(`PayU auth failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as { access_token: string }
  return data.access_token
}

export class PayUPaymentProvider implements PaymentProvider {
  name = 'payu'

  async createPaymentIntent(input: {
    amount: number
    currency: string
    customerId: string
    referenceId: string
    description: string
  }): Promise<PaymentIntent> {
    const { merchantId, secretKey } = getPayUConfig()
    const accessToken = await getAccessToken(merchantId, secretKey)

    const appUrl = appBaseUrl()

    const orderPayload = {
      merchantPosId: merchantId,
      description: input.description,
      currencyCode: input.currency,
      totalAmount: String(input.amount), // PayU expects string amount in smallest unit
      extOrderId: `${input.referenceId}_${Date.now()}`,
      continueUrl: `${appUrl}/api/payments/confirm?provider=payu`,
      notifyUrl: `${appUrl}/api/webhooks/payu`,
      products: [
        {
          name: input.description,
          unitPrice: String(input.amount),
          quantity: '1',
        },
      ],
      buyer: {
        extCustomerId: input.customerId,
      },
    }

    const response = await fetch(`${PAYU_API_BASE}/api/v2_1/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(orderPayload),
      redirect: 'manual', // PayU responds with 302 redirect
    })

    // PayU returns 302 with redirect to payment page, or 200/201 with order data
    const redirectUrl = response.headers.get('location')

    let orderId: string
    if (response.status === 302 && redirectUrl) {
      // Extract orderId from redirect URL query params or from response
      const url = new URL(redirectUrl)
      orderId = url.searchParams.get('orderId') ?? `payu_${Date.now()}`
    } else {
      const data = (await response.json()) as {
        orderId?: string
        redirectUri?: string
      }
      orderId = data.orderId ?? `payu_${Date.now()}`
      // If response body has redirectUri, use that
      if (data.redirectUri) {
        return {
          clientSecret: '',
          providerPaymentId: orderId,
          providerName: this.name,
          redirectUrl: data.redirectUri,
        }
      }
    }

    return {
      clientSecret: '',
      providerPaymentId: orderId,
      providerName: this.name,
      redirectUrl: redirectUrl ?? undefined,
    }
  }

  async getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus> {
    const { merchantId, secretKey } = getPayUConfig()
    const accessToken = await getAccessToken(merchantId, secretKey)

    const response = await fetch(
      `${PAYU_API_BASE}/api/v2_1/orders/${providerPaymentId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    )

    if (!response.ok) {
      return { status: 'pending' }
    }

    const data = (await response.json()) as {
      orders?: Array<{ status: string; completedAt?: string }>
    }

    const order = data.orders?.[0]
    if (!order) return { status: 'pending' }

    switch (order.status) {
      case 'COMPLETED':
        return {
          status: 'completed',
          paidAt: order.completedAt ? new Date(order.completedAt) : new Date(),
        }
      case 'CANCELED':
      case 'REJECTED':
        return {
          status: 'failed',
          failureReason: `Order ${order.status.toLowerCase()}`,
        }
      default:
        return { status: 'pending' }
    }
  }

  async cancelPaymentIntent(providerPaymentId: string): Promise<void> {
    const { merchantId, secretKey } = getPayUConfig()
    const accessToken = await getAccessToken(merchantId, secretKey)
    const response = await fetch(`${PAYU_API_BASE}/api/v2_1/orders/${providerPaymentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      throw new Error(`PayU order cancel failed: ${response.status} ${response.statusText}`)
    }
  }

  async refundPayment(providerPaymentId: string, amountMinor: number): Promise<{ providerRefundId: string }> {
    const { merchantId, secretKey } = getPayUConfig()
    const accessToken = await getAccessToken(merchantId, secretKey)
    const response = await fetch(`${PAYU_API_BASE}/api/v2_1/orders/${providerPaymentId}/refunds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ refund: { description: 'Free-look / pre-activation refund', amount: String(amountMinor) } }),
    })
    if (!response.ok) {
      throw new Error(`PayU refund failed: ${response.status} ${response.statusText}`)
    }
    const data = (await response.json()) as { refund?: { refundId?: string } }
    return { providerRefundId: data.refund?.refundId ?? `payu_refund_${providerPaymentId}` }
  }

  async handleWebhook(
    payload: unknown,
    signature: string,
  ): Promise<WebhookEvent> {
    // Validate IPN signature: PayU sends OpenPayU-Signature header
    // Format: "signature=<hash>;algorithm=<alg>;sender=checkout"
    // D2.7 (T8.D3): an UNSIGNED payload is a hard reject — the old code
    // skipped verification when the segment was absent (live forgery flaw).
    // The check runs before the config read so the reject is unconditional.
    const signatureParts = signature.split(';')
    const hashPart = signatureParts.find((p) => p.startsWith('signature='))
    const expectedHash = hashPart?.split('=')?.[1]
    if (!expectedHash) {
      throw new Error('Missing PayU webhook signature')
    }

    const { secretKey } = getPayUConfig()
    const payloadString =
      typeof payload === 'string' ? payload : JSON.stringify(payload)
    // NOTE: the HMAC-MD5 scheme must be validated against the OpenPayU IPN
    // spec before production (flagged per T8.D3) — sandbox-verified only.
    const computedHash = crypto
      .createHmac('md5', secretKey)
      .update(payloadString)
      .digest('hex')

    if (computedHash !== expectedHash) {
      throw new Error('Invalid PayU webhook signature')
    }

    const body = (
      typeof payload === 'string' ? JSON.parse(payload) : payload
    ) as {
      order?: {
        orderId: string
        status: string
        extOrderId?: string
      }
    }

    const order = body.order
    if (!order) {
      throw new Error('Invalid PayU webhook payload: missing order')
    }

    // PayU IPNs carry no event id — the (orderId, status) pair is the
    // stable identity feeding the inbox dedup key.
    const eventId = `${order.orderId}:${order.status}`

    if (order.status === 'COMPLETED') {
      return {
        event: 'payment_succeeded',
        eventId,
        providerPaymentId: order.orderId,
        metadata: { extOrderId: order.extOrderId },
      }
    }

    if (order.status === 'PENDING' || order.status === 'WAITING_FOR_CONFIRMATION') {
      return {
        event: 'ignored',
        eventId,
        providerPaymentId: order.orderId,
        metadata: { status: order.status, extOrderId: order.extOrderId },
      }
    }

    return {
      event: 'payment_failed',
      eventId,
      providerPaymentId: order.orderId,
      metadata: { status: order.status, extOrderId: order.extOrderId },
    }
  }
}
