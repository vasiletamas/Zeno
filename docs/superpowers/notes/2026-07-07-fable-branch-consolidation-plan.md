# Zeno v3 Fable — branch consolidation plan (2026-07-07)

Goal: collapse every Fable-lineage branch/PR into ONE branch (`zeno-v3-fable`)
so all Fable v3 code lives in a single place. Investigation done with real
trial merges (throwaway worktree, aborted — nothing was committed).

## 1. Branch topology (all root at `9a3d725` = main/PR#2)

| Branch | Tip | PR | Base | Fable? | Relationship to `zeno-v3-fable` (a24f0c4) |
|---|---|---|---|---|---|
| `zeno-v3-fable` | a24f0c4 | #3 (draft→main) | main | **TRUNK** | the target |
| `claude/zeno-sales-excellence-plan-9si2w5` | 643762c | #5 (draft→fable) | fable | **YES** | fable is its ANCESTOR (already merged fable in twice). = fable + 46 commits |
| `claude/exciting-knuth-dodcc1` | 1a7d93a | #6 (ready→main) | main | **YES** | forked off fable at `8551f74` (older), then diverged. 14 commits (A/D1/B1/E1/B2) |
| `claude/zeno-v3-model-analysis-s2p62x` | 5e83a87 | #4 (draft→main) | main | analysis-of | 1 commit off main; grades all 3 models. NOT implementation |
| `zeno-v3-opus` | 0e265bb | — | — | NO | Opus twin experiment — keep separate |
| `codex/zeno-v3-transformation-507b` | 845e8a6 | — | — | NO | Codex twin experiment — keep separate |
| `claude/zeno-v3-transformation-eznkex` | 9a3d725 | — | — | dead | empty (at base) — delete |
| PRs #1, #2 | — | merged | — | — | already in main |

**In scope to consolidate:** `zeno-v3-fable` (trunk) ← `sales-excellence` (#5) ← `exciting-knuth`/autonomy (#6).
**Out of scope:** opus & codex twins (different models), the model-analysis branch (#4, meta-analysis, not code), the dead eznkex branch.

## 2. Merge order & risk (from real trial merges)

1. **sales-excellence → fable: ZERO CONFLICTS.** Sales is a straight descendant of the fable tip (it already merged fable into itself twice). This is a clean/fast-forward merge — it just advances fable by the 46 sales-excellence commits (verification endgame, DNT cards, CNP hygiene, quality signals, diagnostics ratchets, etc.).
2. **autonomy → (fable+sales): 7 files, 12 conflict hunks.** The only real merge. Characterized below. The two lines independently reworked LLM telemetry, so those conflicts are convergent DUPLICATE fixes, not contradictions.

## 3. Conflict resolution playbook (the 7 files)

| File | Hunks | Nature | Resolution |
|---|---|---|---|
| `lib/llm/providers/openai.ts` | 2 | **Convergent duplicate fix.** fable P1-9 and autonomy c8952f7 are the SAME bug+fix (defer `done` past the trailing usage chunk). | Take autonomy's version (has regression tests in `cache-telemetry.test.ts`); keep fable's P1-9 comment reference. Trivial. |
| `lib/llm/providers/anthropic.ts` | 4 | **Convergent.** Both accumulate usage from `message_start`/`message_delta` incl. cache fields (P1-9/P1-8 vs A1a). | Take autonomy's (cache-field-complete, tested); verify fable's failover-model tweak (P1-8) is preserved. Easy-moderate. |
| `lib/self-improvement/scorer.ts` | 1 | **Additive, not contradictory.** sales adds `QualitySignals` block, autonomy adds cache aggregates — different ConversationScore columns (both exist in merged schema). | **Keep BOTH blocks;** ensure the final `conversationScore` write includes both field sets. Easy. |
| `prisma/seeds/seed-agents.ts` | 1 | **Structural (needs care).** sales added `TOOL FAILURE PROTOCOL` + `CUSTOMER FIELD DISCIPLINE` to MAIN_CHAT_PROMPT; autonomy (E1) split MAIN_CHAT_PROMPT into CONSTITUTION_CORE / FIRST_TURN_RULES / DISCOVERY_CONDUCT. | Place sales' two new blocks into `CONSTITUTION_CORE` (phase-agnostic behavior). Update the E1 inventory-note §7 + `identity-split.test.ts` / `main-chat-constraints.test.ts` if a block's home is asserted. |
| `lib/chat/phase-sections-map.ts` | 2 | B1 rewrote `formatDerivedBriefing` (objective facts) + E1 added `includeDiscoveryConduct`; sales added briefing lines (identity fields do-not-re-ask, f9662c6). | Merge both: keep B1's objective-fact briefing AND sales' identity-field lines; keep E1's `includeDiscoveryConduct`. Moderate. |
| `lib/engines/derive-and-expose.ts` | 1 | B1's structured `objective` derivation vs sales' engine work (precise requires_identity, verification endgame). | Both add distinct derived state — reconcile so `objective` (B1) and the sales identity/verification fields coexist. Moderate. |
| `lib/chat/orchestrator.ts` | 1 | E1 section wiring (promptSections load + phase scoping) + D1 message order vs sales orchestrator changes. | Keep both; small hunk. Moderate. |

Est. effort: one focused sitting. ~4 hunks mechanical (telemetry duplicates, scorer union), ~3 need judgment (seed prompt homes, briefing merge, engine state).

## 4. Schema / migrations

- `prisma/schema.prisma` **auto-merged cleanly** — both column sets survived (TurnTrace `cacheReadTokens`/`cacheWriteTokens` + `messageIndex`; ConversationScore `totalPromptTokens`/`totalCachedTokens`/`avgCacheHitRate` + sales' quality columns).
- **Pre-existing drift (not caused by the merge):** the cloud/fable/sales line authored ZERO migration files despite heavy schema changes — it relies on `npx prisma db push`. Autonomy added 2 migrations (`20260706…cache-telemetry`, `20260707…agent-prompt-sections`). After merge, run **`npx prisma db push`** to sync the merged schema locally (do NOT rely on `migrate deploy` — the cloud columns have no migration). Optional follow-up: author one catch-up migration if a migrate-based deploy is ever needed.
- **⚠ TWO databases must be synced.** Dev DB is `zeno` (`DATABASE_URL` in `.env`); the integration ring runs against a SEPARATE `zeno_test` DB (`TEST_DATABASE_URL`, aliased in `__tests__/helpers/integration-env.ts`). `db push` targets only whatever `DATABASE_URL` is set, i.e. `zeno`. After the merge, `zeno_test` was stale (sales columns present, E1 `promptSections` missing), surfacing as `agent.findUnique` → "column (not available) does not exist" ONLY in vitest — and only in `turn-debug-message-index` (the sole integration test that runs a real turn through the real `getAgentConfig`; `turn-abort-debug` mocks it). Fix: `export DATABASE_URL=<TEST_DATABASE_URL>; npx prisma db push; npx tsx scripts/reseed-agents.ts`. General rule for this repo: any schema change must push BOTH databases.

### Post-merge test-expectation fixes (merge-driven, not code bugs)
- `streaming-usage.test.ts` (fable P1-9, 4 asserts): `toEqual` → `toMatchObject` — merged provider (autonomy's) correctly adds `cacheReadTokens`/`cacheWriteTokens` to `done.usage`; fable's strict 3-field equality no longer holds.
- `identity-split.test.ts` (E1 char budget): ≤12KB → ≤14KB — the merge correctly moved sales' TOOL FAILURE PROTOCOL + CUSTOMER FIELD DISCIPLINE into CONSTITUTION_CORE (11,382 → 13,175 chars); returns toward ≤9KB when Workstream C removes ADVANCING.
- `turn-debug-message-index.test.ts` (2): no code change — fixed by the `zeno_test` sync above.

## 5. Recommended execution (integration branch, keeps `zeno-v3-fable` safe until green)

```
git checkout -b zeno-v3-fable-integration origin/zeno-v3-fable
git merge --no-ff origin/claude/zeno-sales-excellence-plan-9si2w5   # clean
git merge --no-ff origin/claude/exciting-knuth-dodcc1               # resolve 7 files per §3
npx prisma db push && npx tsx scripts/reseed-agents.ts
npm test                          # full suite incl. integration ring must be green
# behavior gate (live keys): verify-pathology1..4 + advance-flow + happy-path sim
```
Only when the suite + pathology gate are green: fast-forward/merge `zeno-v3-fable` to the integration branch and push. Then:
- Retarget/keep **PR #3** as the single fable→main PR (now containing everything), or open a fresh consolidated PR.
- Close **PR #5** and **PR #6** as "merged into zeno-v3-fable".

## 6. Branch cleanup (after consolidation is green)
- Delete `origin/claude/zeno-v3-transformation-eznkex` (dead, at base).
- Leave `zeno-v3-opus`, `codex/zeno-v3-transformation-507b`, and analysis PR #4 as-is (out of scope; the model comparison still needs them).

## 7. Open decisions for the user
- **D1 — Target:** consolidate into `zeno-v3-fable` directly (recommended) vs. keep a separate `…-integration` branch as the trunk?
- **D2 — Analysis branch (#4):** exclude (recommended — it's meta-analysis, not code) vs. fold into fable?
- **D3 — main:** does the consolidated fable branch eventually merge to `main`, or stay a long-lived integration branch? (affects whether PR #3 is the end target)
