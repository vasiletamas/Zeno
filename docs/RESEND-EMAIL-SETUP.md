# Resend Email Setup — Verification Codes & Magic Links

Zeno sends its email verification codes and magic links through a pluggable
email provider (`lib/email`). Two providers ship today:

| `EMAIL_PROVIDER` | Behaviour |
| --- | --- |
| `mock` (default) | Sends nothing. Prints the code + link to the server log and records them on a dev-only seam (`/api/dev/last-verification-email`). Use for local dev and tests. |
| `resend` | Sends real email via [Resend](https://resend.com). |

Turning Resend on is entirely env-var driven — no code change. This guide
covers the interim setup on a **personal domain** and the later switch to the
**Zeno domain**.

---

## What the flow sends

`issueChallenge()` (`lib/customer/verification-service.ts`) mints a 6-digit
code and a magic-link token, then sends **one** email that carries both:

- the code, for in-chat entry, and
- a `…/api/auth/verify?token=…` link, for one-click confirmation.

Both legs consume the same challenge row, so the two verification paths can
never diverge. Locale (`ro`/`en`) follows the customer's language.

---

## 1. Add and verify your domain in Resend

Resend only lets you send **from a domain you have verified**. This is the
single most common cause of a rejected send.

1. In the Resend dashboard → **Domains** → **Add Domain**, enter your
   (personal, for now) domain.
2. Resend shows DNS records (SPF, DKIM, and usually a return-path/MX record).
   Add them at your DNS provider.
3. Wait for the domain to flip to **Verified** (minutes to a couple of hours).

> You can send test email to your own account address before verifying a
> domain by using Resend's `onboarding@resend.dev` sender, but real sends to
> arbitrary recipients require a verified domain.

## 2. Create an API key

Resend dashboard → **API Keys** → **Create API Key** (sending permission is
enough). Copy the `re_…` value — it is shown only once.

## 3. Set the environment variables

```bash
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_your_key_here
# MUST be on the domain you verified above:
EMAIL_FROM=Zeno <auth@your-verified-domain.com>
```

Also make sure `APP_URL` points at the origin that should appear in magic
links (dev defaults to `http://localhost:3001`; in production set your public
URL), since the link base is minted from it.

> **No silent fallback.** If `EMAIL_PROVIDER=resend` and `EMAIL_FROM` is unset,
> the provider throws a clear error instead of guessing a sender — an
> unverified guess would fail at Resend with a confusing message. Likewise a
> missing `RESEND_API_KEY` throws at startup.

## 4. Test it locally

1. Set the three vars above in `.env`.
2. Start the app and trigger a verification (e.g. begin the identity/OTP flow,
   or `POST /api/session/reauth/start` for a logged-in session).
3. The code should arrive at the recipient inbox. On the Resend dashboard →
   **Emails**, you can see each send, its status, and any delivery error.

If a send fails, the error is surfaced as
`Resend failed to send to <recipient>: <reason>` — most often
`The domain is not verified` (step 1) or a `from` address that isn't on the
verified domain.

---

## Switching from the personal domain to the Zeno domain

When Zeno goes public and you create a Resend account/domain for it, the
switch is two lines — no code change:

```bash
RESEND_API_KEY=re_zeno_account_key
EMAIL_FROM=Zeno <auth@use-zeno.com>
```

Verify the Zeno domain (step 1) under that account first, then swap the two
values and redeploy.

---

## Reference

- Provider abstraction: `lib/email/types.ts`, `lib/email/index.ts`
- Resend provider: `lib/email/providers/resend.ts`
- Mock provider (dev/log): `lib/email/providers/mock.ts`
- Challenge + send: `lib/customer/verification-service.ts`
- Magic-link confirm: `app/api/auth/verify/route.ts`
- Dev seam (read last code locally): `app/api/dev/last-verification-email/route.ts`
