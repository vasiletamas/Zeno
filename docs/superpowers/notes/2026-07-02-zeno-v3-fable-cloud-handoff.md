# Zeno v3 — Fable branch: cloud session handoff

**Read this whole file before writing any code.** It is the operating manual for continuing the `zeno-v3-fable` implementation in a Claude Code cloud session.

## 1. Mission

Implement the Zeno v3 transformation plan on branch **`zeno-v3-fable`**, exactly as specified in
`docs/superpowers/plans/2026-06-12-zeno-v3-transformation-plan.md` (10,782 lines, 26 work packages, 6 blocks).

Purpose of this branch: a **model comparison experiment**. The same plan was already implemented once on branch `zeno-v3-opus` (by Claude Opus, 435 commits). This branch is the Claude Fable implementation. Both branches fork from the same commit, `9a3d725` (current `main`). Therefore:

- **Never look at, diff against, or cherry-pick from `zeno-v3-opus`.** The experiment is only valid if this implementation is independent. Work only from the plan text and the code on this branch.
- Never merge `main` or any other branch in. Never rebase. Only add commits on `zeno-v3-fable`.
- Push to `origin/zeno-v3-fable` regularly (at least at every package boundary) — the owner tests locally by pulling this branch.

## 2. Current status (as of handoff, 2026-07-02)

- Branch `zeno-v3-fable` forked from `9a3d725`.
- **Package A1 (tasks A1.1–A1.7) is COMPLETE**: commits `f09dbb0`…`d4e4a03`, all strict-TDD, plus `a523df8` (bonus fix found during verification: streaming LLM calls bypassed provider retry/failover; pinned by 5 new tests in `__tests__/lib/llm/streaming-failover.test.ts`).
- **A1.8 verification: full suite 115 files / 756 tests ALL GREEN, `tsc --noEmit` clean.** The two live-sim steps (verify-advance-flow, verify-pathology1) were BLOCKED locally — no valid LLM keys in the laptop env (recorded honestly in commit `5e2652d`).
- **➡ FIRST CLOUD ACTION (before starting A2):** after bootstrapping (section 6), run A1.8 steps 3–5: `npx tsx scripts/verify-advance-flow.ts 2` (expect 2/2 trials reach signature + application; briefing lines show `Phase: APPLICATION/...`) and `npx tsx scripts/verify-pathology1.ts 2` (expect CLEAN), then an empty commit recording the observed result. Only then proceed to A2.
- Progress checklist: **section 9** — keep it updated (edit this file, commit the edit) at every package boundary.

## 3. The plan is law — precedence rules

From the plan's own "How to execute this plan" (lines 15–61 — read them first, every session):

1. **Precedence:** package errata (`⚠ Binding errata`) > task text. Addendum tasks (`➕`) are binding tasks. The agenda resolution log in `docs/superpowers/notes/2026-06-11-zeno-transformation-discussion-agenda.md` outranks both — if you find a conflict, STOP and flag it to the user.
2. **TDD, no exceptions:** every behavior task starts with a failing test. Write the test exactly as the plan gives it, run it, confirm it fails for the right reason, implement, re-run to green. "Build succeeds" or "it compiles" is NEVER verification — report real pass/fail counts.
3. **Execution order:** the order table (plan lines 28–59) is authoritative, including its dependency normalization. A package may start only when its dependencies are complete. Note E2 lands at slot 9, before B3.
4. **Void rule:** any bullet in Blocks B–F editing `lib/chat/default-tools.ts`, `prisma/seeds/seed-skill-packs.ts`, or `prisma/seeds/seed-workflows.ts` is VOID (those files die in Block A).
5. **Line anchors are indicative** — re-verify with Grep before editing.
6. Canonical test-DB helper: `__tests__/helpers/test-db.ts` (exists since A1.2). All later task text naming other paths for it (`__tests__/integration/helpers/test-db.ts`, `./helpers/test-db`) means THIS file.
7. Ownership rulings (plan line 23) — consent flip is B1's, ApplicationStatus is B4's, Answer re-key is B4's, questionnaire tool surface is C1's, suitability report timing is D4's.
8. No new code against old phase names (SELECTION/CONSENT/QUESTIONNAIRE/CLOSING as phases are dead after A1; the vocabulary-closure meta-test enforces this).
9. Engine emits snake_case ReasonCodes + params, never prose; authored customer-facing fields are bilingual `{ro, en}`.
10. Full suite at the end of every package. The ONLY tolerated failure is `__tests__/lib/events/instrumentation.test.ts` ("cached=true on cache hit" flake) and only when it is the sole failure.

## 4. Package line map (verified against the plan file; re-verify with Grep, they may drift ±2)

| Slot | Package | Plan lines | Errata / addenda | Depends on |
|---|---|---|---|---|
| 1 | A1 ✅ | 69–739 | 721–739 | — |
| 2 | A2 | 740–1432 | 1374–1399, ADD 1400–1432 | A1 |
| 3 | A3 | 1433–1784 | 1700–1712, ADD 1713–1784 | A1, A2 |
| 4 | A4 | 1785–1951 | ADD note 1948–1951 | A1, A3 |
| 5 | A5 | 1952–2066 | 2050–2054, ADD 2055–2066 | A3, A4 |
| 6 | B0 | 2079–2500 | 2456–2468, ADD 2469–2500 | A1 |
| 7 | B1 | 2501–2770 | 2758–2770 | A2, B0 |
| 8 | B2 | 2771–3119 | 3095–3109, ADD 3110–3119 | A2, B0, B1 |
| 9 | E2 | 8331–8788 | 8770–8788 | A2, B0 |
| 10 | B3 | 3120–3522 | 3465–3479, ADD 3480–3522 | A3, B0, B1, E2 |
| 11 | B4 | 3523–3848 | 3821–3835, ADD 3836–3848 | A3, B0, B2, B3 |
| 12 | C1 | 3866–4771 | 4725–4753, ADD 4754–4771 | A2, B2, B4 |
| 13 | C2 | 4772–5203 | 5191–5203 | A1, C1 |
| 14 | C3 | 5204–5648 | 5634–5648 | A1, B2, C2 |
| 15 | D1 | 5655–6250 | 6230–6250 | A2, B4, C1, C2, C3, E2 |
| 16 | D2 | 6251–6887 | 6855–6877, ADD 6878–6887 | A3, B1, B3, D1 |
| 17 | D3 | 6888–7165 | 7151–7165 | D2 |
| 18 | D4 | 7166–7543 | 7516–7534, block 7535–7543 | D2, E2 |
| 19 | E1 | 7550–8330 | 8310–8330 | A5, C2 |
| 20 | E3 | 8789–9271 | 9251–9271 | B0, E2 |
| 21 | E4 | 9272–9770 | 9745–9757, ADD 9758–9770 | B0, B1, B3, D4, E2 |
| 22 | F1 | 9783–10713 | 10691–10709, note 10710–10713 | D4, E4 |
| 23 | F2 | 10714–11114 | 11106–11114 | F1 |
| 24 | F3 | 11115–11234 | 11224–11230, note 11231–11234 | F1 |
| 25 | F4 | 11235–end | — | F2 |
| 26 | F5 | final section | — | F4 |

## 5. Per-package working method (what worked for A1)

For each package, in order:

1. Read plan lines 15–61 (rules), the block/package overview, the package's errata + addenda FIRST, then implement task by task in order.
2. One task = one focused unit of work: failing test → confirm it fails for the right reason → implement → green → `git add <specific files>` → commit `feat(<TaskId>): <summary>`. Never `git add -A`. Never commit `package-lock.json` unless you intentionally changed dependencies.
3. Errata addressed to a task override its text — apply them as you do the task, not as an afterthought.
4. Package verification task (the last task of every package) is mandatory: full suite (`npx vitest run`), reseed, live sims (section 7).
5. After package verification: update the checklist in section 9 of this file, commit, and **push**.
6. If genuinely blocked (plan contradiction, agenda conflict, environment impossibility): stop, describe precisely, ask the user. Do not improvise around a binding ruling.

## 6. Environment bootstrap (cloud sandbox)

The repo needs Node 20+, Postgres, and a `.env`. The repo's `.env` is NOT in git — create it (it is gitignored):

```bash
# 1. Dependencies
npm ci

# 2. Postgres (sandbox-local). Any Postgres 16 works; sandbox usually has apt:
sudo apt-get update && sudo apt-get install -y postgresql
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER zeno WITH PASSWORD 'zeno_dev' SUPERUSER;"
sudo -u postgres psql -c "CREATE DATABASE zeno OWNER zeno;"

# 3. .env at repo root (dev-only values; real secrets only via session env settings)
cat > .env <<'EOF'
DATABASE_URL="postgresql://zeno:zeno_dev@localhost:5432/zeno"
PAYMENT_PROVIDER=mock
EMAIL_PROVIDER=mock
JWT_SECRET=dev-secret-not-production
ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
ADMIN_EMAIL=admin@zeno.ro
ADMIN_PASSWORD=change-me
APP_URL=http://localhost:3000
REPORTS_PATH=./tmp-reports
OTEL_ENABLED=false
EOF
# API keys are NOT written into .env: OPENAI_API_KEY and ANTHROPIC_API_KEY arrive as
# session environment variables (configured in the claude.ai/code environment settings)
# and are already in process.env — dotenv never overrides existing env vars.
# The seeded agents use OpenAI models primarily (gpt-5.4 / gpt-5.4-mini) with
# Anthropic fallback, so BOTH keys must be present for live sims.

# 4. Schema + demo data. IMPORTANT: the committed migrations dir does NOT fully build
# the schema (verified: migrate deploy leaves tables missing). Bootstrap with db push:
npx prisma db push --accept-data-loss
npx prisma generate     # client output: lib/generated/prisma
npx prisma db seed

# 5. Sanity: full suite — expect 115 files / 756 tests green (integration ring RUNS, no skips)
npx vitest run
```

Notes:
- All data is DEMO data. Destructive migrations + reseed are fine, no backfills (plan rule).
- When a plan task adds a schema migration, follow the task text (`prisma migrate dev` etc.). If migrate state fights the db-push bootstrap, drop + db push + reseed is acceptable — demo data.
- Vitest loads `.env` via `dotenv/config` setupFiles (landed in A1.2). Integration/real-DB suites must RUN, not skip — check the vitest summary; a silently skipped DB suite certifies nothing.

## 7. Verification policy (cloud runs everything)

- Unit + integration tests: ALWAYS, every task, every package.
- Live LLM sims (`scripts/verify-advance-flow.ts`, `scripts/verify-pathology*.ts`): RUN THEM at every package verification as the plan says — `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are configured as session environment variables. Sanity-check at session start that both are present in process.env; if either is missing, tell the user before starting a package instead of silently skipping sims.
- Never print, log, or commit the key values. Never write them into files.
- The owner still does final acceptance locally: pulls the branch, `docker compose up -d`, `npx prisma db push`, seed, full suite + sims.

## 8. Harness facts learned during A1 (trust these; they postdate the plan text)

- **Vitest projects:** `vitest.config.ts` defines `unit` (`__tests__/**` minus integration) and `integration` (`__tests__/integration/**`, `fileParallelism: false` — the serialized real-DB ring). Root `setupFiles: ['dotenv/config']` applies to both. Commands: `npx vitest run` (all), `npm run test:integration` or `npx vitest run --project integration` (ring only).
- **Canonical test-DB helper:** `__tests__/helpers/test-db.ts` exports `resetFunnelTables` + `ensureTestProduct`. A2.ADD-1's `resetDb`/`DOMAIN_TABLES` and every later truncate-list addition (CommitLedger, ConsentEvent, …) go in THIS file.
- **Gotcha:** `resetFunnelTables` TRUNCATE…CASCADE also empties User/Referral/WorkflowSession/ConversationScore/SimulationConversation via FKs. After real-DB runs, restore demo data with `npx prisma db seed` (NOT `npx tsx prisma/seeds/index.ts` directly — it doesn't load `.env` and fails with a SASL password error).
- **Engine surface after A1:** `lib/engines/domain-types.ts` (the ONLY vocabulary module: PHASES, APP_SUBPHASES, IDENTITY_TIERS, COMMIT_OUTCOMES, COMMIT_EFFECTS, REASON_CODES, DomainSnapshot, DerivedStateV3, ExposedActions, CommitResult, …); `lib/engines/derive-and-expose.ts` (derivePhase, deriveAndExpose, ACTION_RULES, exported `engineVersion` — bump on rule changes per erratum #8); `lib/engines/snapshot-loader.ts` (`loadDomainSnapshot(conversationId, db = prisma)`); `lib/engines/question-groups.ts` (`resolveGroupCodes(productId, phase, db = prisma)`).
- **Db seam type is `typeof prisma`** — when A2's gateway passes a `Prisma.TransactionClient`, the seam type must be widened (TransactionClient lacks `$transaction`/`$executeRawUnsafe`). Expect this in A2.4.
- **Test fixtures:** `__tests__/lib/engines/snapshot-fixtures.ts` exports `makeSnapshot(overrides)` — use it for every pure-engine test.
- **Vocabulary closure is enforced by tests:** `__tests__/lib/engines/vocabulary-closure.test.ts` scans for second vocabularies and retired phase literals; `domain-types.test.ts` pins the enums. If a later task legitimately extends an enum, update the pinned test in the same commit — the plan will say so when allowed.
- `lib/chat/derive-state.ts` and `lib/chat/phase.ts` are DELETED. Compliance keys off pinned Phase (`COMPLIANCE_RELEVANT_BY_PHASE`, `rulesForPhase`). Orchestrator + sections map key off `(Phase, AppSubphase)` via `getRequiredSectionsFor`.

## 9. Progress checklist (KEEP UPDATED — edit + commit at every package boundary)

- [x] 01 A1 — pinned vocabulary, DomainSnapshot loader, deriveAndExpose core (suite 756/756 green; cloud sims run 2026-07-02: pathology1 2/2 CLEAN; advance-flow 0/2 = the documented pre-A3 static-10-tool regression — see ruling in section 10)
- [ ] 02 A2 — CommitResult envelope, gateway, CommitLedger, confirm tokens
- [ ] 03 A3 — orchestrator exposure, executor hard-reject, GUI parity
- [ ] 04 A4 — prompt sections rework (M13)
- [ ] 05 A5 — dead-config cleanup (Workflow machine, SkillPacks)
- [ ] 06 B0 — CustomerProfile SSOT
- [ ] 07 B1 — ConsentEvent ledger
- [ ] 08 B2 — DNT aggregate
- [ ] 09 E2 — WorkItem operator queue
- [ ] 10 B3 — identity
- [ ] 11 B4 — application lifecycle
- [ ] 12 C1 — dependency graph + consequence planner
- [ ] 13 C2 — eligibility module
- [ ] 14 C3 — suitability engine
- [ ] 15 D1 — quote lifecycle
- [ ] 16 D2 — coupled flip (disclosures, accept, schedule, webhook inbox)
- [ ] 17 D3 — payment operations
- [ ] 18 D4 — policy machine + post-sale
- [ ] 19 E1 — product data
- [ ] 20 E3 — GDPR
- [ ] 21 E4 — customer-scoped reads + re-engagement
- [ ] 22 F1 — BDD harness
- [ ] 23 F2 — observability completion
- [ ] 24 F3 — spec fold-back
- [ ] 25 F4 — triage tooling
- [ ] 26 F5 — final validation gauntlet

## 10. Owner rulings recorded during cloud sessions (binding, errata-rank)

1. **[2026-07-02 — A1.8/A2.10 advance-flow expectation vs Block A overview]** Plan-internal contradiction flagged and ruled by the owner. A1.8 step 3 and A2.10 step 4 expect `verify-advance-flow.ts 2` → 2/2 "reach signature + application", but the Block A overview + A3.7 step 2 state that sign_dnt/start_application are unreachable in the standard chat path until A3 replaces the static DEFAULT_DISCOVERY_TOOLS list (the "KNOWN LIVE REGRESSION FIXED BY CONSTRUCTION"). Observed at A1.8 (cloud, live LLM): 0/2 ADVANCED, 0 CEREMONY; agent behaved correctly within the exposed 10-tool set (candidate set, both consents recorded, no confirm-product ceremony, no raw-JSON narration); its only questionnaire-capable tool (set_answer) failed on guessed nonexistent codes. **Ruling: record the honest baseline at A1.8 and read A2.10's sim step the same way (no-regression baseline: CEREMONY must stay 0, no envelope-JSON narration); the 2/2 advance expectation is enforced from A3.7 onward, where the plan itself proves the fix by construction.**
2. **[2026-07-02 — environment]** ANTHROPIC_API_KEY is not available in the cloud container (owner informed; running container cannot receive new session env vars). Owner ruled: run live sims with OpenAI only. Consequence: the Anthropic failover path is untested in live sims on this branch until a keyed session runs them.
