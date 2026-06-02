# Zeno — State-Awareness & Navigation Redesign (+ Gap Analysis)

- **Date:** 2026-06-02
- **Status:** READY FOR REVIEW — all design sections (4.1–4.4) approved by owner. Next: owner review of this spec, then `writing-plans`.
- **Author:** design session (Claude Code)
- **Scope:** How Zeno tracks current state, knows the next best action, navigates back/forth, accommodates mid-flow detours, and changes the selected product/version with the customer's permission — carrying over answers where valid.

> This document is a CHECKPOINT written mid-design so the session's work is not lost.
> It will be finalized once all design sections are approved, then handed to `writing-plans`.

---

## 1. Background

Zeno is a Next.js/TypeScript insurance sales chat agent (`C:\github\zeno`). It underperforms at
conversation quality, intent understanding, tool timing, and completing the sale. A real transcript
showed: re-asking already-decided choices, never producing a quote, repeated "confirm?" prompts,
quoting fabricated prices, and 8–20s/turn latency.

The architecture is NOT fundamentally broken: there is a real agentic loop
(`lib/chat/orchestrator.ts:1075`, `MAX_TOOL_ROUNDS = 5`) that feeds tool results back as
`role:'tool'` messages (`orchestrator.ts:1418`), and the discovery tools exist
(`lib/chat/default-tools.ts`). The problems are in state handoff, tool result/error handling, prompt
steering, and a dead workflow layer.

---

## 2. Root-cause analysis (from session audit)

### 2.1 KEYSTONE — two disconnected state worlds
Conversational sales selections never become structured application state.
- `set_candidate_product` writes only `candidateProductId` / `candidateConfidence`
  (`lib/tools/handlers/candidate-handlers.ts:71-78`). Package / level / addon / payment are NOT persisted.
- `start_application` creates the Application with `tierId`/`levelId` null and pre-seeds nothing
  (`lib/tools/handlers/application-handlers.ts:74-83`).
- `getNextQuestion` decides what to ask purely from the `Answer` table
  (`lib/engines/questionnaire-engine.ts`), so with nothing pre-seeded it re-asks
  PACKAGE_CHOICE / PREMIUM_LEVEL / BD_ADDON_INTEREST — the "re-asking" rage.
The questionnaire re-ask is the ONLY mechanism that migrates conversational choices into formal
state. This drives re-asking, half of the no-quote failure, and the over-confirmation.

### 2.2 No quote produced
`generate_quote` (`lib/tools/handlers/quote-handlers.ts:30-51`) has hard preconditions: GDPR valid →
application exists → `status === 'COMPLETED'` → both `tierId` and `levelId` set. `save_application_answer`
resolves the level by EXACT code match (`application-handlers.ts:313`), so a value/code mismatch leaves
`levelId` null and the quote fails. On failure the prompt's graceful-degradation rule
(`prisma/seeds/seed-agents.ts:56`) converts the error into the vague "offer not available here" instead
of surfacing/acting on it.
- IMPORTANT CORRECTION: this is NOT caused by the workflow transition case-bug. The `WorkflowSession`
  layer is dead — `workflowSession.create` is never called, so `pipeline.ts` skips the gate
  (`pipeline.ts:55`) and skips transition evaluation (`pipeline.ts:76`). The `TOOL_RESULT`/`tool_result`
  case mismatch (`pipeline.ts:183`) is real rot but NEVER REACHED. Fixing it would change nothing.

### 2.3 Confirmation hell
Prompt forbids re-confirming ("choosing IS the confirmation", `seed-agents.ts:92`), but handlers'
`confirmation` field is STRIPPED before the tool result is fed back to the model — `orchestrator.ts:1418-1427`
only stringifies `{success,data,error,message}`. The model gets no proof a choice was bound, so it
re-confirms defensively at every step boundary.

### 2.4 Fabricated prices before a quote
Per-level `premiumAnnual` is baked into the prompt (`lib/chat/context-loaders.ts:270`) and echoed by
`get_product_info` via `shapeProductInfo`, so the model states specific prices pre-quote, violating
`seed-agents.ts:71`. Compliance exposure, not just UX.

### 2.5 Catalog / synonym intolerance
`resolveProductRef` (`lib/tools/resolve-product.ts`) matches name only by `string_contains` substring and
only resolves if EXACTLY one product matches; no synonym/alias/fuzzy; returns `null` on miss → agent says
"not available". (The static catalog summary in the prompt was a band-aid for this.)

### 2.6 Latency (3–20s/turn)
Three sequential LLM calls before streaming (reasoning-gate → compliance-checker → main chat on a large
model), heavy per-turn DB loads, and up to 5 tool rounds.

---

## 3. Architecture decision

**Chosen: A+C — Derived state as single source of truth + LLM-as-navigator + advisory phase.**

- The "truth" about the conversation is DERIVED from existing records every turn, never stored.
- Zeno (the LLM) decides the next action; tools read and mutate state; the loop feeds results back.
- A derived `phase` + `nextBestAction` hint is injected each turn as guidance — advisory, never a hard gate.
- The dead `WorkflowSession`/`StepTransition` gating is retired (it fights free navigation and is the
  source of the "Schrödinger's workflow" confusion).

Rejected: (B) reviving the deterministic step-machine — rigid gating fights the desired free
back-and-forth and re-introduces brittleness.

Principle this serves: **user objective first, conversion over objection second** — nothing locks Zeno
into a script, so it can always follow the customer's lead.

Version-change scope (owner decision): must handle BOTH (a) changing tier/level/addon on the same
product (answer edits + re-quote, no questionnaire change) AND (b) switching to a genuinely different
product (carry over shared answers, ask only the new product's delta).

---

## 4. Design

### 4.1 State model — the backbone  [APPROVED]

One pure function `deriveState(conversationId)` is the only answer to "where are we?". Nothing is
stored; it is recomputed every turn, so after any edit the next derive is automatically correct.

Reads (existing tables): `Conversation` (candidate/committed product, GDPR + AI-disclosure consents,
DNT signed, language), `Application` (status, `tierId`/`levelId`/`includesAddon`, question index),
`Answer[]` (one per question), `Quote` (latest), and the chosen product's catalog rows (labels +
required question groups via `resolveGroupCodes`).

Returns:

```
{
  phase: DISCOVERY | NEEDS | SELECTION | CONSENT | QUESTIONNAIRE | QUOTE | CLOSING,  // derived
  product:   { id, code, name } | null,
  selection: { tier?, level?, addon? },          // resolved to human labels
  consents:  { gdpr: bool, aiDisclosure: bool },
  dnt:       { signed: bool, validUntil },
  application: { exists, status, answered: n, required: m, missing: [questionCode...] },
  quote:     { exists, premium, breakdown } | null,
  nextBestAction: "ask the foreign-treatment health question"   // derived, ADVISORY
}
```

Rules:
- `phase` and `nextBestAction` are DERIVED, never written. Change the product mid-flow → `missing[]`,
  `phase`, and the hint all recompute next turn with zero migration code.
- `missing[]` = (required questions for this product) − (answers that exist). Same mechanism for fresh
  customers, edited answers, or product switches. Carry-over falls out for free: a shared question
  already in `Answer[]` is simply not in `missing[]`.
- The snapshot is injected into the prompt each turn AND returned by a `get_current_state` tool (§4.2).

### 4.2 Tools — the verbs Zeno gets  [APPROVED]

**Read tools (no side effects):**
- `get_current_state` (NEW) — returns the §4.1 snapshot incl. an `answers` map and `missing[]`.
  Zeno's single "where am I / what's next" lookup. Replaces guessing and the static catalog band-aid.
- `preview_product_requirements(productId)` (NEW) — for a CANDIDATE product, returns which existing
  answers would carry over and which questions would still be needed, WITHOUT changing anything.
  Powers "switching to Home would only need 2 more answers" before committing.

**Write tools (each returns the fresh state snapshot):**
- `set_answer(questionCode, value)` (refactor of `save_application_answer`/`save_dnt_answer`) — upsert
  one validated answer BY CODE. Can target ANY question, not just the current index, so the same verb
  handles "answer the next question" AND "go back and change Q3". Handlers already upsert by
  `questionId+conversationId`, so this is a small generalization.
- `change_selection({tier?, level?, addon?})` (NEW, thin wrapper) — same-product version change.
  Updates PACKAGE_CHOICE/PREMIUM_LEVEL/BD_ADDON_INTEREST answers + `Application.tierId/levelId/includesAddon`,
  marks any existing quote stale.
- `switch_product(productId)` (NEW) — different-product change. Re-points product, carries over shared
  answers, recomputes `missing[]`, marks quote stale.
- Existing `generate_quote`, `record_gdpr_consent`, `acknowledge_ai_disclosure`, `accept_quote` stay —
  now reliably DRIVEN BY STATE.

**Cross-cutting rules (also close audit bugs):**
1. Every write tool returns the fresh `deriveState` snapshot, and the orchestrator feeds the WHOLE
   result back — including the `confirmation` field currently stripped at `orchestrator.ts:1418` (fixes §2.3).
2. Descriptions are rich contracts: WHEN / PREREQUISITE / EFFECT / NEXT — not one-liners.
3. Any selection/product change AUTO-MARKS the quote stale, so a stale price is never shown.
4. "Change with permission" is a CONVERSATION behavior (ask, then call); tools never hard-gate.

### 4.3 Navigation & change-with-permission flows  [APPROVED]

**Unifying rule (the engine for ALL navigation):**
> `required = f(product, current selection)` → `missing[] = required − answered` → re-derive after
> every change. Zeno asks exactly `missing[]`, never more. There is no "questionnaire mode" to enter
> or exit — only required answers that don't exist yet.

**Flow 1 — mid-questionnaire detour.** The questionnaire is not a locked mode. Zeno answers the
aside naturally; if the aside contains an answer ("I'm 40 anyway") it opportunistically calls
`set_answer('AGE', 40)`. Next turn `get_current_state` still shows the remaining `missing[]` and
`nextBestAction` points back to the next gap.

**Flow 2 — same-product selection change (with permission).** Zeno surfaces the issue, recommends,
asks; on yes → `change_selection({tier:'optim'})`. The unifying rule handles the subtle part:
**changing a selection can change what's required.** Adding the foreign-treatment add-on makes the
6-question medical declaration appear in `missing[]` (Zeno asks only those); removing it drops them
(old answers ignored). Quote auto-marked stale → re-quote.

**Flow 3 — switch to a different product.** Zeno calls `preview_product_requirements(newId)` first
(states the real impact), asks permission, then `switch_product(newId)`. Shared answers carry over,
`missing[]` = the new product's delta, Zeno asks only that.

**Answer carry-over = stable question identity.** An answer carries over iff the new product/selection
requires a question with the SAME stable code. Cross-product concepts (age, dependants) live in
shared/global `QuestionGroup`s (`resolveGroupCodes` already supports product-or-global), so they carry
automatically; product-specific questions don't.

**Permission scales with reversibility.** Selection/product changes are pre-purchase and reversible →
light "want me to switch?". Only `accept_quote` (issues a policy) needs firm confirmation. This is a
prompt rule, not a code gate — user-objective first.

**Decision-maker clarification (owner Q):** the reasoning gate is NOT the navigator. It is an advisory
pre-pass (`reasoning-gate.ts`: one LLM call, no tools, outputs section selection + briefing). The MAIN
agentic loop reads the derived-state block and calls the tools. DECISION: replace the reasoning-gate
LLM call with deterministic, phase-driven section selection (a `phase → sections` map); the main agent
does its own reasoning. Removes a blocking per-turn LLM call (latency win, §2.6) and keeps "what matters
now" in one place (`deriveState`).

### 4.4 Wiring + testing  [APPROVED]

**Per-turn assembly (gate replacement):**
1. `deriveState(convId)` — pure code, no LLM.
2. `phase → sections` map selects prompt sections (replaces the reasoning-gate selection).
3. Snapshot renders into the `=== YOU ARE HERE ===` block via the existing `stateGrounding` slot
   (`prompt-builder.ts`, alwaysInclude).
4. Main agentic loop (`orchestrator.ts:1075`) runs with the rich tool set; reasons; calls tools.
   No pre-chat gate call.

**Code touch points:**
- NEW `lib/chat/derive-state.ts` — the `deriveState` pure function (§4.1).
- NEW tools in `registry.ts` (rich WHEN/PREREQ/EFFECT/NEXT descriptions): `get_current_state`,
  `preview_product_requirements`, `change_selection`, `switch_product`; generalize
  `save_application_answer`/`save_dnt_answer` → `set_answer(questionCode, value)`.
- `prompt-builder.ts` — replace gate `GateSelection` with the `phase → sections` map; `stateGrounding`
  = derived snapshot.
- `orchestrator.ts` — remove `executeReasoningGate`; feed the WHOLE tool result back incl.
  `confirmation` (`:1418`); drive `generate_quote` from `nextBestAction`.
- `application-handlers.ts` — `start_application` pre-seeds `tierId/levelId/includesAddon` from answers.
- `context-loaders.ts` + `shape-product-info.ts` — drop per-level `premiumAnnual` (ranges only).
- `pipeline.ts` — remove the now-unused workflow gate/transition (since `workflowSession` is always
  null); follow-up migration to delete the dead `Workflow*` tables.

**Audit bugs closed along the way:** §2.1 (selections recorded as answers + `start_application`
pre-seed), §2.2 (quote driven by state + errors surfaced, not swallowed), §2.3 (full result fed back),
§2.4 (premiums suppressed), §2.6 (gate removed). §2.5 (tolerant `resolveProductRef`) rides along as a
small companion change.

**Error handling:** `deriveState` defaults gracefully on missing records; tool failures return in-band
next-step hints (never the vague "not available"); `set_answer` validation returns guidance; a stale
quote is always recomputed before being shown.

**Testing (TDD — failing tests first):**
- Unit: `deriveState` snapshots across record states; `missing[]` computation; `change_selection`
  re-derives `missing[]` when the add-on toggles the medical questions; `switch_product` delta +
  carry-over.
- Transcript-replay (integration): (1) convergence → no re-ask + Application has `tierId/levelId`;
  (2) full flow → real premium, not "not available"; (3) tool-result string contains `confirmation`
  and the agent stops re-confirming; (4) mid-questionnaire detour resumes at the right gap;
  (5) `change_selection(optim)` re-quotes; (6) `switch_product` carries over shared answers, asks only
  the delta; (7) product context contains no per-level RON figure.

---

## 5. Resolved decisions & follow-ups
- Cross-product question equivalence: RESOLVED — carry-over is keyed on STABLE shared question codes;
  cross-product concepts (age, dependants) live in shared/global `QuestionGroup`s (`resolveGroupCodes`
  already supports product-or-global). Product-specific questions don't carry.
- Change-confirmation strictness: RESOLVED — scales with reversibility. Light "want me to switch?" for
  selection/product changes (reversible, pre-purchase); firm confirmation only for `accept_quote`.
- Reasoning gate: RESOLVED — replaced by deterministic phase-driven section selection (§4.3, §4.4).
- Version-change scope: RESOLVED (owner) — handle BOTH same-product (tier/level/addon) and
  different-product switches.
- Latency (§2.6): gate removal is IN SCOPE. Lighter-model routing for simple turns + parallelized DB
  loads = FOLLOW-UP, out of scope for this design.
- §2.5 synonym / tolerant `resolveProductRef`: IN SCOPE as a small companion change.
- Dead `Workflow*` tables: remove the runtime gate now; schedule a FOLLOW-UP migration to drop the
  tables once nothing references them.
