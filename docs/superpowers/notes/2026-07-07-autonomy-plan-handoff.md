# Handoff — autonomy/skills/cost plan: cloud session → local session (2026-07-07)

**Branch:** `claude/exciting-knuth-dodcc1` · **PR:** #6 (draft) · **Plan:** `docs/superpowers/plans/2026-07-06-zeno-autonomy-skills-cost-plan.md`
**Cloud session limits:** no Postgres, no LLM API keys — everything below marked ⚠ could NOT run there and must run locally before merge.

---

## LOCAL SESSION UPDATE (2026-07-07, laptop, live keys) — gate cleared, E1 + B2 landed

The ⚠ verification gate ran and is GREEN; PR #6 is marked **ready for review**. Commits added this session (on top of `3652105`):
- `c8952f7` — **telemetry bug found by the gate:** OpenAI streaming emitted `done` at `finish_reason` time, but under `stream_options.include_usage` OpenAI sends usage on a LATER chunk with empty `choices`. So A1's whole accumulation recorded zeros on the primary provider (the first `measure-prompt-cost` run printed all-zero token columns). Fixed both stream generators to defer `done` to stream end; 3 regression tests. Live-verified real usage now persists.
- `c8a3d3e` — A2/A3 baseline note `2026-07-07-prompt-cost-baseline.md`: full suite (261 files / 1264→1267 tests), P1–P4 + advance-flow all clean at pinned criteria, per-phase cost table. This is the criterion-a "before" for D2/E1/C.
- `92bcd77` — **E1 done.** MAIN_CHAT_PROMPT split into `CONSTITUTION_CORE` (systemPrompt) + `FIRST_TURN_RULES` + `DISCOVERY_CONDUCT` (new `Agent.promptSections` Json column, migration `20260707000000`). Registry keys `firstTurnRules` (detectFirstTurn, messageCount≤2) + `discoveryConduct` (includeDiscoveryConduct, DISCOVERY+QUOTE), scoped by the orchestrator's post-gate content-nullness patch. Gate: 16 assembly tests + full pathology re-run identical to baseline; live TurnDebug confirms scoping across a DISCOVERY→APPLICATION transition. Cost: APPLICATION turns shed ~6.8k chars (~1.7k tok), acceptance met. Inventory note §7.
- `aee0ea5` — E1 after-measurement (baseline note §6).
- `06cc8ca` — **B2 done (documentation-only).** Multi-agent sweep (inventory note §8): 126 imperatives, 39 proposed for rewrite, **0 survived adversarial verification**. B1 already flipped the only D5-flippable imperative (`nextBestAction`); every residual is pathology/compliance/persona-pinned. No prompt change. The next imperative reduction is a REMOVAL (ADVANCING choreography), i.e. Workstream C — not a reword.

**Local-setup gotchas confirmed this session:** DB synced with `npx prisma db push` (cloud authors schema without migrations — but E1 DID author a migration file); dev on port 3001 (`.claude/launch.json` `zeno-dev`); tsx needs `--env-file=.env` and DOES NOT resolve the `@/` alias in one-off `-e` scripts — write a scratch `.ts` importing from an absolute path instead. Full suite ~6 min; each live pathology ~2-4 min.

**Still open (unchanged queue below):** D2 waits for telemetry-over-traffic; C is blocked on SE-1.3; E2–E5 + F come next. PR #6 base is still `main` (247-commit lineage) — re-target to `zeno-v3-fable` before merge if only A/D1/B1/E1 is intended (flagged on the PR).

---

## 1. What is already implemented on this branch (all TDD, suite green)

| Commit | Task | Content |
|---|---|---|
| `c378352` | plan | The 7-workstream implementation plan document |
| `f09bb24` | A1a | **Bug fix:** providers dropped cache fields at usage normalization (cache:status emitted zeros since it shipped); Anthropic streaming emitted `done` with NO usage (zero tokens on fallback). TokenUsage gains cacheReadTokens/cacheWriteTokens; Anthropic streams accumulate usage from message_start/message_delta |
| `38530ca` | A1b | Turn state accumulates cache tokens + call/hit counts (`lib/chat/turn-usage.ts`); debug:turn_end carries totals + toolDefChars; debug:prompt splits stable/dynamic chars |
| `1fd4075` | A1c | `TurnTrace.cacheReadTokens/cacheWriteTokens` + `ConversationScore.totalPromptTokens/totalCachedTokens/avgCacheHitRate`; migration `20260706000000_add-cache-telemetry`; scorer aggregation |
| `6d03c06` | A2 | `lib/analytics/prompt-cost.ts` + `scripts/measure-prompt-cost.ts` (per-phase cost report for the baseline note) |
| `800cf28` | D1 | Cache-aligned message order: dynamic state now rides the final user message as a TURN STATE envelope BEHIND the history (`lib/chat/build-turn-messages.ts`); last history message gets an Anthropic cache breakpoint; persisted messages keep raw customer text |
| `32d975a` | B1 | engineVersion **1.36.0**: `DerivedStateV3.objective` {goal, achievableNow, missingPreconditions} derived from the PHASE; briefing renders "Open objective / Achievable now via / Not yet achievable because" facts; "Next best action: call X" is gone (D5 class fix); nextBestAction kept unrendered for compat |

Unit suite: 179 files / 1028 tests green (was 174/998). `tsc --noEmit` clean.

## 2. ⚠ FIRST THING LOCALLY — the verification gate (blocks merge AND blocks starting E1)

```bash
git fetch origin claude/exciting-knuth-dodcc1 && git checkout claude/exciting-knuth-dodcc1
npm install && npx prisma migrate deploy && npx prisma generate
npm test                      # full suite incl. integration ring (needs the Docker postgres)
npm run dev                   # terminal 1
# terminal 2 — behavior gate (A3 baseline; D1 + B1 both require identical-to-historical verdicts):
npx tsx scripts/verify-pathology1.ts 3
npx tsx scripts/verify-pathology2.ts
npx tsx scripts/verify-pathology3.ts
npx tsx scripts/verify-pathology4.ts
npx tsx scripts/verify-advance-flow.ts
# cost baseline (A2) — run on real/sim traffic, paste verbatim into a new note:
npx tsx scripts/measure-prompt-cost.ts --conversations 10
```

Record the verbatim verdict lines in `docs/superpowers/notes/2026-07-XX-prompt-cost-baseline.md` (the A4-method discipline: this is criterion-a for everything that follows).

**If a pathology fails:** most likely suspect is B1 (the informative flip) re-introducing advance stalls (P2 class). Planned remedy: ONE narrow imperative line at convergence only in `formatDerivedBriefing` (e.g. "When the customer agrees to proceed, open the needs analysis now") — never a revert to global "call X". If P1/P4 fail instead, suspect D1 (state position) — check the TURN STATE envelope renders correctly in TurnDebug prompt payloads before touching anything.

**All green →** mark PR #6 ready + merge, then continue below.

## 3. Next task queue (plan §references, in order)

### E1 — split the identity prompt into phase-scoped sections (plan Workstream E, Task E1)
The 5k-token MAIN_CHAT_PROMPT ships whole on every turn. Split in `prisma/seeds/seed-agents.ts`:
- `CONSTITUTION_CORE` (~2k tok, stays `agentIdentity`, alwaysInclude): identity, CORE BEHAVIORS, TOOL USE IS INVISIBLE, ANSWER FIRST, CUSTOMER SIGNAL AWARENESS, CUSTOMER AUTONOMY, CRITICAL CONSTRAINTS, WHAT I CAN/CANNOT DO, OFF-TOPIC (small, P4/OOS-pinned).
- `FIRST_TURN_RULES` (~170 tok) → new registry key `firstTurnRules`, included via detector `messageCount <= 2` (orchestrator adds to requiredSections — the detectFastPath pattern).
- `DISCOVERY_CONDUCT` (~1.6k tok: guardrails 1–6 + SINGLE-MATCH + PRODUCT KNOWLEDGE + PACING) → key `discoveryConduct`, stable layer, phases DISCOVERY + QUOTE.
- ADVANCING TO THE OFFER stays in the constitution UNTIL Workstream C (its deletion is gated on SE-1.3 structured errors).
Storage: `Agent.promptSections` Json column (avoids one migration per section) with systemPrompt fallback. Update `SECTION_REGISTRY` (prompt-builder), `phase-sections-map`, the section-inventory note (every sentence exactly once), reseed via `scripts/reseed-agents.ts`. Gate: full pathology suite + assembly tests (QUESTIONNAIRE turn must NOT contain discovery guardrails; turn 1 contains firstTurnRules, turn 5 doesn't).

### B2 — imperative-language sweep (plan Task B2)
Inventory every imperative sentence in `formatDerivedBriefing` + MAIN_CHAT_PROMPT into a keep-because-pinned / rewrite-informative / delete table appended to the inventory note. One commit per section, pathology re-run per commit. Natural to do WITH E1 since both touch the same prose.

### D2 — tool-list stability (plan Task D2, decide with data)
After a few days of traffic with A1 telemetry: check `avgCacheHitRate` in ConversationScore + per-turn `toolDefChars`/hit patterns. Add `toolListHash` to the A1 telemetry if churn needs quantifying. Only if within-phase churn > ~20%: switch the API tools param to the phase superset (executor wall keeps exact per-turn exposure — it is authoritative since A3.2). Record as a deviation like T6.D3 if done.

### C — choreography shrink (plan Workstream C) — **blocked** on sales-excellence Task 1.3 (structured tool errors). Four sim-gated cuts; cut 4 MOVES (not deletes) the exact-code + #1-FAILURE rules into dntContext/questionnaireContext.

### E2–E5 (Skills v2 schema/loader/admin/self-improvement) and F (plan scratchpad) — after E1; full specs in the plan doc.

## 4. House-rule reminders for the local session

- Failing test first, one logical change per commit, suite green before push.
- Any change to `derivePhase` / `ACTION_RULES` / `NEXT_BEST_PRIORITY` → bump `engineVersion` with a changelog entry in the version comment.
- Prompt-content moves → update `docs/superpowers/notes/2026-06-zeno-prompt-section-inventory.md` (destination or retired-because-X per rule).
- Seed changes → `npx tsx scripts/reseed-agents.ts`.
- The PR watch from the cloud session may still ping PR #6 hourly until it is merged or closed — merging/closing it ends that automatically.
