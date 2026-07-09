# Zeno Autonomy, Skills & Prompt-Cost Plan

**Date:** 2026-07-06
**Basis:** architecture analysis of the prompt pipeline (`lib/chat/prompt-builder.ts`, `lib/chat/orchestrator.ts` steps 3–7, `lib/engines/derive-and-expose.ts`), the SkillPack v1 post-mortem (`docs/superpowers/notes/2026-06-zeno-dead-config-salvage-audit.md`), the A4 section inventory (`docs/superpowers/notes/2026-06-zeno-prompt-section-inventory.md`), and the D5 verification-endgame evidence from conversation `cmr9a5zxx004whk0elbifvvvm`.
**Relationship to the sales-excellence plan (same date):** that plan is funnel-critical and lands FIRST. This plan consumes two of its outputs (structured tool errors from its Task 1.3, the verification sim scenarios from its Task 4.2) and must never block it. Cross-references below use SE-x.y.
**Discipline:** every task follows TDD (failing test first), one logical change per commit, suite green before push, pathology/spec-sim gates as stated per task. Engine changes bump `engineVersion` (`derive-and-expose.ts:91` rule: any change to `derivePhase`, `ACTION_RULES`, or `NEXT_BEST_PRIORITY`). Prompt-content moves follow the A4 method: inventory every rule with a destination or a "retired because X" note, pathology baseline before, identical verdicts after.

## North star

The engine stays the wall (what is *legal*); the model gets back the plan (what is *smart*). Concretely: guidance becomes informative instead of imperative, the choreography script shrinks as tool envelopes become self-describing, the always-on prompt halves by phase-scoping, skills become versioned admin-managed content with deterministic selection, and every turn's cost is measured before and after. Autonomy is a budget raised only when sims prove the model earns it.

## Findings this plan addresses

| # | Finding | Evidence |
|---|---------|----------|
| F1 | `nextBestAction` is imperative ("call X") and the model obeys it even when the engine is wrong — engine bugs become agent bugs | D5: `set_candidate_product` hint while quote ISSUED + pendingChallenge; model re-sent the code instead of confirming |
| F2 | ADVANCING TO THE OFFER (~1,100 tok) scripts the exact tool chain in prose that the engine already enforces as exposure rules — redundant armor, brittle to every new tool | `prisma/seeds/seed-agents.ts:96-103` vs `ACTION_RULES` orderings |
| F3 | The dynamic suffix sits BEFORE conversation history in the messages array, so prefix caching stops at message 2 — the whole history is re-billed at full input price every turn | `orchestrator.ts:713-726` |
| F4 | Per-turn tool list churn (`buildTurnTools(exposure.actions)`) busts the provider cache above the system prompt on both providers | `orchestrator.ts:746`; OpenAI/Anthropic cache hierarchies put tools before system |
| F5 | ~50% of the 5k-token identity prompt is phase- or turn-shaped (discovery guardrails ~1.6k, advance choreography ~1.1k, first-turn ~170) but ships on every turn, including high-volume questionnaire turns where it is noise and pathology surface | subsection measurement 2026-07-06 |
| F6 | Prompt-content changes (failure protocol, card narration rules, compliance phrasing) require code edit + reseed + deploy; the self-improvement proposer has no granular, safe unit of change since SkillPack v1 was deleted | `lib/self-improvement/proposer.ts`; A5 deletion |
| F7 | The agent is purely reactive — no persisted conversation strategy; a returning or multi-turn customer gets fact recall (at best) but no strategy continuity | no plan surface anywhere in `lib/chat/` |
| F8 | No per-turn cache/cost telemetry is persisted, so none of the above can be verified quantitatively | `gateway.ts` parses cacheRead/cacheWrite but drops them after the event |

---

## Workstream A — Measure first (instrumentation + baselines)

Cheap, zero behavior change, unblocks honest verification of every other workstream. Land before anything else.

### Task A1 — Persist cache + prompt-cost telemetry per turn (F8)

**Change**
- `lib/llm/gateway.ts`: the already-parsed `{ cacheRead, cacheWrite, cacheHit }` plus `promptTokens`/`completionTokens` flow into the `llm:usage` event AND into the TurnDebug payload for the main call (extend the `debug:prompt` or a new `debug:usage` record — reuse `recordDebugEvent`).
- `lib/chat/orchestrator.ts` `debug:prompt`: split `totalChars` into `stablePrefixChars` / `dynamicSuffixChars` / `toolDefChars` (toolDefs are already serialized for the token budget at step 4b).
- `prisma/schema.prisma` `ConversationScore`: add `avgCacheHitRate Float?`, `totalPromptTokens Int?`, `totalCachedTokens Int?` computed at scoring time from TurnDebug rows (same pattern as SE-5.5's new counters).

**Test first**
```ts
it('main-call TurnDebug row carries cacheRead/cacheWrite and prompt char split', ...)
it('scorer aggregates cache hit rate from TurnDebug usage rows', ...)
```

**Acceptance:** `npx tsx scripts/diagnose-conversation.ts <id>` (or the debug console turn card) shows, for every turn: prompt tokens, cached tokens, cache hit yes/no, stable/dynamic/tool char split.

### Task A2 — Baseline report script

**Change** — `scripts/measure-prompt-cost.ts`: sweep TurnDebug rows for the last N conversations; output per-phase averages: tokens/turn, cache-hit rate, uncached-history tokens/turn, identity-block share. Write the verbatim output into `docs/superpowers/notes/2026-07-XX-prompt-cost-baseline.md` (the A4-style before/after discipline, criterion a).

**Acceptance:** a committed baseline note with real numbers from at least 5 recent conversations (the diagnosed 44-turn conversation included). Every later workstream cites this file in its after-measurement.

### Task A3 — Behavior baseline

Run and record verbatim (same note): `verify-pathology1..4`, `verify-advance-flow`, the spec-sim battery. This is the criterion-a gate the A4 rework used; B/C/E may not start until it is ALL CLEAN.

---

## Workstream B — Guidance flip: imperative → informative (F1)

The D5 *class* fix. SE-1.1 fixes the specific engine bug (pendingChallenge → correct nextBestAction); this workstream removes the "model blindly obeys the hint" failure mode itself.

### Task B1 — `nextBestAction` becomes a funnel objective + preconditions, not a command

**Change**
- `lib/engines/derive-and-expose.ts`: keep `NEXT_BEST_PRIORITY` as the objective ladder, but derive a structured `objective` alongside the legacy string:
  ```ts
  objective: {
    goal: 'payment' | 'quote_acceptance' | 'quote_generation' | 'application_completion' | 'needs_analysis' | 'discovery',
    achievableNow: string | null,        // the available action that advances it, if any
    missingPreconditions: BlockedAction[] // why the goal's action is blocked, when it is
  }
  ```
  `nextBestAction` stays populated (compat: `DerivedStateV3.nextBestAction` contract at `domain-types.ts:109` unchanged) but is no longer rendered. Bump `engineVersion`.
- `lib/chat/phase-sections-map.ts` `formatDerivedBriefing`: replace `Next best action: call X` with fact-shaped lines:
  - `Open objective: get the quote accepted.`
  - `Achievable now via: accept_quote.` (only when true)
  - `Blocked because: requires_identity (needs: verified_channel). The customer must confirm the emailed code first.`
  - Keep the existing imperative lines that pathologies pin: the pendingConfirmationTools override (P0-5), the blocked-action "NEVER work around" rule, the DNT exact-code rule (2026-07-06 debug report) — each carries a comment naming the pathology that pins it.

**Test first** (`__tests__/lib/engines/objective.test.ts`, extend `phase-sections-map` tests)
```ts
it('quote ISSUED + pendingChallenge → objective quote_acceptance, achievableNow null, missing requires_identity', ...)
it('briefing renders objective facts and never the literal "Next best action: call"', ...)
it('pendingConfirmationTools override still renders (P0-5 pin)', ...)
```

**Sim gate:** `verify-advance-flow` must stay 2/2 and P1–P4 clean. **Known risk:** the informative flip can re-introduce advance stalls (the P2 class). If advance-flow drops, the remedy is ONE narrow imperative line at convergence only (`When the customer agrees to proceed, open the needs analysis now`), not a revert to global "call X" — record the outcome either way in the A2 note.

**Acceptance:** replay the D5 conversation shape — with the engine hint deliberately mis-set in a fixture, the model (fed digits + pendingChallenge facts) calls `confirm_channel_verification`. The hint no longer outranks the facts.

### Task B2 — Imperative-language sweep of the briefing and constitution

Inventory every imperative sentence in `formatDerivedBriefing` + MAIN_CHAT_PROMPT (A4 method: a table, every sentence → keep-because-pinned / rewrite-informative / delete). Rewrites land as one commit per section with the pathology suite re-run. Output table appended to the prompt-section inventory note.

---

## Workstream C — Choreography shrink (F2)

**Depends on:** SE-1.3 (structured `errorCode`/`retryable` envelopes) and benefits from SE-2.x (DNT cards remove the transcription burden). Do not start before SE-1.3 is merged.

### Task C1 — Envelope self-description audit

**Change** — for every commit tool, the success envelope must answer "what just became possible": `sign_dnt` → `data.next: 'set_application is now available'`-class hints; `write_question_answer` already returns next question + `isComplete`; fill the gaps found by a one-pass audit of `lib/tools/handlers/*`. Mechanical: add a `hint` field to `CommitResult.data` where missing; serializer includes it.

**Test first:** per-handler envelope tests asserting the hint fields; one integration test walking DNT→quote purely from envelope hints (no prompt choreography in the fixture system prompt).

### Task C2 — Delete the ADVANCING script in four gated cuts

Each cut = its own commit + `verify-advance-flow` + P1–P4 re-run; a failed gate reverts only that cut.

1. **Cut 1:** the open/write loop narration ("It returns the first question…", "keep calling write_dnt_answer…") — superseded by envelope hints (C1) + exposure.
2. **Cut 2:** the `set_application → select_coverage → write_question_answer → sign_medical_declarations → generate_quote` chain prose — superseded by exposure ordering + `objective.achievableNow` (B1).
3. **Cut 3:** the COMPLETION RULE paragraph — superseded by `isComplete` envelope + objective.
4. **Cut 4 (KEEPS, moved not deleted):** the exact-code discipline ("use EXACT codes from pendingCodes") and the #1-FAILURE rule (never collect personal data in prose — questionnaire tools only) are load-bearing (2026-07-06 debug report; P-class). They MOVE to the DNT/questionnaire sections (`loadDntContext`, `questionnaireContext`) so they ship only on APPLICATION turns — this cut is a move with zero text loss, recorded in the inventory note.

**Acceptance:** MAIN_CHAT_PROMPT loses ≥ 900 tokens; advance-flow 2/2; the `dnt-card-flow` sim (SE-2.2) unchanged; inventory note updated (every deleted sentence has a retired-because-X row).

---

## Workstream D — Cache restructure (F3, F4)

Pure cost, zero intended behavior change. Independent of B/C but touches the same orchestrator region — land as its own PR, rebase around SE work.

### Task D1 — Move per-turn dynamic content behind the history

**Change**
- `lib/chat/orchestrator.ts` step 6: stop emitting the `dynamicSuffix` as a system message before history. New order: `[system stablePrefix (cacheHint)] [system summaryPrefix?] [...windowMessages] [user: dynamic-state envelope + customer message]`. The final user message becomes:
  ```
  [TURN STATE — internal, never quote to the customer]
  <dynamicSuffix>
  [CUSTOMER MESSAGE]
  <input.message>
  ```
  Built fresh each turn (windowMessages come from DB, so past envelopes never accumulate in history). The persisted user Message row stays the raw customer text — the envelope is assembly-time only.
- `lib/llm/providers/anthropic.ts`: support `cacheHint` on the LAST history message (message-level `cache_control` breakpoint), so history reads from cache and each turn writes only the delta. OpenAI needs nothing (automatic prefix caching now covers system + summary + history).
- `summaryPrefix` note: a re-summarization rewrites the prefix and busts the cache once — acceptable, it is rare; record frequency via A1 telemetry.

**Test first**
```ts
it('messages order is stablePrefix, summary?, history..., single user turn carrying TURN STATE + customer text', ...)
it('anthropic request puts cache_control on the last history message', ...)
it('persisted user message contains only the raw customer text', ...)
```

**Sim gate:** full pathology suite + advance-flow (position changes CAN shift behavior — the dynamic content moves closer to the model's answer, which usually *helps* instruction-following, but prove it).

### Task D2 — Tool-list stability (measured experiment, decide with data)

**Change (phase 1 — measure):** A1 telemetry gains `toolListHash` per turn; A2 report adds "tool-list churn within phase" (% of consecutive same-phase turns whose hash differs).
**Change (phase 2 — only if churn > ~20%):** the API `tools` param becomes the PHASE SUPERSET (stable within a phase) while `toolContext.exposedTools` (the executor wall, authoritative since A3.2) keeps the exact per-turn set; the briefing's blocked list already explains the difference to the model. This amends the A3.1 "menu = exposure" invariant — record the deviation the way T6.D3 was recorded, and gate on: executor rejections with reason `not_exposed` do not increase in sims vs baseline.

**Acceptance:** A2 re-run shows history cache-hit ≥ 80% on turns ≥ 3 of same-phase runs, and a quantified %-cost-per-turn drop vs the A2 baseline written into the baseline note (criterion-d style).

---

## Workstream E — Identity split + Skills v2 (F5, F6)

### Task E1 — Split the identity prompt into phase-scoped registry sections

**Change**
- `prisma/seeds/seed-agents.ts`: MAIN_CHAT_PROMPT splits into named constants: `CONSTITUTION_CORE` (identity, core behaviors, tool-use-invisible, answer-first, signal awareness, autonomy, constraints, what-I-cannot-do — target ≈ 2k tok), `FIRST_TURN_RULES`, `DISCOVERY_CONDUCT` (guardrails 1–6 + single-match + product knowledge), `OFFTOPIC_AND_HANDOFF`. Seeded into `Agent.systemPrompt` (core) + new columns or a JSON `promptSections` field on Agent (decide at implementation; JSON avoids a migration per section).
- `lib/chat/prompt-builder.ts` `SECTION_REGISTRY`: new keys `firstTurnRules` (constitution layer, NOT alwaysInclude), `discoveryConduct` (stable layer), `offtopicHandoff` (constitution, alwaysInclude — small and pathology-pinned P4/OOS).
- `lib/chat/phase-sections-map.ts`: `discoveryConduct` → DISCOVERY + QUOTE. `firstTurnRules` → detector-driven: orchestrator includes it via `requiredSections` when `state.messageCount <= 2` (the `detectFastPath` pattern — deterministic, testable).
- Update the prompt-section inventory note: every MAIN_CHAT_PROMPT sentence appears exactly once in the new layout (criterion c).

**Test first:** prompt-builder assembly tests per phase (QUESTIONNAIRE turn contains no discovery guardrails; turn 1 contains firstTurnRules; turn 5 does not); char-budget assertion: always-on constitution ≤ 9KB.

**Sim gate:** the full A4 protocol — P1–P4 + advance-flow + OOS/CAT scenarios baseline (A3) vs after, identical verdicts. P4 and CAT specifically guard the catalog/off-topic behaviors that stay constitution.

**Acceptance:** questionnaire-turn prompt shrinks by ≥ 1.5k tokens vs baseline (A2 measurement); no pathology regression.

### Task E2 — Skill schema + loader + one pilot (dntContext)

Learning from SkillPack v1's death: keyed on live derived state (not modes/workflows), content-only (never tool grants — erratum-1), one-home-per-rule, sim-gated activation.

**Change**
- `prisma/schema.prisma`:
  ```prisma
  model Skill {
    id          String   @id @default(cuid())
    key         String   @unique          // e.g. 'dnt-facilitation'
    selectorType  String                  // 'phase' | 'detector'
    selectorValue String                  // 'APPLICATION/DNT' | 'first_turn'
    activeVersionId String?
    versions    SkillVersion[]
  }
  model SkillVersion {
    id        String  @id @default(cuid())
    skillId   String
    version   Int
    content   String                       // the section text
    status    String                       // draft | tested | active | retired
    testGate  String[]                     // sim script names that must pass
    createdBy String                       // 'admin' | 'self-improvement'
    createdAt DateTime @default(now())
  }
  ```
- `lib/skills/loader.ts`: `loadActiveSkills(phase, subphase, detectors)` → `{ sectionKey: content }`, TTL-cached like `lib/llm/agent-config.ts`, flushed by admin writes. Selection stays 100% deterministic — the loader consumes the SAME phase/detector signals as the section map; no LLM chooses.
- Pilot: the hardcoded `loadDntContext` prose moves to seeded skill `dnt-facilitation` (phase `APPLICATION/DNT`); the loader-sourced content feeds the existing `dntContext` section key. Fallback: loader failure → last-known cache → hardcoded default (never a blank section on a live turn).

**Test first:** loader unit tests (selection, TTL, flush, fallback); integration: APPLICATION/DNT turn renders the seeded skill content; skill row deleted → hardcoded fallback renders.

**Sim gate:** `dnt-card-flow` + P2 (the DNT surface's pathologies).

### Task E3 — Admin Skills page

**Change** — `app/admin/(protected)/skills/`: list by phase/detector; version history; editor for drafts; **Activate** runs the version's `testGate` sims (server action shells to the existing `scripts/sims` runners, streams verdicts) and flips `activeVersionId` only on green; one-click rollback to any prior version (re-point, no delete). Pattern-copy `product-content` (the E1/T11 versioned-authored-content precedent). Preview tab: "assembled prompt for phase X" reusing `buildPrompt` with the draft substituted.

**Test first:** route/component tests for lifecycle transitions (draft→active requires green gate; rollback re-points; a `retired` version cannot activate); authorization (admin-only, same guard as the other protected pages).

### Task E4 — Migrate the remaining phase sections + E1's split sections into skills

One section per commit, each with its section's sims: `questionnaireContext` guidance prose (post SE-1.2 rewiring), `paymentContext`, `policyContext`, then `discoveryConduct` and `firstTurnRules` from E1. `complianceGuidance` stays code-generated (it is computed from checker output, not authored content). End state: `context-loaders.ts` loads DATA (state, progress, facts); skills carry the authored BEHAVIOR prose; the inventory note's "target home" column now names skill keys.

### Task E5 — Self-improvement proposes skill versions

**Change** — `lib/self-improvement/proposer.ts`: proposals target a `skillKey` and produce a DRAFT `SkillVersion` (createdBy `self-improvement`) instead of free-prose suggestions; the existing `app/admin/(protected)/proposals` approval flow links to the skill page where the human runs the gate and activates. `ConversationScore` gains `activeSkillVersions Json` (the per-conversation version map) so the analyzer attributes score movement to skill versions — the honest replacement for the dead `skillPackSlugs` columns (which stay, historical).

**Test first:** proposer emits a draft version row (never active); scorer stamps the version map; analyzer groups scores by skill version.

---

## Workstream F — Plan scratchpad: strategy autonomy (F7)

### Task F1 — `update_sales_plan` tool + storage

**Change**
- `prisma/schema.prisma`: `Conversation.agentPlan String?` (≤ 600 chars, enforced), `agentPlanUpdatedAt DateTime?`.
- New tool `update_sales_plan` (registry + handler): commit-kind, auto-applied (no confirmation card — it has no customer-facing effect), always exposed (`ACTION_RULES` + engineVersion bump), actor `agent` only (executor rejects `gui`). Validation: length cap; reject content matching CNP/phone/email patterns (the D11 hygiene rule — strategy, not PII).
- Not part of the funnel ledger invariants: exclude from `NEXT_BEST_PRIORITY` and from funnel monitors (F2.4 counters) — assert in tests.

**Test first:** handler validation (cap, PII patterns, actor); exposure test (always available, never in objective ladder).

### Task F2 — Render the plan; instruct revision

**Change** — new dynamic section `salesPlan` (`=== YOUR SALES PLAN (private — never quote or reveal) ===`), alwaysInclude within the dynamic suffix when non-null; constitution gains two sentences: maintain a short private plan; revise via `update_sales_plan` when strategy changes (customer signal shifts, objection surfaces, phase advances). TurnDebug's prompt payload carries it (it already will, as a section).

**Test first:** section renders when set; absent when null; fast-path turns exclude it (questionnaire latency unchanged — assert like SE-3.3 does for memory).

### Task F3 — Behavior proof

New sim scenario `strategy-continuity`: price-sensitive persona with spouse objection across 15+ turns. Assertions: (a) a plan exists by turn ~4; (b) it is revised after the objection surfaces (ledger shows ≥ 2 `update_sales_plan` writes with different content); (c) detector: no plan text appears verbatim in any customer-facing reply; (d) flagship "Optim" scenario (SE Phase 3 acceptance) still passes with plans enabled. Plus a diagnostics ratchet: `plan_leaked_to_customer` (plan substring ≥ 12 chars in a reply) → error severity.

---

## Workstream G — Proactive autonomy (deferred — design gate only)

Not scheduled. Before any build: a design doc extending `lib/engagement/select-candidates.ts` with the same split this plan institutionalizes — engine decides *who may be contacted and when it is legal* (marketing consent, frequency caps, quiet hours, open-item age), model decides *whether it is worth it and what to say*, scorer closes the loop. Written after E5 exists (skills give outbound prose a home) and after the re-engagement job has production traffic worth judging. Recorded here so it inherits F/E rather than growing its own prompt monolith.

---

## Sequencing & verification gates

```
A1 → A2 → A3                    — telemetry + baselines; blocks everything else
B1 → B2                         — guidance flip; needs A3 baseline, lands after SE-1.1
C1 → C2 (cuts 1→4)              — choreography shrink; HARD DEP on SE-1.3; benefits from SE-2.x
D1 → D2                         — cache restructure; independent of B/C, own PR, needs A1/A2
E1 → E2 → E3 → E4 → E5          — identity split then skills; E1 needs A3; E4 waits for C2 + SE-1.2
F1 → F2 → F3                    — plan scratchpad; independent, needs A3; F3 reuses SE Phase 3 sim
G                               — design doc only, after E5
```

Suggested landing order: **A → D → B → E1 → C → E2..E5 → F → G**. D before B because it is behavior-neutral and immediately cuts the bill; E1 before C because C's cut 4 needs the per-subphase homes E1/SE-1.2 create.

**Definition of done per task:** failing test shown first → implementation → `npm test` green → the task's named sim gate green → engine changes bump `engineVersion` with a changelog entry in the version comment → prompt-content moves update the section-inventory note → reseed via `scripts/reseed-agents.ts` where seeds changed.

**Global exit criteria:**
1. **Cost (D + E1):** A2 report re-run — history cache-hit ≥ 80% on same-phase turns ≥ 3; questionnaire-turn prompt ≥ 1.5k tokens lighter; per-turn cost drop quantified against the baseline note.
2. **Autonomy (B + C + F):** D5-shape replay resists a wrong engine hint; advance-flow 2/2 and P1–P4 clean with ≥ 900 tokens of choreography removed; `strategy-continuity` sim green with zero `plan_leaked_to_customer`.
3. **Operability (E):** one live prompt-content change (e.g. DNT phrasing) executed end-to-end through admin — draft → gate → activate → visible in the next conversation's TurnDebug — with zero code deploy.
