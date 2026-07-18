# Implementation report — live-test hardening (T1–T30)

**Run:** fully autonomous, 2026-07-16 → 2026-07-18, from `docs/plans/2026-07-15-live-test-findings-and-tasks.md`.
**Result: all 30 tasks implemented and committed.** 33 commits on local main (`c1fd5609..eaa3b86b`), **not pushed**. Suite grew **1493 → 1830 tests** (295 → 346 files), green + `tsc --noEmit` clean at every commit. Environment left reseeded, gpt-5.6-sol active, smoke conversation verified.

## Per-task status

| Task | Commit | Notes |
|---|---|---|
| T1 | `c1fd5609` | Pre-existing (end of test session) |
| T2 | `5d1930f2` | **FLAG:** gpt-5.6-sol pricing is a PLACEHOLDER (gpt-5.4's rates); also added the missing claude-sonnet-5 catalog row (fallback was uncostable) |
| T3 | `3004a75f` | gpt-5.6-sol reseed-safe |
| T4 | `21a2c4a2` | **Reframed:** Enter-to-send already worked in source; the live symptom was the overlapping-turn SSE race (shared streamingMessageIdRef + stale isStreaming guard). Fixed via unified `consumeSSE` + per-invocation ids + synchronous in-flight guard; aborted turns can no longer leave a stuck cursor |
| T5 | `24574905` | No reference greeting to parrot; browser-verified: three distinct greetings across three conversations |
| T6 | `3b460d2b` | occupation/familySize/minorChildren/education/incomeSource → CustomerProfileField (declared/dnt) + insights (occupation, familySize with '5+'→'5', hasChildren) at signature |
| T7 | `9015af6a` | `show_dnt_review` card + **gateway ruling: gui-actor commits are confirmed by construction** (agent-path confirmToken two-step byte-identical) |
| T8 | `b331f020` (design) + `799edff8` (impl) | PurchaseIntent model+tool+ledger, briefing momentum lines, renewal script, `_autoChain` single hop. Migration `20260717094200_live_test_hardening` (PurchaseIntent + Quote.ratingInputs) |
| T9/T12 | `06ecb6ef` (design) + `0b029be9` | Shared `questionnaire-cards.ts`; entry card rides the completing select_coverage; conduct line on every save; reject re-emits the same card; `/chat/[id]` re-derives the pending card server-side. Also fixed a latent `resume_application` tx-visibility bug |
| T10 | `f1305fb6` | `write_medical_batch` one-commit sequential consequence plans, parity-tested vs the sequential path; `show_medical_batch` card |
| T11 | `41f0fcc2` | Completion emits `show_medical_review`; constitution card-reference rule; `hallucinated_ui_reference` check |
| T13 | `643c2a05` | **GUI action turns run the standard tool loop** (root cause: the synthetic path narrated with NO tools — chaining was structurally impossible); pre-round-0 state refresh; supersession clause; `stale_gate_claim` check |
| T14 | `86686003` | `Quote.ratingInputs` frozen at issuance: ageUsed+source, band, components, tier/level/addon, medicalAnswersHash, dntId, fx, engineVersion |
| T15 | `06dbd886` | Units/caps/franchise on coverage rows ("20 RON/zi (max 90 zile/an, franșiză 3 zile)"); prose-sells conduct line |
| T16 | `745c50f8` | Outbound guard buffers the final round; false "can't" about an available action → one-shot self-repair; shared lexicon with the offline check |
| T17 | `cf0fc9ad` | Addon rules reseeded EUR (values unchanged). **FLAGS:** (a) verify 200/350/500/700 EUR against the actual Allianz tariff sheet; (b) authored "streaming-subscription" positioning breaks at ~163 lei/lună (content untouched — business decision) |
| T18 | `c10dec2d` | Currency guard (mixed-currency throws absent FX); pluggable `FxProvider` — `FixedFxProvider` (env `FX_EUR_RON`, default 5.06, test-deterministic default) + `BnrFxProvider` (daily XML, `FX_PROVIDER=bnr`); rate+date+source frozen into ratingInputs.fx |
| T19 | `5cc1e331` | Email collect declares a guarded `_autoChain` → code sent + OTP card in the SAME turn, both actors |
| T20 | `8003a19e` | `availableVerificationChannels()` drives schema+manifest (email-only); constitution ban scoped to free-form messaging; try-the-tool conduct rule |
| T21 | `e42b80db` | Documents GET honors zeno_session for owned+static docs; `/api/session` returns `activeConversationId`; /chat resumes by default (`?new=1` opts out, header link added); stray `/chat/<id>` redirects |
| T22 | `859fb936` | `⟦action⟧`-prefixed localized summaries persisted at the route; chips on reload (browser-verified: zero raw `[Action:*]`); PII masked in labels |
| T23 | `62e77a6e` (+`61bc9187` type fix) | `get_acceptance_bundle` read + `show_acceptance` card: doc links (new-tab), affirmative ack checkbox (commits + re-emits acked), equal-total frequency comparison, gated Accept; QuoteCard accept → `open_acceptance` |
| T24 | `eaa3b86b` | `docs/payments/stripe-test-mode-recipe.md` + `scripts/verify-payment-recovery.ts` (fail→retry→success→replay→COMPLETED+Policy, 6/6 PASS) |
| T25 | `52f3fd91` | Library page (both document families, grouped); uploads gained a decrypting read route (owner-only, either principal) |
| T26 | `18027408` | User born at email verification (canonical customer on merges), isAnonymous flipped; `/api/session` reauth gate + `/api/session/reauth/{start,confirm}`; chat-entry OTP prompt |
| T27 | `2a397ae9` | Guarded `_autoChain` on OTP confirm → upload card same turn; browser test showed the guard **correctly suppressing** when the merged canonical already had a validated ID |
| T28 | `0cb12fc7` | DNT_CNP removed (questionnaire 10→9); declaredAge rates the quote; tier ladder = contact-based; band-mismatch reconciliation at extraction. **Design consequence caught by the suite:** residency was silently inferred from the CNP (snapshot-loader cnp→Romania) — now asked in plain conversation pre-quote |
| T29 | `c8ee066e` | ui-action-registry (single source for emitted/rendered/posted); upload+OTP cards; visible unknown-type fallback; two-directional parity test; `unrendered_ui_action` check |
| T30 | `ee9d8582` | Mock path settles via provider-verified `/api/payments/confirm`; `payment_complete` → `get_payment_status`; Stripe GET return accepts `paymentId` (3DS returns fixed); unknown-action 400 no longer leaks concurrency slots (was: 3 bad posts → permanent 429); `funnel_ends_at_payment_card` check |
| Phase-2 sim gate | `b97a5b18` | `drain()` clicks the whole new card family |

## Verification evidence

- **Suite:** 1830 tests / 346 files green at HEAD; known flake (`instrumentation.test.ts`) handled per policy (occurred twice, green in isolation both times).
- **Live-model spec sims (gpt-5.6-sol, n-of-m 3 trials pass≥2):** happy-path **3/3 → Policy PENDING_SUBMISSION** at four separate gates (post-Phase-2, post-T13, post-T16, post-T28); dnt-card-flow 3/3; verification-typed-code 3/3. Post-T13 exports show `sign_medical_declarations` + `generate_quote` in the SAME turn — the msg-58 defect class is dead.
- **Verify scripts (dev DB):** dnt-flow 6/6, application-flow 8/8, quote-lifecycle 4/4, identity-flow all-PASS, payment-ops 7/7, payment-recovery 6/6. (Four of these were broken at baseline for pre-existing reasons — fixed minimally, documented in commits.)
- **Diagnostics ratchets vs the recorded conversation `cmrm3fgku00056g0y4eb2hsme`** (run pre-reset, output in `backups/diagnose-cmrm3fgku-post-ratchets.json`): `hallucinated_ui_reference` fires at turn **54** (the T11 incident; bonus catch at 14), `stale_gate_claim` at turn **58** (T13), `funnel_ends_at_payment_card` at turn **92** (T30). `unrendered_ui_action` can no longer fire on turns 88/90 by design — the types are rendered now; its historical proof is the parity test having been red pre-fix. (T30's payment_complete 400 left no DB trace at all — the route 400'd before persistence — hence the funnel-ends proxy.)
- **Manual browser pass (zeno-dev :3001, full funnel in the real DOM):** fresh varied greeting → intent captured with zero readiness re-asks → 9 DNT cards (one-line prose each) → auto review card → checkbox-gated one-click sign → chained application + entry card → medical batch card ("Niciuna…" one click) → auto medical review card → one-click sign → **same-turn residency ask** → quote card **1961 RON/an / 163.42 lei/lună** (= 190 + 350 EUR × 5.06) with per-day units, caps, franchise → acceptance card (IPID link **200 application/pdf under the chat cookie** — the live test's 401 is dead; ack re-emit; equal-total frequencies) → email submit → **same-turn OTP card** → verify → **real claim-and-merge into the July-15 customer** (User on canonical, shell tombstoned, upload correctly suppressed by the existing validated ID) → chips-not-[Action:*] on reload. Screenshot capture was unavailable (browser-pane renderer issue) — verification ran through the accessibility tree + DB rows, which is the stronger evidence anyway.

## Environment (as left)

- Dev DB `zeno-db-1:5435` reset to `baseline_main + v3_upgrade + live_test_hardening` + full seed; `migrate status` clean; **zero conversations except the smoke** (1 conversation / 2 messages / 1 TurnDebug, first turn verified in the browser).
- main-chat = **gpt-5.6-sol** (seed-durable now); addon rules EUR; DNT_CNP absent.
- Pre-reset dump: `backups/zeno-post-live-test-hardening-2026-07-17.dump` (19.9MB — contains the evidence conversation + the browser-pass conversation). `backups/` stays gitignored.
- Test DB `zeno_test` on the same chain; **`TEST_DATABASE_URL` added to `.env`** (it was missing — the suite was silently unable to run DB tests on this machine; first thing fixed).
- Dev server: `preview` session may still hold zeno-dev on :3001; safe to stop/restart.

## Flagged decisions (autonomous rulings applied or made)

1. **T2/T17 placeholders** (per your rulings): model pricing + the EUR tariff values need real numbers.
2. **Gui-confirmed gateway ruling (T7)**: `actor==='gui'` commits are confirmed by construction — the click on a card that rendered the args IS the confirmation. Agent-path confirmToken two-step untouched. This is the single-confirmation principle made structural; note `/api/chat` still trusts body-supplied ids (pre-existing; see findings #5).
3. **Ordering deviation**: T19 moved after T13/T8-impl (it consumes `_autoChain` + the tool-loop); T8-impl slotted after T16. Both dependency-driven.
4. **T30 ratchet reframe**: "payment_complete 400" is structurally unrecordable; the check keys on the funnel ending at an emitted payment card.
5. **T27/T26 wiring share one handler edit** — the account-birth and upload-chain wiring live in the same success block; T26's commit carries the file, T27's carries its tests.
6. **T28 residency consequence**: removing the CNP removed the implicit residency fact; ruled that residency is asked conversationally pre-quote (collect_customer_field already normalized 'România').
7. **T16 latency tradeoff**: the final narration round buffers until the guard passes — the reply arrives as a burst. Accepted deliberately; revisit if UX complains.

## NEW findings for the next test session

1. **Post-merge funnel shadowing (architecture, high):** after claim-and-merge into a customer with a prior purchase, the derived state reports phase POLICY and blocks accept_quote with `quote_already_accepted` — the OLD accepted quote/Policy shadow the NEW conversation's ISSUED quote. The model then faithfully echoes the misleading state ("Oferta este deja acceptată"). Needs a ruling: scope the quote/policy slices to the active application when one exists, and decide the business rule for repeat purchase of the same product.
2. **Stale challenges pollute post-merge state (medium):** the July-15 settlement's 7-day magic-link challenge surfaced as `pendingChallenge` after the merge, producing wrong "email still awaiting verification" prompts (the model even re-ran confirm against it). Consider consuming/expiring outstanding challenges at merge, and excluding post-purchase link challenges from the pending gate.
3. **"Already-done" fabrication class (medium):** the outbound guard covers false "can't" claims; false "already done" claims (e.g. "fusese deja acceptată" with zero accept_quote calls — though see finding #1 for the state that fed it) evade both the guard and `state_claim_without_commit`'s verb list. Extend the lexicon with a perfect-tense/deja class + a matching offline check.
4. **Answered-card dead end (low/UX):** a card click that gets executor-walled (e.g. Accept before identity) marks the card answered client-side; when the block later clears there is no re-emitted card and the button is inert. Consider re-emitting the acceptance card once the gate opens (post-verification), or not marking cards answered on rejected posts.
5. **`/api/chat` auth posture (pre-existing, now more load-bearing):** the route trusts body-supplied conversation/customer ids with no cookie check; with gui-confirmed commits this is the next hardening candidate.
6. **Browser-pane screenshot capture** timed out throughout (renderer issue in this session's pane) — cosmetic for this run, but screenshot-proof workflows should not assume it.

## Suggested next-session focus

Re-run the exact July-15 live script on this build (clean slate — should now be dramatically shorter: every act is one card interaction), then a second session that deliberately exercises the merge path (verify the same email twice) against findings #1/#2.
