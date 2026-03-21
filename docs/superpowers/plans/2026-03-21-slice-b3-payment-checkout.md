# Slice B3: Payment + Checkout Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable payment collection inline in chat, with configurable payment providers (Stripe/PayU/mock), post-purchase account creation via magic link, and confirmation email.

**Architecture:** Payment and email provider abstractions (interface + implementations), new `initiate_payment` tool, PaymentCard rich component, webhook routes, idempotent post-payment flow with atomic compare-and-swap.

**Tech Stack:** Stripe SDK, PayU REST API, Resend SDK, React (Stripe Elements), Next.js API routes

**Spec:** `docs/superpowers/specs/2026-03-21-slice-b3-payment-checkout-design.md`

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `lib/payments/types.ts` | PaymentProvider interface, PaymentIntent, PaymentStatus, WebhookEvent |
| `lib/payments/index.ts` | Provider resolution from PAYMENT_PROVIDER env var |
| `lib/payments/providers/stripe.ts` | Stripe SDK integration (test mode) |
| `lib/payments/providers/payu.ts` | PayU REST API integration (test mode) |
| `lib/payments/providers/mock.ts` | Mock provider (always succeeds) |
| `lib/payments/post-payment.ts` | Idempotent post-payment flow (atomic CAS) |
| `lib/email/types.ts` | EmailProvider interface |
| `lib/email/index.ts` | Provider resolution from EMAIL_PROVIDER env var |
| `lib/email/providers/resend.ts` | Resend SDK integration |
| `lib/email/providers/mock.ts` | Console logger for dev |
| `lib/email/templates/purchase-confirmation.ts` | Zeno-branded HTML email template |
| `lib/tools/handlers/payment-handlers.ts` | initiate_payment tool handler |
| `components/chat/rich/payment-card.tsx` | Inline payment UI (Stripe Elements / PayU redirect / mock) |
| `app/api/payments/confirm/route.ts` | Payment confirmation endpoint |
| `app/api/webhooks/stripe/route.ts` | Stripe webhook handler |
| `app/api/webhooks/payu/route.ts` | PayU IPN handler |

### Modified files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Customer magic link fields, Payment failureReason + index, MOCK enum, Policy paymentFrequency |
| `lib/tools/types.ts` | Add policy to ToolContext |
| `lib/chat/context-builder.ts` | Load policy in context |
| `lib/tools/registry.ts` | Register initiate_payment |
| `lib/tools/validation.ts` | Add initiate_payment schema |
| `components/chat/rich/rich-content.tsx` | Add show_payment + show_payment_success cases |
| `.env.example` | Add payment + email env vars |

---

## Task 1: Schema Changes + Dependencies

**Files:**
- Modify: `prisma/schema.prisma`, `lib/tools/types.ts`, `lib/chat/context-builder.ts`, `.env.example`, `package.json`

- [ ] **Step 1: Install new dependencies**

```bash
npm install stripe @stripe/stripe-js @stripe/react-stripe-js resend
```

- [ ] **Step 2: Apply schema changes**

Read `prisma/schema.prisma` and add:
1. Customer: `magicLinkToken String? @unique` and `magicLinkExpiresAt DateTime?`
2. Payment: `failureReason String?` and `@@index([providerPaymentId])`
3. PaymentProvider enum: add `MOCK` value
4. Policy: `paymentFrequency String?`

- [ ] **Step 3: Push schema + generate**

```bash
npx prisma db push
npx prisma generate
```

- [ ] **Step 4: Add policy to ToolContext**

In `lib/tools/types.ts`, add to ToolContext:
```typescript
policy?: { id: string; status: string; premiumMonthly: number; premiumAnnual: number; paymentFrequency: string | null }
```

In `lib/chat/context-builder.ts`, load policy via: conversation → application → quote → policy.

- [ ] **Step 5: Update .env.example**

Add all payment + email env vars from spec Section 12.

- [ ] **Step 6: Verify + commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat(b3): schema changes, deps, and ToolContext policy field"
```

---

## Task 2: Payment Provider Abstraction

**Files:**
- Create: `lib/payments/types.ts`, `lib/payments/index.ts`, `lib/payments/providers/stripe.ts`, `lib/payments/providers/payu.ts`, `lib/payments/providers/mock.ts`

- [ ] **Step 1: Create payment types and provider implementations**

Read spec Sections 5.1-5.5 for exact interfaces and implementation details.

**types.ts:** PaymentProvider interface, PaymentIntent, PaymentStatus, WebhookEvent types.

**index.ts:** Read `PAYMENT_PROVIDER` env var → return singleton. Default to 'mock' if not set.

**stripe.ts:** Uses `stripe` package. `createPaymentIntent` calls `stripe.paymentIntents.create()`. `handleWebhook` validates signature. Uses `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.

**payu.ts:** Uses fetch for PayU REST API. Returns redirect URL in PaymentIntent. Uses `PAYU_MERCHANT_ID` and `PAYU_SECRET_KEY`.

**mock.ts:** `createPaymentIntent` returns mock IDs. `getPaymentStatus` always returns completed. 2-second simulated delay.

- [ ] **Step 2: Verify + commit**

```bash
npx tsc --noEmit
git add lib/payments/
git commit -m "feat(b3): add payment provider abstraction with Stripe, PayU, and mock implementations"
```

---

## Task 3: Email System

**Files:**
- Create: `lib/email/types.ts`, `lib/email/index.ts`, `lib/email/providers/resend.ts`, `lib/email/providers/mock.ts`, `lib/email/templates/purchase-confirmation.ts`

- [ ] **Step 1: Create email types and providers**

Read spec Section 10 for interfaces.

**types.ts:** EmailProvider interface with `send()` method.

**index.ts:** Read `EMAIL_PROVIDER` env var → singleton. Default to 'mock'.

**resend.ts:** Uses `resend` package. `send()` calls `resend.emails.send()`.

**mock.ts:** Logs email to console. Returns fake messageId.

- [ ] **Step 2: Create confirmation email template**

Read spec Section 10.4. HTML template with inline CSS and Zeno branding:
- Zeno text logo
- "Felicitări, {name}!" headline
- Policy summary table
- "Accesează contul tău" CTA button with magic link URL
- Footer: Zeno, powered by Allianz-Țiriac
- Romanian + English variants based on language parameter

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit
git add lib/email/
git commit -m "feat(b3): add email system with Resend provider and purchase confirmation template"
```

---

## Task 4: Post-Payment Flow + Payment Tool + PaymentCard

**Files:**
- Create: `lib/payments/post-payment.ts`, `lib/tools/handlers/payment-handlers.ts`, `components/chat/rich/payment-card.tsx`
- Modify: `lib/tools/registry.ts`, `lib/tools/validation.ts`, `components/chat/rich/rich-content.tsx`

- [ ] **Step 1: Create post-payment flow**

`lib/payments/post-payment.ts`:

```typescript
export async function runPostPaymentFlow(paymentId: string): Promise<{ emailSent: boolean }>
```

Atomic compare-and-swap idempotency (spec Section 7):
1. `prisma.payment.updateMany({ where: { id: paymentId, status: 'PENDING' }, data: { status: 'COMPLETED', paidAt: new Date() } })` → if count=0 return
2. Load Payment with Policy, Customer, Quote
3. Update Policy → status: SUBMITTED
4. Generate magic link: `crypto.randomUUID()`, set Customer.magicLinkToken + expiresAt (7 days), isAnonymous=false
5. Send confirmation email (catch errors, don't throw — log and continue)
6. Return { emailSent }

- [ ] **Step 2: Create payment handler**

`lib/tools/handlers/payment-handlers.ts`:

`initiate_payment` tool:
1. Find PENDING_SUBMISSION policy via context.policy (from ToolContext)
2. Calculate amount (premiumMonthly * 100 for bani, or annual based on paymentFrequency)
3. Call paymentProvider.createPaymentIntent()
4. Create Payment record (status: PENDING)
5. Return uiAction: show_payment with clientSecret, amount, providerName, paymentId

Register in registry.ts: blocking, visible, status messages from spec.
Add schema in validation.ts.

- [ ] **Step 3: Create PaymentCard component**

`components/chat/rich/payment-card.tsx`:

Three rendering modes based on `providerName`:
- **stripe:** `<Elements>` + `<PaymentElement>` with Zeno appearance theme. Submit calls `stripe.confirmPayment()` with return_url. On immediate success → POST to /api/payments/confirm.
- **payu:** Amount summary + "Continuă la PayU" redirect button.
- **mock:** Amount summary + "Simulează plata" button → 2s delay → POST to /api/payments/confirm.

Brand book: serious/reassuring tone, Forest primary button, proper loading/error states.

Needs `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` env var for Stripe.js initialization.

- [ ] **Step 4: Update RichContent**

Add `show_payment` and `show_payment_success` cases to `components/chat/rich/rich-content.tsx`.

- [ ] **Step 5: Verify + commit**

```bash
npx tsc --noEmit
git add lib/payments/post-payment.ts lib/tools/handlers/payment-handlers.ts components/chat/rich/payment-card.tsx components/chat/rich/rich-content.tsx lib/tools/registry.ts lib/tools/validation.ts
git commit -m "feat(b3): add post-payment flow, payment tool, and PaymentCard component"
```

---

## Task 5: API Routes (Confirm + Webhooks)

**Files:**
- Create: `app/api/payments/confirm/route.ts`, `app/api/webhooks/stripe/route.ts`, `app/api/webhooks/payu/route.ts`

- [ ] **Step 1: Create confirm route**

`app/api/payments/confirm/route.ts`:

POST handler:
1. Parse body { paymentId }
2. Load Payment, verify with provider getPaymentStatus() → must be completed
3. Call runPostPaymentFlow(paymentId)
4. Return { success, policyStatus, emailSent }

GET handler (for PayU redirect return):
1. Extract provider + orderId from query params
2. Find Payment by providerPaymentId
3. Verify status with provider
4. Call runPostPaymentFlow()
5. Redirect to `/chat/[conversationId]?payment=success`

- [ ] **Step 2: Create Stripe webhook route**

`app/api/webhooks/stripe/route.ts`:

1. Read raw body (not JSON parsed) + stripe-signature header
2. Call stripeProvider.handleWebhook(body, signature)
3. If unknown event → return 200
4. Find Payment by providerPaymentId
5. payment_succeeded → runPostPaymentFlow()
6. payment_failed → update Payment.status FAILED + failureReason
7. Return 200

IMPORTANT: Must use `request.text()` not `request.json()` for raw body (Stripe signature validation requires raw bytes).

- [ ] **Step 3: Create PayU webhook route**

`app/api/webhooks/payu/route.ts`:

Similar pattern but for PayU IPN format.

- [ ] **Step 4: Verify + commit**

```bash
npx tsc --noEmit
git add app/api/payments/ app/api/webhooks/
git commit -m "feat(b3): add payment confirm and webhook routes"
```

---

## Task 6: Final Verification

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`

- [ ] **Step 2: Build**

Run: `npm run build`

- [ ] **Step 3: Tests**

Run: `npx vitest run`

- [ ] **Step 4: Re-seed**

Run: `npx prisma db seed`

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(b3): complete Slice B3 — payment providers, checkout flow, email system"
```

---

## Notes for Implementer

1. **Stripe test keys:** Use `sk_test_...` and `pk_test_...` from Stripe dashboard test mode. No real money charged.
2. **PayU sandbox:** PayU provides sandbox credentials at payu.ro. Use their test merchant ID.
3. **Mock mode:** Default `PAYMENT_PROVIDER=mock` for development. No external credentials needed.
4. **Atomic idempotency:** The `updateMany` with `status: 'PENDING'` WHERE clause is critical. Do NOT use findFirst + update (race condition).
5. **Stripe raw body:** Webhook validation requires `request.text()`, not `request.json()`. The signature is computed over the raw string.
6. **`NEXT_PUBLIC_` prefix:** Only `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is client-exposed. All other keys are server-only.
7. **Email failures:** Log and continue. Never reverse a completed payment because email failed.
8. **Magic link:** 7-day expiry, `crypto.randomUUID()`. The `@unique` index on `magicLinkToken` ensures fast lookups in B4 dashboard.
