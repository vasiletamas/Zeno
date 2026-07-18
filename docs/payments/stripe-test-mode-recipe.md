# Stripe test-mode recipe (T24, P6.1)

How to drive a REAL Stripe PaymentIntent through the chat funnel locally, watch the
webhook settle it through the transactional inbox, and inspect the evidence rows.
The mock provider (`PAYMENT_PROVIDER=mock`) covers day-to-day dev; this recipe is
for verifying the actual Stripe integration end-to-end in test mode.

## 1. Environment

In `.env` (test-mode keys from the Stripe dashboard, *Developers → API keys*):

```bash
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...   # exposed to the client card element
STRIPE_WEBHOOK_SECRET=whsec_...                  # from the `stripe listen` banner — step 2
APP_URL=http://localhost:3001                    # the 3DS return_url base
```

Restart the dev server after changing these (`NEXT_PUBLIC_*` is baked at build/start).

## 2. Forward webhooks with the Stripe CLI

```bash
stripe login          # once per machine
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```

The CLI prints a banner like `Your webhook signing secret is whsec_...` — copy THAT
value into `STRIPE_WEBHOOK_SECRET` and restart the server. The route verifies every
payload signature; a wrong secret means every event 400s and gets a `bad_signature`
ALERT_FLAG WorkItem.

## 3. Drive a real PaymentIntent through the chat funnel

Walk the normal funnel at `/chat`: pick the product, complete + sign the DNT,
answer the application questions, generate the quote, acknowledge the disclosures,
accept the quote (pick any frequency), verify email and upload the ID when asked.
When the payment card renders, `ensure_payment_session` has already created a REAL
test-mode PaymentIntent (visible in the Stripe dashboard under *Payments*) and the
embedded Payment Element collects the card.

Test cards (any future expiry, any CVC, any postal code):

| Card | Behavior |
| --- | --- |
| `4242 4242 4242 4242` | Succeeds immediately — `payment_intent.succeeded` webhook settles the installment, first capture creates the Policy (`PENDING_SUBMISSION`). |
| `4000 0000 0000 9995` | Declines (`insufficient_funds`) — `payment_intent.payment_failed` marks Payment + Installment `FAILED`; re-opening the payment (`ensure_payment_session`) mints a fresh attempt in `retried` mode. |
| `4000 0025 0000 3155` | Requires 3DS — the Element redirects to Stripe's challenge page and returns to `GET /api/payments/confirm?provider=stripe&paymentId=<Payment row id>` (T30: the return is looked up by the `paymentId` param, then the outcome is provider-VERIFIED before settling; the redirect itself proves nothing). |

Duplicate deliveries and confirm/webhook races are safe by construction: the inbox
dedups on `(provider, providerEventId)` and the confirm route derives a stable
`confirm:<providerPaymentId>:<outcome>` eventId, so replays land as `replay`, never
a double settlement.

## 4. `stripe trigger` caveat

```bash
stripe trigger payment_intent.succeeded
```

fabricates a PaymentIntent that Zeno never created, so the webhook verifies fine
but matches no `Payment` row. BY DESIGN this records the event and raises ONE
`unmatched_payment` ALERT_FLAG WorkItem (per provider payment id), and the route
answers 200 so Stripe stops retrying. `stripe trigger` is therefore only good for
exercising the unmatched path — real settlement tests must go through the funnel
(step 3) so the intent belongs to a Zeno payment.

## 5. Inspect the evidence afterward

```bash
docker exec -it zeno-db-1 psql -U zeno -d zeno
```

```sql
-- every provider event that reached the inbox (dedup key: provider+providerEventId)
SELECT "provider", "providerEventId", "kind", "providerPaymentId", "receivedAt"
FROM "PaymentEvent" ORDER BY "receivedAt" DESC LIMIT 10;

-- payment attempts and their settlement state
SELECT "id", "status", "amountMinor", "providerPaymentId", "failureReason", "paidAt"
FROM "Payment" ORDER BY "createdAt" DESC LIMIT 10;

-- anomaly flags (bad_signature / unmatched_payment / amount_mismatch)
SELECT "kind", "status", "reason", "payload"->>'anomalyKey' AS anomaly_key
FROM "WorkItem" WHERE "kind" = 'ALERT_FLAG' ORDER BY "createdAt" DESC LIMIT 10;
```

Or through the app: the operator work-items dashboard lists the ALERT_FLAGs, and
`scripts/verify-payment-ops.ts` / `scripts/verify-payment-recovery.ts` exercise the
same settlement machinery against the MOCK provider end-to-end.
