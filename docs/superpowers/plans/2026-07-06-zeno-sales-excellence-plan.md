# Zeno Sales-Agent Excellence Plan

**Date:** 2026-07-06
**Basis:** codebase analysis + evidence-first diagnosis of conversation `cmr9a5zxx004whk0elbifvvvm` (laptop acceptance test, 44 turns, quote issued → died at channel verification). All findings verified against TurnDebug/CommitLedger rows, not prose.
**Branch context:** zeno-v3-fable. Every task follows TDD (failing test first), one logical change per commit, suite green before push.

## North star

A returning customer should feel *remembered* ("Știu că te interesa pachetul Optim — rămânem pe el?"), a struggling tool should be *explained* ("ceva n-a mers la noi — reîncerc sau te preiau un coleg"), and every structured step (DNT, questionnaire, verification) should be *one tap*, never a typing exercise. Everything below serves those three sentences.

## Verified defect inventory this plan addresses

| # | Defect | Evidence |
|---|--------|----------|
| D1 | DNT questions have **no UI** — options rendered as prose, answers typed, LLM transcribes them into `write_dnt_answer` (fabrication risk class; P0-1 in readiness report) | conv turns #9–#30; `components/chat/rich/` has no DNT card |
| D2 | `questionnaireContext` loader dead — `workflowStepCode` hardcoded `null` → context-hit "DO NOT RE-ASK" block never renders | `lib/chat/context-loaders.ts:908`, early-return at `:461` |
| D3 | No PREFERENCE insight keys exist; extractor captured only 2 insights from an 18-min conversation; tier/addon/budget preferences never stored | `lib/insights/keys.ts:11-23`; CustomerInsight rows for `cmr9a5zwy004vhk0eoqbj1t3n` |
| D4 | Insight values persisted with zero type/range validation (`age=0` class) | `lib/insights/extractor.ts:85,98` |
| D5 | Verification endgame kills sales: `nextBestAction="call set_candidate_product"` while quote ISSUED + pendingChallenge; model re-sends code (invalidating the old one) instead of calling exposed `confirm_channel_verification`; hallucinated "name missing" | TurnDebug mi=84/86/88; ledger 14:08:36 + 14:09:33; `verification-service.ts:50` |
| D6 | No code visibility locally (mock email prints subject to *server* terminal only; link only in unprinted HTML; APP_URL defaults to port 3000, dev runs 3001) | `lib/email/providers/mock.ts:29`, `verification-service.ts:66` |
| D7 | Sims bypass verification via DB world-hook (`consumedAt` flipped directly) → typed-code path has zero coverage | `scripts/sims/run-spec-sims.ts:117-123` |
| D8 | Tool failures reach the model as raw strings; no post-confirmation-failure guidance; no loop-breaker | `lib/chat/tool-result-serializer.ts:9-21`, seed prompt rule |
| D9 | `TurnDebug.messageIndex` shifted +2 vs message array — misattributes every turn in diagnosis | ledger-vs-TurnDebug cross-check this session |
| D10 | Compliance LLM judge fires state-blind false positives on every turn (26/26 turns flagged post-#38 despite signed consent in ledger); language flip-flops | checker output for the conversation |
| D11 | CNP plaintext in DNT facts and in every persisted legality snapshot inside TurnDebug | TurnDebug payloads, mi=84+ |
| D12 | Self-improvement loop scores funnel/cost only — blind to re-asks, unexplained errors, memory quality | `lib/self-improvement/*` |

---

## Phase 1 — Stop losing closed sales (funnel-critical)

### Task 1.1 — Verification endgame becomes first-class engine state (D5)

**Change**
- `lib/engines/derive-and-expose.ts`: when `identity.pendingChallenge !== null` and quote is ISSUED/blocked on `requires_identity`:
  - `nextBestAction` → `confirm_channel_verification` (never `set_candidate_product` while a quote is ISSUED).
  - Block `start_channel_verification` with reason `verification_already_pending` while an unconsumed, unexpired challenge exists for the same target (allow only with explicit `resend: true` arg).
- `lib/chat/phase-sections-map.ts` situational briefing: render `Verification: code sent via email to m***@…, awaiting 6-digit code. When the customer supplies digits, call confirm_channel_verification with them. Do NOT resend unless asked.`

**Test first** (`__tests__/lib/engines/verification-exposure.test.ts`)
```ts
it('pending challenge → nextBestAction is confirm_channel_verification', async () => {
  const state = deriveWithFixture({ quote: issued(), identity: { pendingChallenge: { channel: 'email' } } })
  expect(state.nextBestAction).toBe('call confirm_channel_verification')
})
it('start_channel_verification blocked while challenge pending (no resend flag)', async () => {
  const exposure = exposeWithFixture({ identity: { pendingChallenge: { channel: 'email' } } })
  expect(exposure.blocked).toContainEqual(expect.objectContaining({ action: 'start_channel_verification', reason: 'verification_already_pending' }))
})
```
Negative test: `confirm_channel_verification` with wrong code → envelope carries `attemptsRemaining`, outcome `rejected`, and the briefing next turn says attempts remaining.

**Acceptance:** replay of the recorded conversation shape (digits typed while challenge pending) can no longer produce a `start_channel_verification` re-send; `attemptsRemaining` decrements on wrong code.

### Task 1.2 — Wake the questionnaire context + context hits (D2)

**Change**
- Map phase/subphase → `workflowStepCode` (APPLICATION/QUESTIONNAIRE → `application_fill`, APPLICATION/DNT → `dnt_questionnaire`) and thread it into `loadQuestionnaireContext` (orchestrator patches the section from DerivedStateV3, same pattern as the dntContext fix #1/#2 from 2026-07-06). Delete the hardcoded `null` at `context-loaders.ts:908`.

**Test first** (extend `__tests__/lib/chat/context-loaders.context-hit.test.ts` + new orchestrator-level test)
```ts
it('APPLICATION/QUESTIONNAIRE turn includes questionnaireContext with current question', async () => {
  const sections = await assembleSectionsForFixture({ phase: 'APPLICATION', subphase: 'QUESTIONNAIRE' })
  expect(sections.questionnaireContext).toContain('CURRENT QUESTION')
})
it('stored preference matching current question renders CONTEXT HIT block', ...)
```
The existing direct-call test proves the mechanism; the new test must fail against today's orchestrator wiring before the fix.

**Acceptance:** in a live sim, when an insight matches the current question, the agent's reply references the known value instead of re-asking (assert on the context-hit block presence in TurnDebug prompt sections + judge check on phrasing).

### Task 1.3 — Tool-failure protocol: structured errors + loop-breaker (D8)

**Change** (three commits, one logical change each)
1. `lib/tools/executor.ts`/`gateway.ts`: every failure result carries `errorCode` (`transient | precondition | validation | permanent`) and `retryable: boolean`; `tool-result-serializer.ts` includes them.
2. Seed prompt (`prisma/seeds/seed-agents.ts`): failure protocol — *"If a confirmed action fails: apologize, say plainly something went wrong on our side (no tool names/codes), offer retry or human handoff. Never silently re-issue a confirmation."*
3. `lib/chat/orchestrator.ts`: same tool + same `argsHash` failing 3× in a conversation → tool enters blocked list with reason `repeated_failure`; briefing instructs explain-and-escalate.

**Test first**
```ts
it('serializes errorCode and retryable for failed commits', ...)
it('third identical failure blocks the tool with repeated_failure', async () => {
  await failTool('sign_dnt', args, 3)
  const exposure = await deriveExposure(conversationId)
  expect(exposure.blocked).toContainEqual(expect.objectContaining({ action: 'sign_dnt', reason: 'repeated_failure' }))
})
```
Plus diagnostics escalation: `confirm_token_reissued` count ≥3 for one argsHash → `error` severity finding (ratchet, test-first in `lib/diagnostics/`).

---

## Phase 2 — DNT gets real UI (D1) — the user's headline requirement

DNT questions already carry card-ready metadata (`dnt-handlers.ts:127,175,247,364`: `{ id, code, text{en,ro}, type, options, validationRules }`). Reuse the `QuestionCard` machinery (`components/chat/rich/question-card.tsx` + `rich-content.tsx` mapping + GUI action → `/api/chat` actor `gui`).

### Task 2.1 — Render a DntQuestionCard from tool results

- `rich-content.tsx`: map `open_dnt_session` / `write_dnt_answer` results carrying a `next` question → `<QuestionCard>` (or thin `DntQuestionCard` wrapper) with progress from `sessionAnswered/sessionTotal`.
- Option buttons for enum/boolean questions (DA/NU, family size, education...); text input with client-side checksum hint for `DNT_CNP` (server-side checksum already enforced at `dnt-handlers.ts:331` — keep it, DTO is the boundary).
- Card answer posts GUI action `{ type: 'answer_dnt', payload: { questionCode, value } }` → tool invocation `write_dnt_answer` with **actor `gui`** and the exact `questionCode` from the card (kills the LLM-transcription fabrication class deterministically — same rationale as C1.9 for questionnaire cards).

**Test first**
- Component test: boolean/enum DNT question renders buttons; click fires action with exact `questionCode` + option `value` (not label).
- Integration (`__tests__/integration/dnt-gui-answers.test.ts`): GUI-actor `write_dnt_answer` with valid option → `applied`; **negative:** value not in options → `rejected` envelope, nothing persisted; stale `questionCode` (not the pending one) → rejected with the existing "current unanswered question is X" error.

### Task 2.2 — Prompt: agent narrates, card collects

- `dntContext` (`context-loaders.ts:814-833`): when a card is on screen, instruct: do not enumerate options in prose; invite the customer to tap; if the customer *types* an answer anyway, map it to the exact option value (never pass raw free text — fixes the "da sunt sanatos" rejection loop pattern).

**Test:** prompt-section snapshot test + sim scenario `dnt-card-flow`: persona answers via GUI actions; assert 11/11 DNT answers land with actor `gui`, zero `write_dnt_answer` calls from actor `agent`, agent text contains no "Opțiuni:" enumeration.

### Task 2.3 — Typed-fallback parity

Customers on flaky UIs will still type. Keep `write_dnt_answer` exposed to the agent, but the answer normalization from 2.2 + existing `validateAnswer` covers it. Sim variant: persona types answers → same final DNT facts as card path (property: card path and typed path converge to identical `dnt.facts`).

---

## Phase 3 — Memory worth bragging about (D3, D4)

### Task 3.1 — Preference vocabulary (D3)

- `lib/insights/keys.ts`: add PREFERENCE keys — `preferredTier` (enum, from product tiers), `preferredLevel`, `addonInterest` (string), `budgetSensitivity` (enum low/medium/high), `preferredPaymentFrequency`. Wire product-specific option lists via `Product.insightKeys` where tiers are product-defined.
- Extractor prompt: include the new keys with allowed options.

**Test first:** extractor unit test — message "vreau varianta Standard, ceva ieftin" with mocked gateway response → `preferredTier=standard`, `budgetSensitivity=high` persisted; message with no preference → no PREFERENCE rows.

### Task 3.2 — Validation before persistence (D4)

- `lib/insights/extractor.ts`: enforce declared `type` from the key spec before `String(item.value)`:
  - number → `Number.isFinite`, per-key ranges (`age` 18–120, `familySize` 1–20); reject 0/negatives where nonsensical.
  - enum → value ∈ options. boolean → strict true/false.
  - Rejected values: `logWarn` + skip (never persist), count surfaced as `insight_rejected` anomaly.
- Extractor prompt: add "omit a fact entirely if not explicitly stated; never emit 0/unknown placeholders."
- Same guard in `lib/tools/handlers/insight-bump.ts`.

**Test first:**
```ts
it('rejects age=0 from extractor response', async () => {
  mockGateway({ insights: [{ key: 'age', value: 0, confidence: 0.9 }] })
  await extractAndPersistInsights(input)
  expect(await prisma.customerInsight.findFirst({ where: { key: 'age' } })).toBeNull()
})
```
Plus: `familySize=-1`, enum out-of-options, boolean `"yes"` → all rejected; valid `age=40` persists.

### Task 3.3 — Memory survives the phase transition

- `lib/chat/phase-sections-map.ts`: include `customerMemory` (at minimum PREFERENCE + RISK_FACTOR categories) in APPLICATION and QUOTE phases, not just DISCOVERY. Keep token cap; prioritize PREFERENCE rows and freshest `lastConfirmedAt`.

**Test:** prompt-builder test — APPLICATION-phase assembly contains the returning-customer block when insights exist; fast-path (<30 char answers) still excludes it (assert unchanged) so questionnaire latency doesn't regress.

**Acceptance for Phase 3 (the "Optim" moment, end-to-end sim):** discovery turn "ma intereseaza pachetul Optim" → later questionnaire tier question → agent output references Optim and offers confirm/change, and `write_question_answer` receives the confirmed value. This is the flagship scenario; gate the phase on it.

---

## Phase 4 — Local dev + sim honesty for verification (D6, D7)

### Task 4.1 — Code visibility in dev

- `MockEmailProvider.send`: print the full OTP line explicitly (`[MockEmail] CODE: 483920  LINK: http://…/api/auth/verify?token=…`) — parse-free for humans and harnesses. Persist last send per customer to a dev-only seam (existing `__lastMockEmail` global stays for in-process tests; add `GET /api/dev/last-verification-email?customerId=` guarded by `NODE_ENV !== 'production'`).
- `verification-service.ts:66`: derive link base from request/env consistently; document `APP_URL=http://localhost:3001` in `.env.example` (dev runs on 3001).

**Test:** unit — mock provider output contains code + link; dev endpoint returns 404 in production mode (negative), payload in dev.

### Task 4.2 — Sims stop cheating (D7)

- `scripts/sims/run-spec-sims.ts`: keep the link-click world hook but make it *honest* — fetch `linkToken` from DB and `GET /api/auth/verify?token=…` over HTTP instead of flipping `consumedAt` directly.
- New scenario `verification-typed-code`: world hook disabled; harness reads the code from the dev seam (4.1) and the persona types it; assert `confirm_channel_verification` called by the agent with the code, challenge consumed, `accept_quote` becomes exposed.

**Ratchet (test-first, `lib/diagnostics/`):**
- `verification_code_ignored` — digit-only user message while `pendingChallenge` exists and no `confirm_channel_verification` call that turn → error.
- `challenge_resent_while_pending` — second `start_channel_verification` within TTL without customer resend request → warn.
- `known_field_reasked` — `collect_customer_field` idempotent replay for an already-recorded field → warn.

---

## Phase 5 — Trustworthy observability (D9, D10, D11, D12)

### Task 5.1 — Fix `TurnDebug.messageIndex` (+2) (D9)
Persist the index of the *user message that started the turn*. Migration note in the diagnose skill; update `scripts/diagnose-conversation.ts` turn labels. Test: orchestrator integration — TurnDebug row for a turn has `messageIndex === userMessageIndex`, and diagnose output cross-references the transcript correctly on a fixture export.

### Task 5.2 — Ground the compliance judge (D10)
Feed it the recorded facts (consent signed at, AI disclosure done, DNT completed, needs-analysis rows) alongside the window; deterministically suppress findings the ledger disproves; run at phase transitions instead of every turn; pin output language to the conversation language. Test: fixture where consent is signed → judge cannot emit "GDPR consent missing" (suppressed with reason), plus latency budget assertion (no per-turn judge calls in QUESTIONNAIRE).

### Task 5.3 — Retire false-positive anomalies
Replace "LLM retry detected" call-count heuristic with explicit `llm:call:retry` events (P1-9); fix `get_next_question` partition classification so `missing_consequences` stops firing on it. Tests: tool-calling turn with 2 normal rounds emits zero retry anomalies; genuine retry emits one.

### Task 5.4 — CNP hygiene (D11)
Encrypt CNP at rest in `DntAnswer.value` (AES envelope like the profile mirror); redact CNP-shaped values in legality snapshots before TurnDebug persist; one-off backfill script for existing rows. Tests: write CNP → DntAnswer holds envelope not plaintext; TurnDebug snapshot for the turn contains `***` mask; eligibility facts still derive age/residency (decrypt path).

### Task 5.5 — Score what we now care about (D12)
`ConversationScore` gains: `reaskedKnownFactCount`, `unexplainedToolErrorCount`, `insightRejectedCount`, `verificationCompleted`. Computed from ledger + diagnostics findings at scoring time; analyzer surfaces regressions. Test: fixture conversation (the diagnosed one exported) scores `reaskedKnownFactCount ≥ 1`, `verificationCompleted = false`.

---

## Sequencing & verification gates

```
Phase 1 (1.1 → 1.2 → 1.3)   — unblocks revenue; smallest diffs, biggest funnel effect
Phase 2 (2.1 → 2.2 → 2.3)   — DNT UI; depends on nothing in Phase 1
Phase 3 (3.1 → 3.2 → 3.3)   — memory; 3.3 depends on 1.2 for the flagship sim
Phase 4 (4.1 → 4.2)         — must land before Phase 1 can claim end-to-end proof
Phase 5 (any order)          — 5.1 first (it corrects the measuring stick)
```

**Definition of done per task:** failing test written first and shown failing → implementation → suite green (`npm test`) → relevant spec-sim green → for UI tasks, manual acceptance on the laptop (dev on 3001) with screenshot/console proof. Never merge on "build succeeds."

**Global exit criterion:** re-run the full spec-sim battery + the two new verification scenarios; run `npx tsx scripts/diagnose-conversation.ts --all --since=1` on the sim batch — zero `error`-severity findings, no `verification_code_ignored`, no `known_field_reasked`; happy-path completes DNT (11/11 via cards) → questionnaire (context hits firing) → quote → typed-code verification → accept.
