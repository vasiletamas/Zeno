# Card-State SSOT — implementation report

**Date:** 2026-07-21 · **Branch:** local `main` (24 commits, **not pushed**) · **Plan:** `2026-07-20-card-state-ssot.md` · **Spec:** `2026-07-20-card-state-ssot-design.md`
**Origin:** live test session 2026-07-19, conv `cmrrhruba0001g40yh3am7peo` — "the phone card still stays on even if I have already inputed… we need a way for the agent to be aware of the display cards".

## Outcome

Interactive chat cards are no longer fire-and-forget SSE events held in browser memory. The server derives, every turn, the set of inputs the customer is actually being asked for — each with a semantic key and a status — and the client, the prompt, and the offline diagnostics all read that one set. The four defects behind the incident are closed at their root, and the agent can finally see, name, and release a stale card.

**Live proof (browser, 2026-07-21).** Replaying the incident script on a fresh conversation (`cmruaerwt0000qk0ya3zmxf6v`): "am 40 de ani" → the agent records the age and continues the conversation, with **no email card and no phone card** — the exact turn that produced the unsolicited email card. Deterministic checker: **zero card findings**, against six on the original incident. On the original conversation itself: the zombie phone card no longer renders, and the expired OTP card comes back on a cold reload showing "Codul a expirat" with **the resend button enabled** — previously that was a hard dead end.

## What landed, task by task

| # | Task | Commits |
|---|---|---|
| 1-3 | `stale_card_replayed`, `card_for_committed_fact`, `competing_input_cards` checks | 7f1056d0, f8b325b3, 924ac79e |
| 4 | gui-actor exemption in `questionnaire_answer_fabricated` | 41a8b1de, 00c2391d, 39eb710b |
| — | shared `turnLedgerWindow` helper (review) | 94d1a71c |
| 5 | replayed envelopes strip presentation | 79825621, b115d61e |
| 6 | ladder gate + due-timing + OTP-owns-turn | 0c34f72c |
| 7 | `ProfileFieldDeferral` + `defer_customer_field` (+ GDPR erasure, FK) | b944fa1f, 6ac38741 |
| 8 | `deriveActiveCards` — the SSOT | 5006ee3b, 9860ee70 |
| 9 | `cards_state` turn-end SSE event | 2fb0136d |
| 10-12 | reload parity, pure `card-view` reducer, truthful rendering | d101ae04, 20af7522, 7f64fe6b |
| 13-14 | ON-SCREEN CARDS briefing + T11 amendment | 1c476ed2, 8f92eef1, a9fecf9c |
| 15 | `scripts/verify-card-state.ts` | 9b2b5a00 |
| 16 | gate + OTP conversation scoping | 19211e0d |

## Verification

- **Full suite: 1893 tests green** (352 files). The single failure the gate caught was a seed test still pinning the pre-amendment clause-7 wording; it now pins the amended semantics (both licences, the EXPIRED duty, the DECLINED prohibition, the unchanged floor).
- `tsc --noEmit` clean · migration chain verified (fresh + upgrade, no drift).
- `scripts/verify-card-state.ts`: **12/12 ok**, re-run after every subsequent change. Its author ran a non-vacuity probe — staging pre-fix shapes makes all four new checks fire — so the green is a real negative, not an empty set.
- Browser: fresh conversation + the incident conversation, zero server errors, zero console errors.

## Defects found by review and verification (not by the plan)

The plan was right about the architecture and wrong in several details. What the gates caught:

1. **A T11 regression inside the T11 amendment** (quality review). Deferred fields render no card, yet the briefing listed them under "ON-SCREEN CARDS" and the constitution told the model to resolve or dismiss them — instructing prose about a card that does not exist, the exact fabrication T11 exists to prevent. Deferred entries now brief under `DECLINED (no card on screen)`, and the clause forbids card talk for them.
2. **Expired OTP cards leaked across conversations** (browser pass). A brand-new conversation opened with a context-free "Codul a expirat" before the customer had said a word. Expired cards are now scoped to the conversation that raised them; live challenges keep customer scope.
3. **Ledger-to-turn correlation was unusable as specified** (implementer, verified against the live DB). `TurnDebug` stamps `startedAt === endedAt` at reduction time, *after* the turn's own ledger writes — so the plan's `[startedAt, endedAt]` window excluded the very rows it was meant to catch. The floor is the preceding turn's `endedAt`; the invariant now has one documented home (`turnLedgerWindow`).
4. **Deferral rows survived GDPR erasure** (quality review) — free-text refusal reasons, customer-scoped, no FK. Now erased with the customer profile, with the relation added.
5. **The client's action-type map in the plan was guesswork** (implementer). Real types differ (`medical_batch`, not `submit_medical_batch`; the question code rides `payload.questionCode`); a keyless submit now maps to no card instead of colliding with the batch key.
6. **A second fake-✓ vector outside the plan's file list** (spec review): question cards rendered ✓ with an empty value after any reload. Fixed the same way as the data-field cards.

## Deliberate scope limits (for the Spec-2 discussion)

- The derived set covers input cards only (`data_field`, `otp`, `question`, `confirm`). Presentation cards (quote, acceptance, payment, review, upload) still use the legacy newest-wins rendering, and with `markAnswered` retired a presentation card stays clickable until a newer card lands — absorbed by gateway idempotency and confirm round-trips.
- `resolved` and `superseded` materialize as **absence** from the set, not as explicit statuses.
- The phone card requires email present, so a deferred/absent email suppresses it even with an issued quote.
- Two `deriveActiveCards` calls per turn (turn start for the briefing, turn end for the client) — different instants by design, but each loads a domain snapshot the caller often already holds. A `deriveActiveCards(conversationId, snapshot?)` injection is the obvious follow-up.
- `FIELD_META_FOR_CARDS` shares nested object references with `FIELD_META`; a deep freeze is warranted next time `data-handlers.ts` is touched.

## Environment notes

- A dev server started **before** a migration holds a stale in-memory Prisma client — `deriveActiveCards` threw on the new deferral table at SSR while tests and `tsc` were green (vitest spawns fresh processes). Restart the dev server after every migration.
- Integration suites must run **one at a time**; two concurrent rings wedge the shared postgres.
- `.env` `EMAIL_PROVIDER` was restored to `mock` (it was `resend`, which breaks the ESM test runner). Uncommitted — flip it back if that was deliberate.
- The reseeded constitution is cached for 5 minutes by a running dev server; restart to pick it up.

## Not done

Nothing is pushed. Spec 2 (identity-continuity: verify-before-reveal, confirm-stored-data, resume-and-close) remains designed-but-unbuilt, and the open items from the 2026-07-18 run (post-merge funnel shadowing, stale challenges post-merge, the "already-done" fabrication class, `/api/chat` auth) are untouched.
