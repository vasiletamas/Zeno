# Slice B3: Payment + Checkout — Design Spec

**Project:** Zeno — AI Life Insurance Sales Agent V2
**Slice:** B3 (Payment Provider Abstraction, Inline Payment, Post-Purchase Account + Email)
**Date:** 2026-03-21
**Status:** Approved
**Depends on:** Slice B2 (Sales Flow UI) — complete

---

## 1. Goal

Enable a customer to pay their first premium inline in the chat conversation, receive a confirmation email, and get an account with magic link access. Payment provider is configurable (Stripe, PayU, mock) via environment variable.

## 2. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Payment providers | Stripe + PayU + mock, all in sandbox/test mode | No agreements yet. Build real integrations using test APIs. Swap to production keys when ready. |
| Provider selection | Env var `PAYMENT_PROVIDER` | One active provider per environment. Simple, no runtime switching needed. |
| Email provider | Resend + mock, abstracted | Resend has free tier (100/day). Mock for dev. Same abstraction pattern as payment. |
| Account creation | Magic link, no password | Minimal friction. Token in email → dashboard access. No auth library needed yet. |
| Payment UI | Inline in chat (rich component) | Consistent with B2 pattern. Stripe Elements for Stripe, redirect for PayU, button for mock. |
| Post-payment flow | Idempotent | Both confirm API and webhook trigger the same flow. Safe for duplicate events. |

## 3. Schema Changes

Add to Customer model:
```prisma
magicLinkToken     String?
magicLinkExpiresAt DateTime?
```

Run `npx prisma db push` after schema change.

## 4. File Structure

```
lib/payments/
  types.ts                        — PaymentProvider interface
  index.ts                        — Provider resolution from env var
  providers/
    stripe.ts                     — Stripe SDK integration (test mode)
    payu.ts                       — PayU REST API integration (test mode)
    mock.ts                       — Mock provider (always succeeds after delay)

lib/email/
  types.ts                        — EmailProvider interface
  index.ts                        — Provider resolution from env var
  providers/
    resend.ts                     — Resend SDK integration
    mock.ts                       — Console logger (dev mode)
  templates/
    purchase-confirmation.ts      — HTML email template with Zeno branding

lib/tools/handlers/
  payment-handlers.ts             — NEW: initiate_payment tool handler

lib/payments/
  post-payment.ts                 — Idempotent post-payment flow (update records, create account, send email)

components/chat/rich/
  payment-card.tsx                — NEW: inline payment UI (Stripe Elements / PayU / mock)

app/api/
  payments/
    confirm/route.ts              — Payment confirmation endpoint
  webhooks/
    stripe/route.ts               — Stripe webhook handler
    payu/route.ts                 — PayU IPN handler

lib/tools/registry.ts             — MODIFIED: register initiate_payment
lib/tools/validation.ts           — MODIFIED: add initiate_payment schema
components/chat/rich/rich-content.tsx — MODIFIED: add show_payment + show_payment_success cases
```

## 5. Payment Provider Abstraction

### 5.1 Types (`lib/payments/types.ts`)

```typescript
export interface PaymentIntent {
  clientSecret: string           // for client-side confirmation (Stripe)
  providerPaymentId: string      // provider's payment/order ID
  providerName: string           // 'stripe' | 'payu' | 'mock'
  redirectUrl?: string           // for redirect-based providers (PayU)
}

export interface PaymentStatus {
  status: 'pending' | 'completed' | 'failed'
  paidAt?: Date
  failureReason?: string
}

export interface WebhookEvent {
  event: 'payment_succeeded' | 'payment_failed'
  providerPaymentId: string
  metadata?: Record<string, unknown>
}

export interface PaymentProvider {
  name: string

  createPaymentIntent(input: {
    amount: number               // in smallest currency unit (RON bani = amount * 100)
    currency: string             // 'RON'
    customerId: string
    policyId: string
    description: string
  }): Promise<PaymentIntent>

  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus>

  handleWebhook(payload: unknown, signature: string): Promise<WebhookEvent>
}
```

### 5.2 Provider Resolution (`lib/payments/index.ts`)

```typescript
export function getPaymentProvider(): PaymentProvider
```

Reads `PAYMENT_PROVIDER` env var. Returns singleton instance of the active provider. Throws if env var is set to unknown provider.

### 5.3 Stripe Provider (`lib/payments/providers/stripe.ts`)

Uses `stripe` npm package (already installed from Phase A — it was bundled with openai SDK, or install explicitly).

- `createPaymentIntent`: calls `stripe.paymentIntents.create({ amount, currency, metadata: { customerId, policyId } })`
- `getPaymentStatus`: calls `stripe.paymentIntents.retrieve(id)` → map status
- `handleWebhook`: `stripe.webhooks.constructEvent(payload, signature, webhookSecret)` → extract event type and payment intent ID

Env vars: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`

### 5.4 PayU Provider (`lib/payments/providers/payu.ts`)

Uses PayU REST API (no official SDK — plain fetch calls).

- `createPaymentIntent`: POST to PayU create order endpoint, returns redirect URL
- `getPaymentStatus`: GET order status from PayU API
- `handleWebhook`: Validate IPN hash signature, parse notification XML/JSON

Env vars: `PAYU_MERCHANT_ID`, `PAYU_SECRET_KEY`

Note: PayU uses redirect-based flow (not inline). The PaymentCard will redirect the customer to PayU's hosted page, which redirects back to `/api/payments/confirm?provider=payu&orderId=...` on completion.

### 5.5 Mock Provider (`lib/payments/providers/mock.ts`)

For development without payment credentials.

- `createPaymentIntent`: returns `{ clientSecret: 'mock_secret', providerPaymentId: 'mock_pay_' + timestamp, providerName: 'mock' }`
- `getPaymentStatus`: always returns `{ status: 'completed', paidAt: new Date() }` after a 2-second simulated delay
- `handleWebhook`: returns `{ event: 'payment_succeeded', providerPaymentId: extracted from payload }`

## 6. Payment Tool + UI

### 6.1 initiate_payment tool (`lib/tools/handlers/payment-handlers.ts`)

```typescript
export const initiatePayment: ToolHandler = async (args, context) => {
  // 1. Find PENDING_SUBMISSION policy for this conversation
  //    via: conversation → application → quote → policy
  // 2. Get payment provider
  // 3. Calculate amount in bani (policy.premiumMonthly * 100 for first month,
  //    or policy.premiumAnnual * 100 for annual — use policy.paymentFrequency)
  // 4. Create PaymentIntent via provider
  // 5. Create Payment record in DB:
  //    { policyId, customerId, amount, currency, provider: enum, providerPaymentId, status: PENDING }
  // 6. Return uiAction: {
  //      type: 'show_payment',
  //      payload: { clientSecret, amount, currency, providerName, paymentId, policyDescription }
  //    }
}
```

Register in `lib/tools/registry.ts`: `initiate_payment`, blocking, visible, status messages:
```json
{
  "ro": ["Pregătesc plata... un moment", "Conectez sistemul de plată"],
  "en": ["Preparing payment... one moment", "Connecting payment system"]
}
```

### 6.2 PaymentCard (`components/chat/rich/payment-card.tsx`)

Props: `{ clientSecret, amount, currency, providerName, paymentId, policyDescription, onPaymentComplete, language, isAnswered }`

**For Stripe (`providerName === 'stripe'`):**
- Load Stripe.js via `@stripe/stripe-js` + `@stripe/react-stripe-js`
- Render `<Elements>` wrapper with `clientSecret`
- Show `<CardElement>` for card input (or `<PaymentElement>` for broader methods)
- Submit button: "Plătește {amount} {currency}" (primary button, Forest bg)
- On submit: `stripe.confirmPayment()` → on success: call `onPaymentComplete(paymentId)`
- On error: show error message inline (Error color)
- Card styling matches Zeno brand: Forest text, warm-border, Linen bg

**For PayU (`providerName === 'payu'`):**
- Show amount summary + "Continuă la PayU" button
- Click → redirect to PayU hosted page (redirectUrl from PaymentIntent)
- Return URL: `/api/payments/confirm?provider=payu&orderId=...`

**For mock (`providerName === 'mock'`):**
- Show amount summary + "Simulează plata" button
- Click → 2s loading spinner → call `onPaymentComplete(paymentId)`

**Loading state:** Button shows spinner during processing
**Success state:** Green check + "Plata confirmată!" text, card becomes read-only
**Brand book compliance:** Serious and reassuring tone for payment (brand book S16 tone rules)

### 6.3 Payment Success UI

After `onPaymentComplete(paymentId)`:
1. POST to `/api/payments/confirm` with `{ paymentId }`
2. API runs post-payment flow (Section 7)
3. Returns `{ success, policyStatus, emailSent }`
4. Orchestrator emits `ui_action: { type: 'show_payment_success' }` → shows celebration in chat

## 7. Post-Payment Flow

### `lib/payments/post-payment.ts`

```typescript
export async function runPostPaymentFlow(paymentId: string): Promise<void>
```

**Idempotent** — safe to call multiple times (checks Payment.status before proceeding).

Steps:
1. Load Payment with Policy, Customer, Quote
2. If Payment.status already COMPLETED → return (idempotent guard)
3. Update Payment → status: COMPLETED, paidAt: now
4. Update Policy → status: SUBMITTED
5. Create magic link:
   - Generate `crypto.randomUUID()` token
   - Set `Customer.magicLinkToken` and `magicLinkExpiresAt` (7 days)
   - Update `Customer.isAnonymous = false`
6. Send confirmation email via email provider
7. Log completion

**Called from:**
- `POST /api/payments/confirm` (immediate client confirmation)
- Webhook handlers (async backup confirmation)

Both call `runPostPaymentFlow(paymentId)` — idempotent guard prevents double-processing.

## 8. Payment Confirmation API

### `app/api/payments/confirm/route.ts`

```
POST /api/payments/confirm
Body: { paymentId: string }
Response: { success: boolean, policyStatus: string, emailSent: boolean }
```

1. Load Payment record
2. Verify with provider: `getPaymentStatus(providerPaymentId)` → must be 'completed'
3. Run post-payment flow
4. Return success

**PayU return URL handler:**
```
GET /api/payments/confirm?provider=payu&orderId=...
```
For PayU redirect-based flow. Extracts orderId, finds Payment by providerPaymentId, verifies status, runs post-payment flow, redirects to `/chat/[conversationId]` with success parameter.

## 9. Webhook Routes

### `app/api/webhooks/stripe/route.ts`

1. Read raw body + `stripe-signature` header
2. Call `stripeProvider.handleWebhook(body, signature)` → validates + parses
3. Find Payment by providerPaymentId
4. If `payment_succeeded`: run post-payment flow
5. If `payment_failed`: update Payment.status → FAILED
6. Return 200

### `app/api/webhooks/payu/route.ts`

1. Read IPN payload
2. Call `payuProvider.handleWebhook(body, signature)` → validates hash
3. Find Payment by providerPaymentId
4. Process event → run post-payment flow or mark failed
5. Return acknowledgment

## 10. Email System

### 10.1 Types (`lib/email/types.ts`)

```typescript
export interface EmailProvider {
  send(input: {
    to: string
    subject: string
    html: string
    from?: string
    replyTo?: string
  }): Promise<{ messageId: string }>
}
```

### 10.2 Resend Provider (`lib/email/providers/resend.ts`)

Uses `resend` npm package.

```typescript
const resend = new Resend(process.env.RESEND_API_KEY)

async send(input) {
  const result = await resend.emails.send({
    from: input.from ?? process.env.EMAIL_FROM ?? 'Zeno <noreply@zeno.ro>',
    to: input.to,
    subject: input.subject,
    html: input.html,
  })
  return { messageId: result.id }
}
```

### 10.3 Mock Provider (`lib/email/providers/mock.ts`)

Logs email to console. Returns fake messageId.

### 10.4 Confirmation Email Template (`lib/email/templates/purchase-confirmation.ts`)

```typescript
export function purchaseConfirmationEmail(data: {
  customerName: string
  tierName: string
  levelName: string
  includesAddon: boolean
  premiumMonthly: number
  currency: string
  coverages: { name: string; amount: number; currency: string }[]
  dashboardUrl: string        // with magic link token
  language: 'ro' | 'en'
}): { subject: string; html: string }
```

Romanian subject: "Felicitări! Polița ta Allianz-Țiriac este în curs de activare"
English subject: "Congratulations! Your Allianz-Țiriac policy is being activated"

HTML: simple, branded email with:
- Zeno logo (text-based, not image — for email client compatibility)
- "Felicitări, {name}!" headline
- Policy summary table (tier, level, coverages, monthly premium)
- "Polița ta va fi activată de echipa noastră în cel mai scurt timp."
- CTA button: "Accesează contul tău" → dashboardUrl with magic link
- Footer: Zeno, powered by Allianz-Țiriac

Inline CSS (email clients don't support external stylesheets). Zeno brand colors used.

## 11. New Dependencies

```bash
npm install @stripe/stripe-js @stripe/react-stripe-js stripe resend
```

- `stripe` — server-side Stripe SDK
- `@stripe/stripe-js` — client-side Stripe.js loader
- `@stripe/react-stripe-js` — React components for Stripe Elements
- `resend` — Resend email SDK

## 12. Environment Variables

```
# Payment
PAYMENT_PROVIDER=mock                    # stripe | payu | mock
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PAYU_MERCHANT_ID=
PAYU_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...   # exposed to client

# Email
EMAIL_PROVIDER=mock                      # resend | mock
RESEND_API_KEY=re_...
EMAIL_FROM=Zeno <noreply@zeno.ro>

# App
APP_URL=http://localhost:3001            # for magic link URLs in emails
```

Note: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is the only client-exposed key (required by Stripe.js).

## 13. Exit Criteria

- [ ] PaymentProvider interface with Stripe, PayU, and mock implementations
- [ ] `PAYMENT_PROVIDER` env var switches active provider
- [ ] `initiate_payment` tool creates PaymentIntent and returns PaymentCard ui_action
- [ ] PaymentCard: Stripe Elements inline for Stripe, redirect for PayU, simulate for mock
- [ ] Payment confirmation API verifies with provider and runs post-payment flow
- [ ] Webhook routes for Stripe and PayU with signature validation
- [ ] Post-payment flow: Payment → COMPLETED, Policy → SUBMITTED, Customer → non-anonymous
- [ ] Magic link token generated and stored on Customer
- [ ] EmailProvider interface with Resend and mock implementations
- [ ] Confirmation email sent with Zeno-branded template (RO/EN)
- [ ] Email contains policy summary + dashboard magic link
- [ ] Idempotent post-payment flow (safe for duplicate webhook + confirm calls)
- [ ] Schema: Customer.magicLinkToken + magicLinkExpiresAt added
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds

## 14. What B3 does NOT include

- Customer dashboard (B4 — magic link leads there)
- Admin panel (B4)
- Policy PDF generation (Phase C)
- Production payment keys (test/sandbox only)
- Recurring payments / subscription billing
- 3D Secure handling beyond Stripe's built-in (Stripe Elements handles this automatically)
- PayU inline widget (PayU uses redirect — no true inline available without specific integration)
