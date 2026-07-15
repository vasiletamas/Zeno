# Live-test hardening — Implementation Plan (29 tasks)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 29 remaining tasks from `docs/plans/2026-07-15-live-test-findings-and-tasks.md` (T1 done at c1fd5609): the card/parity family, reasoning correctness, quote-engine integrity, identity/onboarding redesign, and infra — TDD per task, one commit per task, full suite green per commit, runtime-verified per phase.

**Architecture:** Governed by the five laws in the inventory doc (UI for acts / single confirmation / schema is capability truth / fresh evidence supersedes / parity is testable). Two design docs (T12 questionnaire standard, T8 intent+momentum) are written first and govern the card and momentum families. A shared `questionnaire-cards` module makes the standard hold by construction; a `ui-action-registry` makes parity testable; the GUI synthetic-tool path gains the standard tool loop so momentum and supersession hold on action turns.

**Tech stack:** Next.js 15 / React 19, Prisma 7 (postgres 5435, test DB `zeno_test` via `TEST_DATABASE_URL`), vitest (unit + serialized integration ring), tsx scripts for sims.

**Verification norms (every task):**
- Failing test FIRST (`npx vitest run <file>` red), implement, green, then FULL suite `npx vitest run` (known flake: `__tests__/lib/events/instrumentation.test.ts` — PASS if sole failure).
- One commit per task, message given per task below.
- Diagnostics ratchets (T11, T13, T16, T29, T30): check added test-first in `lib/diagnostics/`; before the final DB reset, run `npx tsx scripts/diagnose-conversation.ts cmrm3fgku00056g0y4eb2hsme --json` and record that each new check flags its historical instance (turn indices below).

**Recon corrections that OVERRIDE the inventory doc's assumptions (verified from source @ c1fd5609):**
1. NOTHING from the deleted `zeno-v3-opus` branch exists on main: no `get_dnt_answers`, no `pendingSignature`, no review card, no validation-reject re-ask threading (`data._uiAction` on rejections), no reload card re-derive, no streaming-race fix, no `hallucinated_ui_reference`/`stale_gate_claim`/`confirmation_deadlock`/`answer_write_rejected` checks. All greenfield here.
2. `set_application` binds PRODUCT only (tier/level/addon = `select_coverage`, single writer).
3. Enter-to-send already works in `components/chat/chat-input.tsx:22-30`. T4's observed failure = input `disabled={isStreaming}` + the streaming race (shared `streamingMessageIdRef` + stale `isStreaming` guard in `lib/hooks/use-chat.ts`, two near-duplicate SSE loops).
4. The T13 refusal happened on the **synthetic GUI path** (`orchestrator.ts:885-1012`) where the narration call has **no tools** and no round-refresh — the model could not have called generate_quote. Fix = give action turns the standard tool loop.
5. `payment_complete` 400 left NO DB trace (route 400s before persistence). T30's diagnostics ratchet keys on "conversation ends at an emitted show_payment with no later settlement narration" instead.
6. TurnDebug persists `toolCalls[].result.uiAction` (both paths) — "uiAction emitted this turn" IS offline-checkable. The orchestrator-synthesized `confirm_required` ui_action is NOT persisted; its offline proxy is a ledger row `outcome='requires_confirmation'`.
7. `sign_medical_declarations`'s confirm card (`ConfirmRequiredCard`) renders static copy only — the declarations preview is in the payload but never rendered.
8. Historical instances in `cmrm3fgku00056g0y4eb2hsme`: T11 → messageIndex 54 (completion, no uiAction; assistant msg 55 says "pe cardul afișat"); T13 → messageIndex 58 (sign applied, `_message` "The quote can be generated now", 0 generate_quote attempts, msg 59 "nu poate fi finalizată"); T29 → messageIndex 88+90 (`show_document_upload` unrendered); T7 → messageIndex 32 (completion, no card); T20 → messageIndex 72 (0 tool calls, "Verificarea prin SMS nu este disponibilă momentan"); T8 → msg 39 ("Ești gata să continuăm?" after sign, commitment at msg 10); T30 → conversation ends at messageIndex 92 (`ensure_payment_session`/show_payment) with settlement out-of-band 4m47s later.
9. Test DB: `TEST_DATABASE_URL` now in `.env` → `zeno_test` (reset to baseline_main+v3_upgrade + full seed this session). Integration ring self-seeds catalog via `resetDb()`.

**Execution order (deviations from the inventory's suggested order are dependency-driven; flag in report):**
Phase 0: P0.1(T2) → P0.2(T3) → P0.3(T4+streaming race)
Phase 1: P1.1(T12 design doc) → P1.2(T8 design doc)
Phase 2: P2.1(T29) → P2.2(T30) → P2.3(T9, builds shared module) → P2.4(T7) → P2.5(T11) → P2.6(T10) → P2.7(T22) → P2.8(T15) → P2.9(T23)
Phase 3: P3.1(T13) → P3.2(T16) → P3.3(T8-impl) → P3.4(T19; needs P3.1/P3.3) → P3.5(T20) → P3.6(T5)
Phase 4: P4.1(T14, migration) → P4.2(T18) → P4.3(T17)
Phase 5: P5.1(T28) → P5.2(T26) → P5.3(T27) → P5.4(T21) → P5.5(T25) → P5.6(T6)
Phase 6: P6.1(T24)
Close: full-funnel sim + browser pass → evidence capture (diagnose + pg_dump) → DB reseed → smoke → report.

---

## Phase 0 — housekeeping

### P0.1 (T2): gpt-5.6-sol pricing row in seed-model-catalog (placeholder, flagged)

**Files:** Modify `prisma/seeds/seed-model-catalog.ts`; Test `__tests__/prisma/seed-model-catalog.test.ts` (extend existing prisma seed test if present, else new unit test importing the exported rows array — check how the seed exports; if rows are module-local, export a `MODEL_CATALOG_ROWS` constant).

- [ ] Failing test: rows contain `{provider:'OPENAI', modelId:'gpt-5.6-sol'}` with `costPer1kInputTokens: 0.003, costPer1kOutputTokens: 0.015, supportsTools: true, supportsStreaming: true, contextWindow: 128000`; ALSO a row for `{provider:'ANTHROPIC', modelId:'claude-sonnet-5'}` (main-chat's seeded fallback has no catalog row — cost accounting gap found in recon).
- [ ] Implement: add both rows with comment `// PLACEHOLDER pricing — replace with real rates (gpt-5.6-sol real pricing unknown 2026-07-15; sonnet-5 copied from sonnet-4-6)`.
- [ ] Full suite green → commit: `fix(seeds): gpt-5.6-sol + claude-sonnet-5 ModelCatalog rows (placeholder pricing, flagged)`

### P0.2 (T3): gpt-5.6-sol as seed default for main-chat

**Files:** Modify `prisma/seeds/seed-agents.ts:257` (`model: 'gpt-5.4'` → `'gpt-5.6-sol'`; fallback stays `claude-sonnet-5`); Test: extend the agents-seed unit test (find via `grep -l seed-agents __tests__ -r`; if none, add `__tests__/prisma/seed-agents-config.test.ts` importing `AGENTS` — export it if module-local).

- [ ] Failing test: main-chat def has `model: 'gpt-5.6-sol'`, `provider: 'OPENAI'`, `fallbackModel: 'claude-sonnet-5'`.
- [ ] Implement; full suite; commit: `fix(seeds): main-chat defaults to gpt-5.6-sol so reseeds keep the live model`

### P0.3 (T4): chat input reliability — streaming race fix (Enter already works in source)

Enter-to-send exists (`chat-input.tsx:22-30`). The live failure is the overlapping-turn race: `sendMessage` and `sendAction` are near-duplicate SSE loops sharing `streamingMessageIdRef` + a stale `isStreaming` guard (`use-chat.ts:103, 120-337, 339-503`) — overlapping turns clobber each other and leave the input disabled with a stuck cursor.

**Files:** Modify `lib/hooks/use-chat.ts`; Create `lib/chat/sse-consumer.ts` (extracted pure-ish SSE loop so it's unit-testable in node); Test `__tests__/lib/chat/sse-consumer.test.ts`.

- [ ] Failing test (node): `consumeSSE` parses a scripted SSE byte stream (content, ui_action, done, error events) and invokes callbacks with the right payloads; a second concurrent `start()` on the same guard object is rejected synchronously (inFlight semantics).
- [ ] Implement: extract the duplicated parse/dispatch loop into `consumeSSE({response, handlers})`; in `use-chat.ts` both senders use it with (a) per-invocation `const msgId = 'assistant_' + Date.now() + '_' + seq++` captured in closure (never a shared ref), (b) a synchronous `inFlightRef` check-and-set BEFORE any await (replaces the state-based `isStreaming` early-returns at :122/:341), cleared in finally.
- [ ] Keep behavior: suggestions on done, error removal of placeholder, abort semantics.
- [ ] Full suite; browser check deferred to the phase-2 browser pass (Enter + no stuck cursor). Commit: `fix(chat): unify SSE consumption; kill overlapping-turn race (per-invocation msgId + synchronous in-flight guard)`

---

## Phase 1 — design docs (govern phases 2–3)

### P1.1 (T12): `docs/plans/2026-07-15-design-questionnaire-ux-standard.md`

Write the standard as a contract with source anchors. MUST cover: (1) entry card auto-emits deterministically on the entry COMMIT (`open_dnt_session` precedent dnt-handlers.ts:275; application side gains it at `set_application`+`select_coverage`-complete → actually at first exposure via `get_next_question`-emitting commit — see P2.3 decision); (2) questions render ONLY on cards; conduct instruction embedded in EVERY questionnaire tool `_message` (DNT wording at dnt-handlers.ts:435 is the canonical string); (3) card click primary, typed fallback via same write tool; every write ledgered; validation-reject re-emits the same card via rejection `data._uiAction` (gateway.ts:438 spreads handler data on rejections; executor.ts:132 lifts `_uiAction` regardless of outcome — thread it from handlers); (4) navigation: revisit/change = `modify_answer`/`write_dnt_answer` upsert + CONFIRM_ON_MODIFY (planner :91-97); (5) completion ALWAYS auto-emits a review/summary card from the completing commit; (6) exactly ONE confirmation: the sign/confirm click on the review card — **GUI-actor clicks are confirmed by construction** (design ruling below); (7) model narrates ≤ one transition line.
**Design ruling to document (single-confirmation):** the gateway treats `actor==='gui'` commits as `confirmed` (the human clicked a card rendering exactly those args); confirmToken two-step remains for `actor==='agent'`. This kills confirmation-on-confirmation (evidence msg 36-38) while keeping the agent-path ratchet.
**Deliverable:** shared module `lib/tools/handlers/questionnaire-cards.ts` (built in P2.3) used by BOTH dnt-handlers and application-handlers: `questionCard(groupType, next, progress)`, `reviewCard(...)`, `CONDUCT_LINE`, `rejectionReemit(...)` helpers.

- [ ] Write doc; no code. Commit: `docs(design): T12 questionnaire UX standard (one model for all questionnaires)`

### P1.2 (T8): `docs/plans/2026-07-15-design-intent-and-momentum.md`

MUST cover, grounded in recon: (1) **intent as ledgered commit**: new tool `set_purchase_intent` (commit, `sideEffect:'save'`), new model `PurchaseIntent {id, customerId, conversationId, goal ('quote'|'purchase'), productCode, config Json?, status ('active'|'fulfilled'|'stale'|'renounced'), capturedAt, renewedAt?}` (migration in P4.1's migration file — single new migration for the run); exposure: always available in DISCOVERY+; auto-fulfil at accept_quote applied; (2) **prerequisites are consequences of intent**: with an active intent the agent chains DNT→application→coverage→questionnaire→medical sign→quote WITHOUT re-asking; pause ONLY at regulated express acts whose UI is the question (sign cards, OTP, payment); (3) **momentum mechanics — deterministic parts**: (a) the synthetic GUI path enters the STANDARD tool loop (P3.1) so post-click turns can chain; (b) `nextBestAction` + active intent surfaced in situationalBriefing (`Active intent: purchase protect (standard/level_1+addon) — captured <ts>. Do NOT re-ask commitment; proceed to the next step.`); (c) prompt directive in CONSTITUTION_CORE ADVANCING section: with an active intent, never ask "Ești gata să continuăm?" — the only pauses are cards; (4) **freshness**: same-session never re-ask; cross-session (conversation differs from intent's) or >7d → renew WITH CONTEXT (briefing line renders the renewal script); (5) **consequence-planner verdict**: NOT the chaining substrate (single-mutation, within-application — consequence-planner.ts:76-162); the substrate is deriveAndExpose objective machinery + tool loop + briefing; (6) `_autoChain` single-hop deterministic chain (handler-declared `data._autoChain: {tool, args}`, executed by orchestrator on gui turns through the normal gateway, legality-checked) — used by T19 (contact submit → auto start_channel_verification).

- [ ] Write doc; no code. Commit: `docs(design): T8 durable purchase intent + funnel momentum`

---

## Phase 2 — card/parity family

### P2.1 (T29): ui-action registry + show_document_upload & show_otp_entry renderers + visible fallback + parity ratchet + `unrendered_ui_action` check

**Files:** Create `lib/chat/ui-action-registry.ts`, `components/chat/rich/document-upload-card.tsx`, `components/chat/rich/otp-entry-card.tsx`, `components/chat/rich/unknown-action-card.tsx`; Modify `components/chat/rich/rich-content.tsx`; Create `__tests__/lib/chat/ui-action-parity.test.ts`, `lib/diagnostics/checks-ui.ts` + register in `lib/diagnostics/index.ts`; Test `__tests__/lib/diagnostics/checks-ui.test.ts`.

Registry contract (single source both sides import):
```ts
// lib/chat/ui-action-registry.ts
/** Every uiAction type a tool handler can emit. Grep-anchored: handlers' `uiAction: { type: '...' }` literals + orchestrator-synthesized 'confirm_required'. */
export const EMITTED_UI_ACTION_TYPES = ['show_question','show_data_field','show_otp_entry','show_document_upload','show_payment','show_quote','show_quote_accepted','confirm_required', /* added by later tasks: 'show_dnt_review','show_medical_review','show_medical_batch','show_acceptance','show_document_viewer' */] as const
/** Every action type the client can POST (rich-content onAction + cards). */
export const CLIENT_POSTED_ACTION_TYPES = ['select_tier','select_level','answer_question','accept_quote','cancel_quote','submit_field','payment_complete','otp_submit','document_uploaded', /* + confirm-card tools */ 'sign_dnt','write_question_answer','modify_answer','sign_medical_declarations','cancel_application','change_payment_option','request_cancellation'] as const
export const RENDERED_UI_ACTION_TYPES: string[] = [...]  // maintained beside the renderer switch
```
- [ ] Failing parity test (3 asserts): (a) every EMITTED type ∈ RENDERED (initially fails on show_document_upload/show_otp_entry — the T29 bug); (b) every CLIENT_POSTED type has an `adaptAction` case (`adaptAction({type, payload:{}}) !== null` — needs payload fixtures per type; initially fails on `payment_complete`, fixed in P2.2 — mark that single assertion `todo` here and un-todo in P2.2, OR restrict (b) to non-payment types here); (c) `show_bd_result/show_bd_rejected/show_product_cards/show_product_card/show_payment_success` renderer-only types are declared in an `RENDER_ONLY_TYPES` allowlist so the sets stay exact.
- [ ] Failing renderer contract tests (node pattern — pure helpers, no jsdom): export `documentUploadAction(files)`/`otpSubmitAction(code)` builders from the new cards; test they produce `{type:'document_uploaded'|'otp_submit', payload:{...}}` round-tripping through `adaptAction` to `get_current_state`/`confirm_channel_verification`.
- [ ] Implement: `DocumentUploadCard` (file input accept image/pdf, multipart POST to `payload.uploadUrl` with `kind`, progress state, renders returned `{status}` = validated/review + posts `document_uploaded` action on success); `OtpEntryCard` (6-digit input, masked target line from payload, `[Retrimite]` posts `{type:'otp_resend'}`→ new adapter case → `start_channel_verification {resend:true, channel, target}` — needs target in payload: extend `show_otp_entry` payload in identity-handlers.ts:38 to `{channel, targetMasked, target}`; submit posts `otp_submit`); `UnknownActionCard` (visible fallback: bordered card "Această acțiune nu poate fi afișată (tip: X)" + `console.error` anomaly log) replacing `default: return null` at rich-content.tsx:385.
- [ ] Failing diagnostics test then check `unrendered_ui_action` in `checks-ui.ts`: for each turn, each `toolCalls[].result.uiAction.type` not in RENDERED_UI_ACTION_TYPES (import from `@/lib/chat/ui-action-registry`) → error finding `{type, tool}`. Register module in CHECK_CATALOG. Test fixture: turn with `result.uiAction {type:'show_document_upload'}` → error; `show_question` → clean. (Historical: flags messageIndex 88 & 90.)
- [ ] Full suite; commit: `feat(ui): uiAction registry + document-upload & OTP cards + visible unknown-type fallback + parity ratchet + unrendered_ui_action check (T29)`

### P2.2 (T30): mock payment settles + payment_complete adapter + Stripe GET return fix + `funnel_ends_at_payment_card` check

**Files:** Modify `components/chat/rich/payment-card.tsx` (~:420 mock branch; :148 return_url), `lib/chat/action-adapter.ts`, `app/api/chat/route.ts` (concurrency-counter leak), `app/api/payments/confirm/route.ts` (GET accepts `paymentId`); Create `lib/diagnostics/checks-payment-funnel.ts`; Tests: `__tests__/lib/chat/action-adapter-payment.test.ts`, `__tests__/lib/payments/mock-payment-flow.test.ts` (pure helper), `__tests__/lib/diagnostics/checks-payment-funnel.test.ts`, extend parity test (un-todo the (b) assert).

- [ ] Failing adapter test: `adaptAction({type:'payment_complete', payload:{paymentId:'p1'}})` → `{name:'get_payment_status', arguments:{}}`.
- [ ] Failing mock-flow test: export `confirmMockPayment(paymentId, fetchImpl)` helper from payment-card module scope (module-scope function, node-testable): POSTs `/api/payments/confirm` `{paymentId}`, returns parsed `{success, policyStatus}`; throws on !ok.
- [ ] Implement mock branch: `handleMockPayment` = `await confirmMockPayment(paymentId, fetch)` (drop the fake 2s sleep — the mock provider itself sleeps 2s server-side) → then `onPaymentComplete(paymentId)`. Stripe immediate-success branch (:162-164) also calls `confirmMockPayment` first (provider-verified, idempotent inbox) — mirrors webhook. Fix `return_url` (:148) to `?orderId=${paymentId}`… NO: GET looks up by `providerPaymentId`. Instead extend GET (`app/api/payments/confirm/route.ts:119-129`): accept `paymentId` query param (lookup by row id) OR `orderId` (by providerPaymentId) — failing route test first (`__tests__/integration/` has payments tests? extend nearest; else unit-test the extracted param-resolution helper).
- [ ] Fix route concurrency leak (route.ts:60-73): decrement the in-flight counter on the 400 return (recon: 3 unknown-action posts permanently 429 the conversation) — regression test with 4 sequential bad posts asserting the 4th still 400s (not 429). (Integration-ring test hitting the route handler directly.)
- [ ] Failing diagnostics test then `funnel_ends_at_payment_card` check: if the LAST turn (max messageIndex) has a `result.uiAction.type === 'show_payment'` and no later turn exists → warn `{paymentId}` ("payment card was the conversation's last recorded event — settlement, if any, happened outside the chat"). (Historical: flags messageIndex 92.)
- [ ] Full suite; commit: `fix(payments): mock path settles via provider-verified /api/payments/confirm; payment_complete→get_payment_status adapter; GET return accepts paymentId; route 400 no longer leaks concurrency slots; funnel_ends_at_payment_card check (T30)`

### P2.3 (T9): shared questionnaire-cards module + application entry card + conduct instruction + reject re-emit + reload re-derive

**Files:** Create `lib/tools/handlers/questionnaire-cards.ts`; Modify `lib/tools/handlers/application-handlers.ts`, `lib/tools/handlers/dnt-handlers.ts`, `lib/tools/handlers/select-coverage-handlers.ts`, `app/chat/[id]/page.tsx` + `components/chat/chat-page.tsx`/`use-chat.ts` (initial pending card); Tests: `__tests__/lib/tools/questionnaire-cards.test.ts`, extend `__tests__/integration/write-question-answer-tx.test.ts` neighbors, `__tests__/integration/application-entry-card.test.ts` (new), `__tests__/app/chat-page-pending-card.test.ts` (server-side derive helper).

Module contract:
```ts
// lib/tools/handlers/questionnaire-cards.ts
export const CONDUCT_LINE = 'A question card is shown to the customer with all the options — NEVER list the options in prose (no "Opțiuni:" lists) and never repeat the question text; invite the customer to answer on the card in ONE short line.'
export function questionCard(groupType: 'dnt'|'application', next: NextQuestionShape|null, progress: {answered:number; total:number}) // unifies dntQuestionCard (dnt-handlers.ts:299) + inline (application-handlers.ts:354)
export function savedMessage(groupType, next, progress) // embeds CONDUCT_LINE on has-next; completion strings unchanged
export function rejectReemit(data: Record<string,unknown>|undefined, card: UiAction|undefined) // returns {...data, _uiAction: card} — rejection re-ask threading
```
- [ ] Failing unit tests for the module (card shape parity with current emissions; CONDUCT_LINE embedded).
- [ ] Failing integration test (ring): after DNT signed + `set_application` + full `select_coverage`, the FIRST card must exist without any write: decide point per T12 — **the entry card rides the last `select_coverage` commit that completes the selection** (single writer, deterministic): `select_coverage` result, when selection complete AND questionnaire has a next question, carries `uiAction: questionCard('application', next, progress)` + `_message` with CONDUCT_LINE. Also `resume_application` (:551-559) emits the card for its `nextQuestion`.
- [ ] Failing integration test: rejected `write_question_answer` (invalid option) re-emits the SAME `show_question` card via rejection envelope `data._uiAction` (assert executor result `uiAction` present on `success:false`) — thread `rejectReemit` through the validation-reject return (:234-235), grounding reject (:256-261), and same for `write_dnt_answer` (dnt-handlers.ts validation/grounding rejects).
- [ ] Modify `write_question_answer` save path to use `savedMessage` (adds conduct line — kills prose doubling) and `questionCard`; `write_dnt_answer`/`open_dnt_session` switch to the shared module (emissions unchanged — tests pin).
- [ ] Reload re-derive: `app/chat/[id]/page.tsx` — server-side compute pending card: call `loadDomainSnapshot`+`deriveAndExpose`; if DNT session active with `pendingCode` → build `show_question` (dnt) payload; else if application OPEN with next question → `show_question` (application); else if `pendingConfirmationTools` non-empty → nothing (agent-path confirm cards are turn-scoped). Pass as `initialUiAction` prop → `use-chat.ts` seeds `uiActions` Map with key of the LAST assistant message id (and include that id in `lastActionableId` logic). Unit-test the extracted pure helper `derivePendingCard(snapshotSlices)` in `__tests__/lib/chat/derive-pending-card.test.ts`.
- [ ] Register any new uiAction types in the registry (none new here); full suite; commit: `feat(questionnaire): shared card module — application entry card, conduct line, reject re-emit, reload re-derive (T9/T12)`

### P2.4 (T7): DNT completion → single review/sign card

**Files:** Modify `lib/tools/handlers/dnt-handlers.ts` (completion paths :415-437, :158-163, :274), `lib/tools/gateway.ts` (gui-confirmed ruling), `lib/chat/action-adapter.ts` (sign_dnt consent passthrough already exists :165-175), `components/chat/rich/dnt-review-card.tsx` (new), `rich-content.tsx`, registry entry in `ui-action-registry.ts`; Tests: `__tests__/integration/dnt-review-card.test.ts`, `__tests__/lib/tools/gateway-gui-confirmed.test.ts`, component-helper test.

- [ ] Failing gateway test: a commit to a `requiresConfirmation:true` tool with `context.actor==='gui'` and NO confirmToken applies directly (confirmed by construction); `actor==='agent'` still gets the two-step. Implementation point: `executeCommit` confirm gate (gateway.ts:315-332) — skip token mint when `actor==='gui'`; set `confirmed:true` in handler context. Legality/replay/ONE_SHOT untouched.
- [ ] Failing integration test: completing the last DNT answer returns `uiAction {type:'show_dnt_review', payload:{answers:[{code, questionText, valueLabel}...], consents:{gdpr:false, aiDisclosure:false}, sessionId}}`; same card from `get_dnt_next_question`-complete and `open_dnt_session`-all-prefilled paths.
- [ ] Implement `buildDntReviewCard(sessionId, db)` in questionnaire-cards (loads session answers + question texts via the SAME db handle — context.db in commit handlers); completion `_message` becomes: `'All DNT questions answered. A review card with a Sign button is shown to the customer — do NOT ask for confirmation in prose and do NOT call sign_dnt yourself; invite them to review and sign on the card in one short line.'`
- [ ] `DntReviewCard`: compact Q→A recap, two UNCHECKED checkboxes (GDPR processing + AI-disclosure ack), Sign button disabled until both — click posts `{type:'sign_dnt', payload:{consent:{gdpr:true, aiDisclosure:true}}}` (adapter exists; gui-confirmed rule applies → ONE click signs). Register `show_dnt_review` in EMITTED+RENDERED.
- [ ] Verify against `scripts/verify-dnt-flow.ts` (run it — must stay 6/6).
- [ ] Full suite; commit: `feat(dnt): completion auto-emits review/sign card; GUI clicks are confirmed by construction (single-confirmation principle) (T7)`

### P2.5 (T11): medical completion surfaces the sign card deterministically + constitution rule + `hallucinated_ui_reference` check

**Files:** Modify `lib/tools/handlers/application-handlers.ts` (completion path :310-318), `components/chat/rich/medical-review-card.tsx` (new; ConfirmRequiredCard's static copy stays for other tools), `rich-content.tsx`, `prisma/seeds/seed-agents.ts` (constitution constraint), registry; Create `lib/diagnostics/checks-cards.ts` (or extend checks-ui.ts); Tests: integration `__tests__/integration/medical-completion-card.test.ts`, diagnostics test.

- [ ] Failing integration test: the completing `write_question_answer` (when medical declarations pending — `loadMedicalDeclarationState(context.db).signed === false && requiredCodes.length > 0`) carries `uiAction {type:'show_medical_review', payload:{declarations:[{code, questionText, value}...]}}` and `_message`: `'Application questionnaire complete. A medical-declarations review card with a Sign button is shown to the customer — do NOT call sign_medical_declarations yourself and do NOT reference any card unless it was emitted this turn; invite them to sign in one short line.'` No-medical path keeps current message.
- [ ] `MedicalReviewCard`: declarations list (question text + Da/Nu), Sign button → posts `{type:'sign_medical_declarations', payload:{}}` (gui-confirmed → applies in one click; handler's conditional requiresConfirmation path returns preview only for agent actor — adjust handler :591-593 to trust `context.confirmed`).
- [ ] Constitution: append to main-chat `constraints` (seed-agents.ts:273-274 array): `'You may reference a card ("cardul afișat") ONLY when a tool result THIS turn carried a ui card. Narrating an emitted card is at most one short invite line. If no card was emitted, never claim one exists.'`
- [ ] Failing diagnostics test then `hallucinated_ui_reference` check (pattern: stateClaimWithoutCommit, checks-fabrication.ts:66-86): assistant message (diacritic-stripped, lowercased) matches `/\b(cardul|card)\b.*\b(afisat|de mai sus|prezentat)\b|\bpe card\b/` in a turn where no `toolCalls[].result.uiAction` exists AND no ledger row `requires_confirmation` joins that turn (confirm-card proxy, recon §6) → error. (Historical: flags messageIndex 54.)
- [ ] Full suite; commit: `feat(medical): completion deterministically surfaces the review/sign card; hallucinated_ui_reference ratchet (T11)`

### P2.6 (T10): medical bulk card — "none of these apply" + per-condition toggles (ruling: option c)

**Files:** Modify `lib/tools/handlers/application-handlers.ts` (batch write handler), `lib/tools/registry.ts` (+`write_medical_batch` def), `lib/tools/validation.ts` (schema), `lib/chat/action-adapter.ts` (+`medical_batch` case), `lib/engines/derive-and-expose.ts` (expose alongside write_question_answer when bd_medical questions pending), `components/chat/rich/medical-batch-card.tsx` (new), `rich-content.tsx`, registry consts; Tests: integration `__tests__/integration/medical-batch.test.ts`, adapter/component tests.

- [ ] Failing integration test: with HEALTH_DECLARATION_CONFIRM answered and 6 BD_* pending, `write_medical_batch {answers:{BD_CANCER_HISTORY:'false', ...all six}}` (gui actor) applies all six through `computeConsequences`/`applyConsequencePlan` per question sequentially inside ONE gateway commit (context.db), ledgered once (targetRef `app_answers_batch:<applicationId>`), returns completion result — which (per P2.5) carries the medical review card. Any YES value still flags/escalates identically to the sequential path (assert PAUSED WorkItem parity for a 'true' answer).
- [ ] Card emission: when the FIRST bd_medical question becomes current (the `write_question_answer` save that lands on a BD_* next question, and `select_coverage`/`resume` entry equivalents), emit `uiAction {type:'show_medical_batch', payload:{conditions:[{code, text}...6]}}` INSTEAD of the single-question card (branch inside `questionCard` on `next.code.startsWith('BD_')` with groupType application → build batch payload from the 6 visible BD codes via engine).
- [ ] `MedicalBatchCard`: 6 rows with toggles (default OFF = "nu mi se aplică"), primary button `Niciuna dintre acestea nu mi se aplică` (posts `{type:'medical_batch', payload:{answers: all false}}`), or per-row toggles then `Continuă` (posts mixed values). Typed fallback stays `write_question_answer` per question (both paths ledgered).
- [ ] Register types; full suite; commit: `feat(medical): one-card bulk declaration ("none of these apply" + toggles) writing per-question consequences in one commit (T10)`

### P2.7 (T22): history rendering — human interaction chips, never [Action: *]

**Files:** Modify `app/api/chat/route.ts:74` (synthesized message), `lib/chat/action-labels.ts` (new), `components/chat/message-bubble.tsx` (chip rendering), `app/chat/[id]/page.tsx`; Tests: `__tests__/lib/chat/action-labels.test.ts`, route test.

- [ ] Failing unit test: `actionLabel({type:'answer_question', payload:{answer:'da', questionCode:'BD_CANCER_HISTORY', groupType:'application'}}, 'ro')` → `'✓ Răspuns: da'`; `sign_dnt` → `'✓ Analiza de nevoi semnată'`; `sign_medical_declarations` → `'✓ Declarații medicale semnate'`; `accept_quote` → `'✓ Ofertă acceptată'`; `payment_complete` → `'✓ Plată efectuată'`; `otp_submit` → `'✓ Cod de verificare introdus'`; `submit_field` → `'✓ <field label>: <value>'` (mask phone/email partially); unknown → `'✓ Acțiune'`. Marker format: persisted content = `⟦action⟧<label>` (a machine-detectable prefix that is still readable).
- [ ] Route: `message = message || '⟦action⟧' + actionLabel(parsed.action, language)`.
- [ ] `MessageBubble`: user content starting `⟦action⟧` renders as a small right-aligned chip (muted pill, no bubble); LEGACY `[Action: x]` rows render as generic chip `'✓ Interacțiune'` (never raw). Component logic kept in an exported pure helper `renderKind(content)` → unit-tested.
- [ ] Coordination with T12: live sends (`sendAction`) currently append no user bubble — keep that (the card visually collapses to `isAnswered`); reload now shows chips in those slots. Full suite; commit: `feat(chat): action turns persist human-readable chips; [Action:*] never shown to customers (T22)`

### P2.8 (T15): offer card carries ALL numbers (units/caps/franchise); prose sells

**Files:** Modify `lib/tools/handlers/quote-handlers.ts` (:124-156 coverage mapping, :235 message, :236-249 payload), `components/chat/rich/quote-card.tsx`, `lib/products/coverage-display.ts`; Tests: extend `__tests__/lib/engines/quote-engine.test.ts` neighbors + `__tests__/lib/tools/` quote handler test + component helper test.

- [ ] Failing handler test: `show_quote` payload coverages carry `{code, name, amount, currency, unit: 'per_day'|'lump_sum', maxUnits?, deductibleDays?}` (from the already-loaded `coverageType` — currently dropped) + top-level `currency`.
- [ ] Failing component-helper test: export `formatCoverage(cov, lang)` from quote-card: per_day → `'100 EUR/zi (max 60 zile/eveniment)'`; deductibleDays → append `', franșiză 3 zile'`; 90-cap → `'max 90 zile/an'` (maxUnits semantic: HOSPITALIZATION_ACCIDENT is per-year, HOSPITALIZATION_ABROAD per-event — carry `capPeriod` from CoverageType description? Recon: seed has semantics in description text only; add explicit `capPeriod: 'per_year'|'per_event'` mapping keyed by code in coverage-display.ts with a comment, defaulting 'per_year').
- [ ] generate_quote `_message` gains conduct: `'A quote card with ALL numbers is shown. In prose: do NOT repeat prices or coverage figures — give ONE short personalized reason to act, anchored to what you know about the customer (their insights), leading with the strongest benefit.'`
- [ ] Full suite; commit: `feat(quote): card renders per-day units, caps, franchise; prose sells instead of repeating numbers (T15)`

### P2.9 (T23): acceptance card — disclosure ack + payment-frequency comparison + gated Accept

**Files:** Modify `lib/tools/handlers/quote-handlers.ts` (get_quote_info or new `get_acceptance_bundle` read → prefer extending accept path), `lib/chat/action-adapter.ts` (+`open_acceptance`, `acknowledge_disclosures` cases), `components/chat/rich/acceptance-card.tsx` (new), `components/chat/rich/quote-card.tsx` (Accept → `open_acceptance`), `rich-content.tsx`, registry, disclosure handler `lib/tools/handlers/disclosure-handlers.ts` (find actual file via grep `acknowledge_disclosures`); Tests: integration `__tests__/integration/acceptance-card.test.ts`, adapter/component tests.

- [ ] Failing adapter tests: `open_acceptance` → read tool `get_acceptance_bundle`; `acknowledge_disclosures` → commit `acknowledge_disclosures {confirmToken?}`.
- [ ] Failing integration test: `get_acceptance_bundle` (new read; exposed when quote ISSUED + identity gate for accept met or pending) returns uiAction `{type:'show_acceptance', payload:{quoteId, premium:{annual, semiAnnual, quarterly, currency}, frequencies:[{option:'annual', perInstallment:540, installments:1, totalPerYear:540}, {option:'semi_annual', perInstallment:270, installments:2, totalPerYear:540}, {option:'quarterly', perInstallment:135, installments:4, totalPerYear:540}], documents:[{id, kind, title, url:'/api/documents/<id>'}...], disclosuresAcked: bool}}` — documents from the registry `Document` rows (IPID+TERMS for product, seeded by seed-documents.ts), frequencies from Quote precomputed fields ∩ Product.paymentFrequencyOptions (payment-schedule.ts:13 map).
- [ ] `AcceptanceCard`: offer recap; document links (target=_blank so the SPA survives — T21b) ; ONE checkbox `'Confirm că am citit și înțeles IPID și Termenii'` — on check POSTs `{type:'acknowledge_disclosures'}` (gui-confirmed applies); frequency radio group AS COMPARISON (equal totals visible); `Accept` disabled until ack applied + frequency chosen → posts `{type:'accept_quote', payload:{paymentOption}}`.
- [ ] `quote-card.tsx` Accept button relabeled `'Continuă spre acceptare'` posting `{type:'open_acceptance'}` (kills the hard-coded annual accept at rich-content.tsx:213).
- [ ] Full suite + `scripts/verify-payment-ops.ts` still 7/7 and `scripts/verify-quote-lifecycle.ts` 4/4; commit: `feat(acceptance): one acceptance card — disclosure ack checkbox, frequency comparison, gated accept (T23)`

---

## Phase 3 — reasoning/prompt correctness

### P3.1 (T13): action turns get the standard tool loop + supersession clause + `stale_gate_claim` check

**Files:** Modify `lib/chat/orchestrator.ts` (synthetic branch :885-1012), `prisma/seeds/seed-agents.ts` (constraints), `lib/diagnostics/checks-cards.ts` or new `checks-supersession.ts`; Tests: integration `__tests__/integration/synthetic-turn-tool-loop.test.ts` (drive `handleChatTurn` with `syntheticToolCall` for a mocked LLM? — orchestrator tests exist? grep `handleChatTurn` in `__tests__`; if only via sims, test the extracted seam), diagnostics test.

- [ ] Refactor: after executing the synthetic tool (:920-927) and emitting its events, DO NOT branch into the tool-less narration call — instead push the synthetic assistant+tool messages onto `builtMessages` and FALL THROUGH into the standard tool loop (rounds, exposure wall, round-refresh `[State update]` messages, buildTurnTools) with round budget MAX_TOOL_ROUNDS-1. The round-refresh after the synthetic applied commit is the "structured state-delta" the task demands (mechanism exists: round-refresh.ts:15-21 — invoke it for the synthetic result before round 0). Failing test: a synthetic `sign_medical_declarations` turn exposes `generate_quote` to the follow-up LLM round (assert the tools list passed to the mocked gateway.stream contains generate_quote — extract `buildSyntheticSeed()` helper if the loop is untestable directly).
- [ ] Supersession clause appended to constraints (seed-agents.ts): `'Freshest evidence wins: a successful tool result or [State update] message THIS turn SUPERSEDES the CURRENT SYSTEM STATE section and the turn-start tool manifest. When a tool result says an action is now possible, trust it — attempt the action instead of claiming it is unavailable.'`
- [ ] Failing diagnostics test then `stale_gate_claim`: turn where (a) some `toolCalls[].result.data._message` matches `/can (now )?be generated|is now available|Ready for signature|can now proceed/i` naming an action A (map message→action via a small table: `generate_quote`, `sign_dnt`, `set_application`), (b) the assistant message for the turn matches the impossibility lexicon `/nu (mai )?(poate|pot|se poate)|nu este posibil|cannot be|can't be|unavailable/i` with A's domain keywords (quote: /calcul|cotați|pret|ofert/), and (c) zero calls to A that turn → error `{action, resultMessage, claim}`. (Historical: flags messageIndex 58.)
- [ ] Full suite + rerun `scripts/verify-advance-flow.ts` (2/2); commit: `feat(orchestrator): GUI action turns run the standard tool loop (state-delta + chaining); supersession clause; stale_gate_claim ratchet (T13)`

### P3.2 (T16): outbound contradiction guard + one-shot self-repair

**Files:** Create `lib/chat/outbound-guard.ts` (pure detector) + orchestrator wiring (buffer final no-tool-call round, :1093-1113 seam); Tests: `__tests__/lib/chat/outbound-guard.test.ts` (pure), orchestrator seam test.

- [ ] Failing pure tests: `detectFalseUnavailabilityClaim(text, available: string[], lang)` — returns `{action, claim}` when text claims impossibility about a funnel action (lexicon: quote/price calc → generate_quote; sign → sign_dnt/sign_medical_declarations; payment → ensure_payment_session; verification/cod → start_channel_verification) that IS in `available`; null otherwise. Reuses T13's lexicon table (share module). Negative cases: refusal about a genuinely blocked action → null; "nu pot să-ți dau sfaturi medicale" → null (non-funnel).
- [ ] Wire: in the tool loop, when a round yields NO tool calls (the final-response round, :1110-1113), BUFFER its content (don't yield chunks); run the detector against the freshest `exposure.actions.available` (post-refresh); pass → flush buffered content events; fail → ledger-free anomaly event `self_repair_triggered` (recordAndYield debug event + `state.anomalies` entry so it lands in TurnDebug totals) + ONE re-invocation of `gateway.stream` with an appended system message `'[Correction] Your draft falsely claimed "<claim>" but <action> IS available right now. Rewrite: either perform the action or tell the customer it is happening.'` and tools ENABLED; stream the retry normally (unguarded, cap 1). Same buffering on the synthetic path's final round (now unified via P3.1).
- [ ] Latency note in code comment: buffering delays first token of final round only; accepted per design.
- [ ] Full suite; commit: `feat(orchestrator): deterministic outbound guard — false "can't" about an available funnel action triggers one-shot self-repair (T16)`

### P3.3 (T8-impl): durable purchase intent + momentum

**Files:** Migration (see P4.1 — SINGLE migration `20260716000000_live_test_hardening` created HERE since this is the first schema-touching task; P4.1 extends the same file pre-`migrate dev` if not yet applied, otherwise its own): add `PurchaseIntent` model; Modify `prisma/schema.prisma`, `lib/tools/registry.ts` (+`set_purchase_intent`), `lib/tools/validation.ts`, new handler in `lib/tools/handlers/intent-handlers.ts`, `lib/engines/snapshot-loader.ts` (+intent slice), `lib/engines/derive-and-expose.ts` (exposure + fulfil on accept), `lib/chat/phase-sections-map.ts` (briefing lines incl. renewal script), `prisma/seeds/seed-agents.ts` (ADVANCING momentum directive), `lib/tools/handlers/quote-handlers.ts` (accept_quote marks intent fulfilled), `__tests__/helpers/test-db.ts` DOMAIN_TABLES += 'PurchaseIntent'; Tests: integration `__tests__/integration/purchase-intent.test.ts`, briefing unit test.

- [ ] Schema (in the run's single new migration):
```prisma
model PurchaseIntent {
  id             String   @id @default(cuid())
  customerId     String
  conversationId String
  goal           String   // 'quote' | 'purchase'
  productCode    String
  config         Json?
  status         String   @default("active") // active|fulfilled|stale|renounced
  capturedAt     DateTime @default(now())
  renewedAt      DateTime?
  customer       Customer @relation(fields: [customerId], references: [id])
  @@index([customerId, status])
}
```
- [ ] Failing integration tests: `set_purchase_intent {goal:'purchase', productCode:'protect', config:{tier:'standard'}}` commits a row + ledger; a second intent supersedes (prior → 'stale'); accept_quote applied → intent 'fulfilled'; snapshot exposes `intent: {goal, productCode, capturedAt, sameSession: bool}`; briefing renders the do-not-re-ask line when active+sameSession and the renewal script (`'Acum N zile te interesa X — lipsea Y; acum îl avem. Continuăm?'` data-driven) when cross-session.
- [ ] Prompt: ADVANCING section gains: `'When an active purchase intent exists, the customer has ALREADY committed — never ask "Ești gata să continuăm?" or any readiness question. Proceed directly; the only pauses are the cards (sign, OTP, payment). Capture intent with set_purchase_intent the moment the customer commits to buying or to a quote.'`
- [ ] `_autoChain` (single-hop): orchestrator, on an APPLIED synthetic/gui commit whose `data._autoChain = {tool, args}`, executes that tool through the normal pipeline before entering the LLM rounds (legality-checked; failure → result surfaces to model, never throws). Unit/integration test with a stub handler. (Consumed by P3.4.)
- [ ] `npx prisma migrate dev --name live_test_hardening` (creates+applies on dev DB; test DB via `migrate deploy` in the same step — run `DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy`).
- [ ] Full suite; commit: `feat(intent): ledgered purchase intent + momentum (no re-asking) + _autoChain hop (T8)`

### P3.4 (T19): contact submit auto-sends the code + code-entry card

**Files:** Modify `lib/tools/handlers/data-handlers.ts` (collect_customer_field: email/phone submit declares `_autoChain` to `start_channel_verification` when channel unverified and field is the contact point — email only while SMS off), `lib/tools/handlers/identity-handlers.ts` (extend show_otp_entry payload: `{channel, targetMasked, target}` — done partly in P2.1; ensure `[Folosește emailul]` escape only when channel!=email); Tests: integration `__tests__/integration/contact-submit-autosend.test.ts`.

- [ ] Failing test: gui `submit_field {field:'email', value}` turn → collect applies AND (same turn, autoChain) `start_channel_verification` applies → challenge row exists + `show_otp_entry` uiAction emitted; agent-typed path unchanged (autoChain only on gui actor? NO — apply for both actors: the submission itself is consent regardless of the transport; keep legality: skip when a challenge already pending or channel already verified).
- [ ] `_message` on collect result (email/phone): `'Contact saved and the verification code was ALREADY sent automatically — a code-entry card is shown. Do NOT ask whether to send the code.'`
- [ ] Full suite + `scripts/verify-identity-flow.ts` (5/5); commit: `feat(identity): contact submission IS the consent — code auto-sends, entry card rides the commit (T19)`

### P3.5 (T20): channel availability — one source of truth

**Files:** Create `lib/channels/availability.ts` (`availableVerificationChannels(): ('email'|'sms')[]` from env: email always (mock|resend), sms only when `SMS_PROVIDER` set — none exists today → email-only); Modify `lib/tools/registry.ts:1146-1168` (description + param enum text derive from it), `lib/tools/validation.ts:183` (`z.enum(availableVerificationChannels())`), `lib/tools/handlers/identity-handlers.ts` (hard-reject stays as defense), `prisma/seeds/seed-agents.ts` (scope the WHAT-I-CANNOT-DO clause + conduct principle); Tests: unit `__tests__/lib/channels/availability.test.ts`, registry/validation tests.

- [ ] Failing tests: availability returns `['email']` with no SMS_PROVIDER; zod rejects `channel:'sms'` with a legible message; registry description contains no unconditional "or phone number" (assert derived text mentions exactly the available channels).
- [ ] Constitution edit — replace `'- Send emails, SMS, or documents to the customer'` with `'- Write free-form emails or SMS in my own words (system-generated verification codes and documents ARE delivered through my tools — offering those is correct)'` and append conduct principle to CORE BEHAVIORS: `'When a tool exists for what the customer asks, TRY THE TOOL and trust its error — never refuse from memory of your limitations.'`
- [ ] Full suite; commit: `fix(channels): channel capability derives from provider config; constitution clause scoped to free-form messaging (T20)`

### P3.6 (T5): first-turn greeting — style guidance, never verbatim

**Files:** Modify `prisma/seeds/seed-agents.ts:15-25`; Test: unit test asserting FIRST_TURN_RULES (export it) contains the vary-directive and contains NO quoted full greeting sentence (regex: no `"Bună! Sunt Zeno` literal).

- [ ] Rewrite: keep element checklist (name Zeno, automated-system disclosure with allowed RO terms, no insurer, no products, ONE open question, short+warm); REMOVE the reference opening entirely; add: `'Compose the greeting fresh each time in your own words — vary sentence shape and word choice between conversations; NEVER reuse a memorized greeting sentence.'`
- [ ] Full suite; commit: `fix(prompt): first-turn greeting is style-guided, not a reproducible template (T5)`

---

## Phase 4 — quote-engine integrity

### P4.1 (T14): rating-input snapshot frozen on the Quote

**Files:** Schema: `Quote.ratingInputs Json?` (added to the SAME `20260716000000_live_test_hardening` migration if P3.3's isn't applied yet; otherwise `migrate dev --name quote_rating_inputs`); Modify `lib/customer/profile-service.ts` (`getAgeWithSource` → `{age, source: 'dateOfBirth'|'declaredAge'|'cnp'}|null`; keep `getAge` delegating), `lib/tools/handlers/quote-handlers.ts` (persist snapshot), `lib/engines/quote-engine.ts` (return `components`); Tests: unit quote-engine components test, integration `generate-quote-commit.test.ts` extension.

- [ ] Failing integration test: issued Quote has `ratingInputs` = `{ageUsed, ageSource, band:{minAge,maxAge}|null, basePremiumAnnual, addonPremiumAnnual, tierCode, levelCode, includesAddon, medicalAnswersHash|null, dntId|null, fx:null, engineVersion, computedAt}` — every rating factor recoverable without re-derivation.
- [ ] Full suite; commit: `feat(quote): full rating-input snapshot frozen at issuance — no factor re-derived after issue (T14)`

### P4.2 (T18): currency guard + FX seam (BNR reference, pluggable, frozen)

**Files:** Create `lib/engines/fx.ts` (`FxProvider {getReference(base:'EUR', quote:'RON'): Promise<{rate, date, source}>}`; `FixedFxProvider` (env `FX_EUR_RON`, default `5.06`, source `'fixed:env'`), `BnrFxProvider` (fetch `https://www.bnr.ro/nbrfxrates.xml`, parse EUR rate; guarded by env `FX_PROVIDER=bnr`; NEVER selected in tests), `getFxProvider()` selector defaulting `fixed`); Modify `lib/engines/quote-engine.ts` (inputs gain `currency` on pricingLevel/addonPricingRule + optional `fx`; throw `mixed_currency_without_conversion` when addon currency ≠ level currency and no fx given; convert addon→level currency via fx, round 2dp), `lib/tools/handlers/quote-handlers.ts` (load currencies, obtain fx when needed, freeze `{rate,date,source}` into ratingInputs.fx), `lib/engines/pricing-examples.ts` (accept fx input; derive uses same conversion); Tests: `__tests__/lib/engines/fx.test.ts` (fixed provider; BNR XML parser against a fixture string), quote-engine currency tests.

- [ ] Failing engine tests: same-currency sum unchanged; EUR addon + RON level without fx → throws; with `fx:{rate:5}` → `base + round(addon*5)`; fx echoed into result for freezing.
- [ ] Full suite; commit: `feat(fx): currency guard + pluggable BNR/fixed FX reference; rate frozen into the rating snapshot (T18)`

### P4.3 (T17): addon rate card reseeded in true denomination (EUR)

**Files:** Modify `prisma/seeds/seed-product.ts` (AddonPricingRule `currency: 'EUR'`, values stay 200/350/500/700 — now EUR/year), update pinned tests: `__tests__/lib/engines/quote-engine.test.ts`, `__tests__/lib/engines/pricing-examples.test.ts`, `__tests__/helpers/test-db.ts:184`? (issueTestQuote fixture premium is arbitrary — leave), `__tests__/lib/chat/context-loaders.test.ts` (arbitrary fixtures — leave), any sim assertion pinning 540 (grep `540` in `scripts/sims/` + `__tests__` — export fixtures are recorded conversations: leave them, they're replay style-assertions not premium pins; confirm `recorded-behavior.spec.test.ts` doesn't pin premiums).

- [ ] Failing test updates FIRST: quote-engine tests now expect e.g. age 40, fx 5.0 → `190 + 350*5 = 1940`; pricing-examples expectations recomputed with the fixed fx.
- [ ] Reseed dev DB (`npx prisma db seed` — idempotent upserts) after implementation.
- [ ] REPORT FLAGS: (a) verify against the actual Allianz tariff sheet; (b) authored positioning ("abonament de streaming" framing in seed-product-content.ts) breaks at ~162 lei/month with EUR rates — content revision is a business decision, NOT changed by this task; (c) `Product.pricingExampleGrid` output values shift accordingly (derived, auto-propagates).
- [ ] Full suite; commit: `fix(pricing): addon rate card seeded in its true denomination (EUR); premiums via FX conversion (T17)`

---

## Phase 5 — identity & onboarding redesign

### P5.1 (T28): slim early identity

**Files:** Modify `prisma/seeds/seed-questions.ts` (delete DNT_CNP block :184-198; check `seed-dependency-edges.ts` for edges referencing it — remove), `lib/tools/handlers/dnt-handlers.ts` (CNP special-cases become dead — remove masked-prefill :239-244, checksum branch :379-381, profile mirror :407-411; keep validateAnswer generic), `lib/engines/identity-requirements.ts` (`generate_quote.anyDeclaredOf: ['cnp','dateOfBirth','declaredAge']`), `lib/engines/identity-rules.ts` (tier ladder: `verified_channel` = email+phone fields present + ≥1 consumed challenge; `declared` = email+phone present; CNP/name/DOB no longer gate tiers pre-acceptance), `lib/engines/identity-requirements.ts` `KYC_FIELDS` → `['email','phone']`, `lib/tools/handlers/data-handlers.ts` `FIELD_ORDER` → `['email','phone']` (+ keep declaredAge/name/cnp/dateOfBirth SETTABLE but not in the collection ladder), reconciliation: `lib/identity/document-pipeline.ts` — after extraction, if quote exists with `ratingInputs.ageUsed` and extracted DOB → different age band (reuse band matching) → finding `age_band_mismatch` → DOCUMENT_REVIEW WorkItem (existing mechanism); Tests: update the many integration tests pinning `declared:cnp_or_dateOfBirth` and tier derivation (`generate-quote-commit.test.ts:46`, identity tests) — failing-first on the NEW contracts.

- [ ] Failing tests: quote gate satisfied by `declaredAge` alone; tier `verified_channel` reachable with email+phone+challenge only; DNT question list has no DNT_CNP (seed count updated); document-pipeline band-mismatch → WorkItem.
- [ ] Full suite + `scripts/verify-identity-flow.ts` + `verify-dnt-flow.ts`; commit: `feat(identity): data minimization — CNP never asked by mouth; declared age rates the quote; pre-acceptance collection = phone+email; band mismatch reconciles at document extraction (T28)`

### P5.2 (T26): account creation at email verification + returning-user OTP re-auth

**Files:** Modify `lib/tools/handlers/identity-handlers.ts` (confirm success → find-or-create `User {role:'CUSTOMER', customerId, email}` + `customer.isAnonymous=false` inside context.db tx), `app/api/session/route.ts` (resume of a customer that has a linked User → respond `{status:'reauth_required', maskedEmail}` WITHOUT extending the session; add `POST /api/session/reauth` route dir: `start` issues challenge to the account email, `confirm {code}` verifies via `confirmByCode` → responds `{customerId}` + re-sets cookie; `POST /api/session {fresh:true}` → always new anonymous customer), `app/chat/page.tsx` (handle reauth_required → minimal OTP prompt component `components/chat/session-reauth.tsx`; decline → fresh); Tests: integration `__tests__/integration/account-creation.test.ts`, `__tests__/integration/session-reauth.test.ts` (route handlers invoked directly with NextRequest — pattern exists in `auth-verify.test.ts`).

- [ ] Failing tests: confirm_channel_verification creates User + flips isAnonymous; /api/session on an account-holder cookie returns reauth_required (never silently resumes); reauth confirm rebinds; `fresh:true` mints anonymous.
- [ ] Full suite; commit: `feat(auth): real account born at email verification; returning account-holders re-auth via OTP, never silent resume (T26)`

### P5.3 (T27): ID upload front-loaded after email verification

**Files:** Modify `lib/tools/handlers/identity-handlers.ts` (confirm_channel_verification success result gains `_autoChain: {tool:'request_document_upload', args:{kind:'id_card'}}` when product requires id_card and none validated → upload card rides the OTP-confirm commit) + `_message`: `'Channel verified and the ID-upload card is already shown — the document completes the profile (name/DOB/CNP) automatically; do NOT ask for those by mouth.'`; document-pipeline already writes verified fields + conflicts (recon §6) — extend `COMPARED_FIELDS` handling: extracted `address` too if provider returns it (skip — mock returns empty; keep name/cnp/dateOfBirth); Tests: integration `__tests__/integration/id-upload-frontload.test.ts` (confirm → upload uiAction present; simulated upload via `processDocument` + `setMockExtraction({name, cnp, dateOfBirth})` → CustomerProfileField provenance verified + conflict slot on mismatch — much already covered by identity-flow tests; the NEW assertions are the auto-chain + message).

- [ ] Failing test; implement; full suite + `verify-identity-flow.ts`; commit: `feat(identity): ID upload front-loaded at verification — payment moment stays frictionless (T27)`

### P5.4 (T21): document access + navigation + resume-by-default

**Files:** Modify `app/api/documents/[documentId]/route.ts` (accept `zeno_session` for owned docs — `doc.customerId === sessionCustomerId` — and STATIC_PER_PRODUCT_VERSION; keep zeno_auth paths), `app/chat/page.tsx` + `app/api/session/route.ts` (response gains `activeConversationId` = latest ACTIVE conversation for the customer; chat entry resumes it, `?new=1` forces create; add a small "Conversație nouă" affordance in chat header `components/chat/chat-page.tsx`), `app/chat/[id]/page.tsx` (id that isn't a conversation → `redirect('/chat')` instead of notFound — kills the back-nav /chat/<documentId> 404), AcceptanceCard links already target=_blank (P2.9); Tests: integration `__tests__/integration/document-access.test.ts` (session-cookie GET owned doc 200; foreign doc 403; static doc 200; no cookie 401), `__tests__/integration/chat-resume.test.ts` (session response carries activeConversationId; none → null).

- [ ] Failing tests; implement; full suite; commit: `fix(documents+nav): disclosure docs readable by the chat session that owns them; /chat resumes by default; stray /chat/<id> redirects (T21)`

### P5.5 (T25): customer document library

**Files:** Modify `app/dashboard/(protected)/documents/page.tsx` (list BOTH registry `Document` rows for the customer (owned + product-static IPID/TERMS versions the customer acknowledged — join `DisclosureAck`) AND `CustomerDocument` uploads; group by product/application; open-in-viewer links `/api/documents/<id>` target=_blank; uploads: add `GET /api/documents/uploads/[id]` serving decrypted bytes under zeno_session/zeno_auth owner check — the recon found uploads have NO read route); Tests: integration `__tests__/integration/document-library.test.ts` (uploads route: owner 200 with correct content-type, foreign 403), page query helper unit test.

- [ ] Failing tests; implement; full suite; commit: `feat(account): document library — every signed/acknowledged/uploaded artifact listed and viewable (T25)`

### P5.6 (T6): DNT facts promoted to profile/insights

**Files:** Modify `lib/tools/handlers/dnt-handlers.ts` (sign_dnt: after consents, promote session answers via new `lib/customer/dnt-promotion.ts`), Create `lib/customer/dnt-promotion.ts` with the rule table; Modify `lib/customer/profile-service.ts` `ProfileFieldName` union += `'occupation'|'familySize'|'minorChildren'|'education'|'incomeSource'`; insights: upsert `occupation` (string), `familySize` (map `'5+'→'5'` — validateInsightValue takes numbers only), `hasChildren` (`minorChildren > 0`), source = conversationId, confidence 0.9 (declared); Tests: unit `__tests__/lib/customer/dnt-promotion.test.ts` (mapping table incl. '5+' normalization), integration extension of a sign_dnt test asserting CustomerProfileField rows `{provenance:'declared', source:'dnt'}` + insights.

- [ ] Failing tests; implement (inside context.db tx, non-fatal try/catch like the CNP mirror precedent); full suite; commit: `feat(profile): DNT facts promoted to durable profile fields + insights at signature (T6)`

---

## Phase 6 — infra

### P6.1 (T24): Stripe test-mode recipe + payment-recovery sim

**Files:** Create `docs/payments/stripe-test-mode-recipe.md` (stripe listen --forward-to localhost:3001/api/webhooks/stripe; STRIPE_WEBHOOK_SECRET from CLI output; PAYMENT_PROVIDER=stripe + test keys; drive a REAL PaymentIntent through the chat funnel then use test cards 4242…/4000…9995 (decline)/4000…3155 (3DS); note `stripe trigger` limitation: triggered events carry foreign paymentIntent ids → `unmatched_payment` ALERT_FLAG by design; 3DS redirect returns now work via the GET paymentId param from P2.2); Create `scripts/verify-payment-recovery.ts` (scripted sim over MOCK inbox: fail first installment via `settlePaymentEvent(payment_failed)` → assert Installment FAILED + recoveryMode 'retried' via deriveSchedulePosition → `ensure_payment_session` supersedes → succeed → Policy minted; success/failure/retry per the task); Tests: the script IS the runtime verification; add unit test only if new pure logic emerges.

- [ ] Write recipe; write script; run it green (dev DB); full suite; commit: `feat(payments): Stripe test-mode recipe + scripted failure/retry recovery sim (T24)`

---

## Close-out (no code tasks)

1. **Full-funnel sim**: `npm run sims:spec` (happy-path + dnt-card-flow + verification-typed-code at minimum). Expect adjustments to `scripts/sims/run-spec-sims.ts` drain/answer maps for the NEW cards (`show_dnt_review`, `show_medical_batch`, `show_medical_review`, `show_acceptance`, `show_otp_entry`, `show_document_upload`) — the sim must click them like a customer (extend `getDeterministicResponse`-style handling in `drain`). Budget one commit: `test(sims): spec sims drive the new card family end-to-end`.
2. **Browser pass** (preview tools, zeno-dev :3001): full sale — discovery → DNT cards+sign card → application/coverage → medical batch card → sign card → quote card → acceptance (OTP via `/api/dev/last-verification-email`, ID upload card with any small image) → frequency+ack → mock payment → `payment_complete` narration → Policy row in DB. Screenshot proof at the quote, acceptance, and payment-success moments.
3. **Evidence capture BEFORE reset**: `npx tsx scripts/diagnose-conversation.ts cmrm3fgku00056g0y4eb2hsme --json > backups/diagnose-cmrm3fgku-post-ratchets.json` (verify new checks fire at turns 54/58/88+90/92); `docker exec zeno-db-1 pg_dump -U zeno -Fc zeno > backups/zeno-post-live-test-2026-07-15.dump`.
4. **Reset**: `npx prisma migrate reset --force` on dev DB (pre-consented) + `npx prisma db seed` (or seed via reset hook) → `npx prisma migrate status` clean; confirm gpt-5.6-sol is the seeded main-chat model (P0.2 makes reseed-safe).
5. **Smoke**: dev server up (`preview_start zeno-dev`), one fresh conversation first turn end-to-end (greeting varies, no template), DB rows written (Message, TurnDebug).
6. **Report**: `docs/plans/2026-07-15-implementation-report.md` — per-task commit hashes, test counts, sim results, flagged decisions (T2 placeholder pricing, T17 tariff-sheet verification + positioning break, T4 root-cause reframe, T19/T8 ordering deviation, gui-confirmed gateway ruling, T30 ratchet reframe, /api/chat auth posture), new findings for the next session.

## Self-review notes

- Spec coverage: all of T2-T30 mapped (T12→P1.1+P2.3..P2.6 construction; T8→P1.2+P3.3).
- Type consistency: `questionCard`/`CONDUCT_LINE` names used consistently across P2.3-P2.6; `_autoChain` defined P3.3, consumed P3.4/P5.3; `ratingInputs` defined P4.1, consumed P4.2/P5.1.
- Single migration risk: P3.3 creates `live_test_hardening`; P4.1 adds Quote.ratingInputs — if P3.3's migration is already applied, P4.1 creates its own (`quote_rating_inputs`). Both on the baseline_main+v3_upgrade chain.
