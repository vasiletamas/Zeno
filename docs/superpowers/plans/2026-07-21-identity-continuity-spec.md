# Identity continuity — specification & acceptance criteria

**Date:** 2026-07-21 · **Status:** specified, implementation in progress
**Origin:** live test session 2026-07-21, conv `cmruelpy70000j80yn0bvj6qa` turn 2 (the two-live-cards
screenshot) — which opened into a security review of session continuity.

> **Acceptance criteria are §4.** They are written as user journeys by the product owner and are the
> definition of done for this work. A task is not complete because its unit tests pass; it is
> complete when the journey in §4 behaves as written, verified in a browser.

---

## 1. Why this exists

Two defects, discovered in one session, that turn out to be the same defect wearing two hats.

### 1.1 The visible one

Turn 2 of `cmruelpy7` put an OTP card and a medical question card on screen simultaneously. The
customer was asked for a 6-digit code and a health declaration at the same time, with nothing
indicating which one the conversation was waiting on.

The tool trace:

```
set_application              → no card
select_coverage {tier}       → no card
start_channel_verification   → OTP card          ← card 1
select_coverage {level}      → question card     ← card 2
select_coverage {addon}      → question card     ← card 3 (same question re-emitted)
```

Three contributing causes, in ascending order of importance:

1. `select_coverage` enforces `one_facet_per_commit`
   (`lib/tools/handlers/select-coverage-handlers.ts:33`), so expressing "standard, level I, with the
   addon" *requires* three calls. The agent did nothing wrong.
2. The questionnaire entry-card condition at
   `lib/tools/handlers/select-coverage-handlers.ts:91` is a **level check**
   (`post.tierId && post.levelId && post.status === 'OPEN'`) while its own comment describes an
   **edge** ("the commit that *leaves* the selection COMPLETE"). Every call after the completing one
   re-emits. Combined with (1), this fires deterministically whenever a customer states a full
   configuration up front.
3. **Nothing in the domain model orders verification against the questionnaire.** They are not
   sequenced because, by the engine's own rules, they do not need to be.

Cause 3 is the real one. `2026-07-21` shipped `queueAllButOneInput`
(`lib/chat/derive-active-cards.ts:104`) which resolves the *symptom* by ranking input cards through a
hardcoded `INPUT_CARD_PRIORITY` (`lib/chat/card-view.ts:28`). That list is a presentation convention
patching an ordering the domain model never expressed.

### 1.2 The invisible one

`derivePhase` (`lib/engines/derive-and-expose.ts:93`) is the entire funnel, derived from data rather
than scripted:

```js
POLICY → PAYMENT → QUOTE → APPLICATION{DNT, QUESTIONNAIRE, QUOTE_GENERATION} → DISCOVERY
```

Authentication appears nowhere in it. It is a side-condition checked once, late, at `accept_quote`
(`lib/engines/identity-requirements.ts:32`).

Meanwhile the most sensitive data in the product — the DNT and the medical declarations — carries no
identity requirement at all:

| Commit | Requirement today |
|---|---|
| `sign_dnt` | `minTier: 'anonymous'` (explicit) |
| `open_dnt_session` | no row → allowed |
| `write_dnt_answer` | no row → allowed |
| `write_question_answer` | no row → allowed |
| `write_medical_batch` | no row → allowed |
| `accept_quote` | `verified_channel` ← first real gate |

A missing row means allowed (`checkIdentityRequirement`, `identity-requirements.ts:107`).

### 1.3 Why that is a data-protection problem, not just a modelling one

The session reauth gate (`app/api/session/route.ts:21`) fires only when the customer has **both** a
linked `User` **and** a consumed email challenge. The `User` is born at OTP confirmation
(`lib/tools/handlers/identity-handlers.ts:144` — "the proven channel is the account-birth moment").

Because verification is not required until `accept_quote`, a customer can complete the DNT and every
medical declaration without ever verifying. No verification ⇒ no account ⇒ **the reauth gate does not
fire** ⇒ the next person to open that browser resumes into the conversation.

**The window in which sensitive data exists is exactly the window the gate does not cover.**

### 1.4 And the gate is not on the door that matters

`app/chat/[id]/page.tsx:28` loads a conversation by id and renders up to 50 messages with:

- no ownership check — `conversation.customerId` is never compared to the cookie;
- no reauth gate — that lives only on `POST /api/session`, the `/chat` entry flow;
- an identity fallback at line 63, `customerId={customerId ?? conversation.customerId}`, which adopts
  the conversation's customer when no cookie is present.

The conversation URL is in browser history. The session flow is never invoked. `app/api/chat/route.ts`
has the same shape, taking `conversationId` and `customerId` from the request body unchecked.

**Scoping the risk honestly:** conversation ids are cuids, so this is not enumerable and not a mass
harvesting vector. It is fully live for the shared-device threat model, which is the one that matters
for a consumer insurance product.

**Note on the shared-browser case specifically:** an ownership check alone does *not* address it. The
second person carries the *same cookie*, so `conversation.customerId === cookie` passes. Only a
reauth challenge distinguishes them. Ownership and reauth are two separate controls covering two
separate threats.

---

## 2. Rulings

Decided by the product owner on 2026-07-21, recorded so they are not re-litigated:

- **R1.** A first-time anonymous visitor in DISCOVERY is not asked to authenticate. Browsing products
  carries no sensitive data.
- **R2.** Authentication is demanded at **application start** — not at quote acceptance. The
  application boundary is where sensitive collection begins, so it is where identity begins.
- **R3.** A returning visitor whose browser carries an account cookie must pass a fresh challenge
  **before any conversation data is loaded or rendered**. Not a curtain over data already sent to the
  client — the block happens before the read.
- **R4.** Card ordering must not be hardcoded. Any ordering the customer experiences must fall out of
  derived state.

R2 reverses a documented earlier decision (`identity-requirements.ts:29`, "no hard gate
pre-needs-analysis (#1)"). The reversal is deliberate: that decision optimised for funnel
friction and predates the DNT collecting medical data this early.

---

## 3. Design

### 3.1 Fix A — conversation access control

Two independent controls:

- **A-own — ownership.** Serving a conversation requires the `zeno_session` cookie to resolve
  (through `customer.mergedIntoId`, as `app/api/session/route.ts:64` already does) to the
  conversation's customer. Covers URLs that escape the browser: shared links, referrer leaks, logs.
- **A-proof — freshness.** If the resolved customer has an account, serving the conversation
  additionally requires a **session proof**: a signed, short-lived, HttpOnly `zeno_proof` cookie
  naming that customer. Covers the shared-device threat, where the cookie itself is not evidence.

A proof is *earned*, never asserted by the client. It is issued only after a challenge for that
customer is consumed — by `POST /api/session/reauth/confirm`, or by
`POST /api/session/proof`, which mints one only when the server can see a challenge consumed for that
customer inside a short window. The client cannot forge a consumed challenge.

> **Why a proof cookie at all:** `reauthGate` is stateless — it asks "does this customer have an
> account and a consumed challenge?", which stays true forever once true. Nothing today records that
> *this browser* has proven itself; `app/chat/page.tsx:95` sidesteps the loop by calling
> `openConversation` directly after `onAuthenticated` rather than re-entering the gate. A per-browser
> proof is what makes the gate re-entrant, and per-browser is required: a per-customer flag would be
> inherited by the second person on the shared device, which is precisely the threat.

### 3.2 Fix B — verification at application start

Add `minTier: 'verified_channel'` rows to `IDENTITY_REQUIREMENTS` for `open_dnt_session`,
`write_dnt_answer`, `sign_dnt`, `write_question_answer` and `write_medical_batch`. `set_application`
stays `anonymous` — it creates the application, and the email card becomes due precisely because an
application now exists (`derive-active-cards.ts:33`).

Consequences, all intended:

- The engine — not the prompt, not the card layer — blocks the questionnaire until the channel is
  proven, answering `requires_identity` with a machine-readable `needs` payload the agent already
  knows how to act on.
- Any emitter that would produce a card for a now-blocked tool must be gated, or the customer is
  shown a card they cannot legally act on. `select-coverage-handlers.ts:90` is the primary one.
- **`INPUT_CARD_PRIORITY` becomes unnecessary for the OTP-versus-question case** — the question card
  cannot exist during verification, so there is no ordering left to enforce. This satisfies R4 by
  deletion rather than by replacement.

The entry-card condition is corrected from a level check to an edge at the same time: emit only on
the commit that *transitions* the selection into completeness.

---

## 4. Acceptance criteria

**These are the definition of done.** Each is a browser-verified journey, not a unit test.

### AC-1 — Maria: first-time visitor, anonymous through discovery

| # | Maria does | She must see | Why |
|---|---|---|---|
| 1 | Lands with no cookie, browses Protect, compares levels | Normal conversation. **No authentication asked.** | R1 — nothing sensitive yet |
| 2 | *"vreau să fac cererea"* | Agent starts the application | `set_application` stays anonymous |
| 3 | — | Card: **"Care este adresa ta de email?"** | Verification is now due (R2) |
| 4 | Enters her email | Card: **enter the 6-digit code — and ONLY this card** | The question card cannot exist: `open_dnt_session` is `requires_identity`-blocked |
| 5 | Enters the code | Confirmation; account is created | Account birth ⇒ the reauth gate now covers her |
| 6 | — | **Now** the first DNT question appears | `open_dnt_session` just became legal |
| 7 | Answers through DNT → questionnaire | Addon questions asked **at the end** | Unchanged behaviour |
| 8 | — | Quote | Unchanged behaviour |

**AC-1 fails if:** at step 4 any card other than the OTP card is interactive *or* rendered as queued —
under this design the question card must not be emitted at all.

### AC-2 — Ion: verified customer returning the next day

| # | Ion does | He must see |
|---|---|---|
| 1 | Opens the browser, clicks his chat link from history | — |
| 2 | — | **No transcript. No cards. No data.** Only: *"Pentru siguranță, am trimis un cod la i\*\*\*@gmail.com"* |
| 3 | Enters the code | — |
| 4 | — | His conversation in full: history, cards, exactly where he left off |

**AC-2 fails if:** any part of the conversation — a message, a summary, a card, a page title derived
from content — reaches the browser before step 3 completes. Per R3 the block precedes the read; it is
not a client-side curtain.

### AC-3 — The roommate: shared device, same cookie

| # | The roommate does | They must see |
|---|---|---|
| 1 | Opens history, clicks Ion's chat link — carrying **Ion's cookie** | — |
| 2 | — | The same challenge: *"am trimis un cod la i\*\*\*@gmail.com"* |
| 3 | Cannot reach Ion's inbox | **Dead end.** Ion's medical answers, email, quote — never rendered |
| 4 | Clicks *"Conversație nouă"* | A fresh anonymous session and their own empty conversation |

**AC-3 is the reason this work exists.** Note it is unreachable by ownership checking alone — the
roommate's cookie *is* Ion's cookie and passes any ownership test.

### AC-4 — Maria's roommate: the accepted residual

| # | They do | They see | Verdict |
|---|---|---|---|
| 1 | Maria only browsed products, never applied | Roommate resumes a product-browsing chat | **Accepted** (R1) — no account exists, so no gate; nothing sensitive is behind it |

Recorded so it is not later reported as a regression. The boundary is deliberate: application start
is both where authentication begins and where sensitive collection begins.

### AC-5 — Regression: the originating defect

Replaying `cmruelpy7`'s script — *"buna, vreau asigurarea Protect standard nivel I cu tratament in
strainatate, hai sa facem cererea"* then *"da, hai sa incepem. emailul meu este …"* — must produce
**exactly one interactive card at every turn**, and the tool trace must show no duplicate
`show_question` emission across the three `select_coverage` calls.

### AC-6 — No lockout after a merge

A customer who verifies an email already belonging to another customer record is merged
(`claim.merged`, `identity-handlers.ts:152`). After the merge they must still reach their own
conversation: access resolution follows `customer.mergedIntoId` exactly as
`app/api/session/route.ts:64` does. A naive ownership check locks them out of their own data.

---

## 5. Out of scope

- Opaque session transport (`zeno_session` currently carries the raw customer id;
  `app/api/session/route.ts:62` records this as a known handoff). The proof cookie is signed, but the
  session cookie remains an id.
- Bringing identity into `derivePhase` as a first-class funnel dimension. Fix B delivers the
  behaviour through the legality table; making authentication a *phase* is the larger structural
  change and is deferred.
- The pre-existing `quote-decline` sim harness gap (documented in
  `2026-07-20-card-state-ssot-report.md` §"quote-decline sim failure").
