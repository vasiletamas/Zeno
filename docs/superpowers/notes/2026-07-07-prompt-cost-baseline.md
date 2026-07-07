# Prompt-cost + behavior baseline (A2/A3) — local verification gate for PR #6

**Date:** 2026-07-07 · **Branch:** `claude/exciting-knuth-dodcc1` at `c8952f7` · **Machine:** local laptop (live OpenAI + Anthropic keys, Docker Postgres 5435)
**Plan:** `docs/superpowers/plans/2026-07-06-zeno-autonomy-skills-cost-plan.md` (Tasks A2 + A3, the criterion-a gate) · **Handoff:** `docs/superpowers/notes/2026-07-07-autonomy-plan-handoff.md` §2

This is the ⚠ verification gate the cloud session could not run (no Postgres, no LLM keys). It gates the merge of PR #6 (workstreams A, D1, B1) and the start of E1/B2.

## 1. Full test suite (unit + integration ring)

```
Test Files  261 passed (261)
     Tests  1264 passed (1264)
```

(Cloud session could only run the unit ring: 179 files / 1028 tests. After the telemetry fix in §3 the suite is 261 files / 1267 tests, all green.)

## 2. Behavior gate — verbatim verdict lines (criterion a)

Commands: `npx tsx scripts/verify-pathology1.ts 3`, `verify-pathology2`, `verify-pathology3`, `verify-pathology4`, `verify-advance-flow`, run sequentially against the reseeded branch agents, live OpenAI.

```
P1: ==== 3/3 trials fully detector-clean ====
P2: ==== stalls-after-"da" across 2 trials: 0 (lower = better; advances instead of interrogating) ====
P3: ==== across 3 trials: BLIND choices=0 (want 0), INFORMED choices=6 ====
P4: ==== 3/3 trials clean (pivots to Protect, no invented categories) ====
AF: ==== advance-flow: 2/2 trials PASS (advanced into DNT, no confirm-product ceremony) ====
```

ALL CLEAN — identical to the 2026-07-02 baseline (`2026-06-zeno-prompt-section-inventory.md` §6) on every pinned criterion. One live-LLM variance: P3 reports INFORMED=6 vs 3 historically — more choice-points occurred this run and every one was informed; the pinned criterion is BLIND=0, unchanged. The B1 risk (informative flip re-introducing P2-class advance stalls) did NOT materialize: P2 stalls=0, AF 2/2 with no imperative "call X" hint in the prompt.

Post-gate corroboration (after the §3 fix, same day):

```
P1 spot-check: ==== 1/1 trials fully detector-clean ====
happy-path spec sim: => happy-path: 1/1 PASS (n-of-m met)
```

## 3. Telemetry defect found by this gate (fixed: `c8952f7`)

The FIRST `measure-prompt-cost` run returned, verbatim:

```
Turns: 53 (53 without usage) across 10 conversations

| Phase | Turns | Avg prompt tok | Avg cache read | Hit rate | Stable chars | Dynamic chars | Tooldef chars | Identity share |
|---|---|---|---|---|---|---|---|---|
| DISCOVERY | 53 | 0 | 0 | — | 23284 | 1301 | 0 | 74% |
| OVERALL | 53 | 0 | 0 | — | 23284 | 1301 | 0 | 74% |
```

Every turn had zeros: under `stream_options.include_usage` OpenAI delivers usage on one FINAL chunk with an empty `choices` array, AFTER the `finish_reason` chunk; both OpenAI stream generators emitted `done` at `finish_reason` time (usage still undefined) and dropped the late usage chunk. So A1's accumulation never fired on the primary provider — TurnDebug totals, TurnTrace cache columns, and `cache:status` all recorded zeros. The cloud A1a fix covered normalization + Anthropic streams but not this ordering. Fix: both generators defer `tool_calls`/`done` to stream end (abort semantics unchanged); pinned by 3 new tests in `__tests__/lib/llm/cache-telemetry.test.ts` with the real chunk order. Live-verified same day (first post-fix turn: in=19480, cacheR=6784, llmCalls=2, hits=1).

Consequence for this note: turns recorded BEFORE the fix count as "without usage" below. The pathology verdicts in §2 are unaffected (the fix is telemetry-only — no prompt, tool, or ordering change on the behavior path; §2's post-gate corroboration re-ran live after it).

## 4. Prompt-cost baseline (criterion a for D2/E1/C measurements)

Command: `npx tsx scripts/measure-prompt-cost.ts --conversations 10` — run 2026-07-07 after the fix. Traffic mix in the window: pathology-gate trials (pre-fix, no usage), one manual browser session, the P1 spot-check, and one full-funnel happy-path spec sim (discovery → DNT → questionnaire → quote → payment/policy probes). Verbatim:

```
Turns: 88 (41 without usage) across 10 conversations

| Phase | Turns | Avg prompt tok | Avg cache read | Hit rate | Stable chars | Dynamic chars | Tooldef chars | Identity share |
|---|---|---|---|---|---|---|---|---|
| DISCOVERY | 63 | 18874 | 8163 | 48% | 23359 | 1607 | 8917 | 73% |
| APPLICATION | 13 | 31080 | 9974 | 33% | 40078 | 3503 | 12032 | 42% |
| QUOTE | 10 | 29488 | 10586 | 37% | 39534 | 3836 | 10258 | 42% |
| PAYMENT | 1 | 31769 | 15488 | 50% | 39669 | 3835 | 10472 | 42% |
| POLICY | 1 | 15698 | 0 | 0% | 39388 | 4435 | 9911 | 41% |
| OVERALL | 88 | 24715 | 9162 | 41% | 28035 | 2198 | 10118 | 64% |
```

Reading guide for the after-measurements:

- **E1 anchor:** APPLICATION turns average 31,080 prompt tokens with the identity block at 42% of prompt chars (73% on DISCOVERY). E1's acceptance is a ≥ 1.5k-token drop on questionnaire turns measured by this same report.
- **D1/D2 anchor:** call-level cache-hit rate is 41% overall (48% DISCOVERY / 33% APPLICATION) with cacheRead ≈ 8–10k tokens/turn already flowing through D1's cache-aligned order. D2's exit criterion is history cache-hit ≥ 80% on same-phase turns ≥ 3; per-turn `toolDefChars` (~9–12k chars) is the churn surface D2 would stabilize.
- **C anchor:** the ADVANCING choreography lives inside the identity block counted above; C's acceptance (≥ 900 tokens off MAIN_CHAT_PROMPT) will show up as a drop in stable chars + identity share on APPLICATION turns.
- Caveats: hit rates are call-level (any cacheRead > 0), pre-fix turns are excluded from token averages, PAYMENT/POLICY are single-turn samples, and phase attribution is the engine-derived phase (DNT runs pre-application count as DISCOVERY).

## 5. Gate verdict

Suite green (incl. integration ring) + P1–P4 + advance-flow all clean at pinned criteria + baseline recorded ⇒ **the A3 gate is satisfied**: PR #6 is marked ready for review, and E1 (identity split) / B2 (imperative sweep) may start per the handoff queue. Every later cost claim (D2, E1, C) must cite the §4 table as its before.

## 6. E1 after-measurement — identity split (commit `92bcd77`)

E1 splits MAIN_CHAT_PROMPT into CONSTITUTION_CORE (always-on) + FIRST_TURN_RULES (messageCount ≤ 2) + DISCOVERY_CONDUCT (DISCOVERY + QUOTE). Full inventory in `2026-06-zeno-prompt-section-inventory.md` §7.

**Pathology re-run (E1 gate, live OpenAI, 2026-07-07 after the split + reseed):**

```
P1: ==== 3/3 trials fully detector-clean ====
P2: ==== stalls-after-"da" across 2 trials: 0 ====
P3: ==== across 3 trials: BLIND choices=0 (want 0), INFORMED choices=7 ====
P4: ==== 3/3 trials clean (pivots to Protect, no invented categories) ====
AF: ==== advance-flow: 2/2 trials PASS (advanced into DNT, no confirm-product ceremony) ====
happy-path spec sim: => happy-path: 1/1 PASS (n-of-m met)
```

IDENTICAL to §2 on every pinned criterion (BLIND=0, stalls=0, P1/P4 clean, AF 2/2). The phase-scoping did not regress any pathology — P4 confirms discovery conduct still ships on DISCOVERY, AF confirms it is correctly ABSENT once the flow crosses into APPLICATION.

**Live end-to-end scoping (TurnDebug section presence across recent conversations):** DISCOVERY idx 2 → `firstTurnRules=Y, discoveryConduct=Y`; DISCOVERY idx ≥ 4 → `firstTurnRules=-, discoveryConduct=Y`; APPLICATION → both `-`. The DISCOVERY→APPLICATION transition in one conversation (`siea0q`) shows discoveryConduct dropping exactly at the phase boundary. Proves the DB-loaded `Agent.promptSections` path, not just the unit assembly.

**Cost after-measurement** (`measure-prompt-cost.ts`, post-E1 traffic incl. the full-funnel sim; all turns measured, 0 without usage):

```
| Phase | Turns | Avg prompt tok | Avg cache read | Hit rate | Stable chars | Dynamic chars | Tooldef chars | Identity share |
|---|---|---|---|---|---|---|---|---|
| DISCOVERY | 39 | 17641 | 10509 | 68% | 22334 | 1753 | 8417 | 47% |
| APPLICATION | 13 | 28235 | 10978 | 41% | 33315 | 3659 | 12010 | 31% |
| QUOTE | 8 | 28529 | 3744 | 13% | 38618 | 3717 | 10937 | 27% |
| PAYMENT | 1 | 29134 | 13952 | 50% | 32899 | 3643 | 10472 | 31% |
| POLICY | 1 | 14430 | 0 | 0% | 32618 | 4441 | 9911 | 31% |
| OVERALL | 62 | 21401 | 9621 | 54% | 27074 | 2480 | 9553 | 41% |
```

**Before → after (§4 → §6), the deterministic stable-char measure:**

| Phase | Stable chars before | after | Δ | Identity share before → after |
|---|---|---|---|---|
| APPLICATION | 40,078 | 33,315 | **−6,763 (~1.7k tok)** | 42% → 31% |
| QUOTE | 39,534 | 38,618 | −916 (conduct KEPT here by design) | 42% → 27% |
| DISCOVERY | 23,359 | 22,334 | −1,025 (first-turn rules gone past the opener) | 73% → 47% |

**E1 acceptance MET:** APPLICATION turns (which include the QUESTIONNAIRE subphase) shed 6,763 stable chars ≈ 1.7k tokens — above the ≥ 1.5k-token bar — driven entirely by the DISCOVERY_CONDUCT removal (5,579 chars) plus first-turn-rules absence. The drop is exactly where the plan targeted it: high-volume questionnaire turns where the discovery guardrails were noise. QUOTE stable chars barely move because `includeDiscoveryConduct` deliberately keeps the pricing guardrails there. No pathology regression (verdicts above). Identity share falls everywhere because the "identity" section is now only the constitution core; the ADVANCING choreography still inside it is the next ≥ 900-token cut, gated to Workstream C.
