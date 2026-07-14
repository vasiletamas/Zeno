# Zeno v3 model-branch analysis — PAUSED session state

Paused 2026-07-14 (second pause; resumed briefly same day). Target: resumable on
the weekend of 2026-07-18, likely in a FRESH container.

## ⚡ SECOND-PAUSE UPDATE (2026-07-14) — read this first, it supersedes details below

**User's questions to answer in the final report:** (1) which MODEL did best
(grade on experiment endpoints), (2) which BRANCH is best fitted to become main
(judge current heads — fable moved on).

**Branch heads:** opus `0e265bb` (unchanged), codex `845e8a6` (unchanged),
fable endpoint `e4076ba` (= experiment endpoint for model grading), fable LATEST
`533ddd6` (+30 commits: consolidation merges of sales-excellence PR#5 +
autonomy/skills/cost PR#6; see
`docs/superpowers/notes/2026-07-07-fable-branch-consolidation-plan.md` on that
branch — trial-merge-based conflict playbook, honest notes).

**NEW objective gate (fable latest 533ddd6):** tsc clean, **1453/1453 tests
green (283 files)** on fresh DB `zeno_test_fable2` (needs `npx prisma generate`
before tsc/tests — db push alone doesn't regenerate the client; then
`db push` + `db seed`). Log tail: `analysis/gates/gates-fable-latest-tail.txt`.

**Review-fleet results now COMPLETE except 12 adherence audits + verify pass.**
All completed structured outputs are in `analysis/workflow/completed-results.json`
(self-describing `label` field on each entry). Summary of what's in there:
- QUALITY (0–10): opus arch 9 / tests 9; fable arch 9 / tests 9; codex arch 8.5 / tests 9
- BUG HUNTS: fable score 7 (4 findings), opus 6 (7 findings), codex 6.5 (11 findings)
  — findings are UNVERIFIED (the adversarial verify stage was cut short; only
  a few VERDICT entries exist). Treat finding counts with caution until verified.
- HEAD-TO-HEAD rankings: A1+A2 spine → [opus, fable, codex]; D2 coupled flip →
  [fable, codex, opus]; C1+C2 engines → [fable, codex, opus]; F1+F5 verification
  harness → [opus, fable, codex]
- ADHERENCE (0–10): block A: opus 9.5, fable 9, codex 9 · block B: fable 9.5,
  opus 8.5, codex 8 · blocks C/D/E/F: NOT RUN (12 remaining = the main resume work)
- HYGIENE + 6 block RUBRICS: complete (rubrics for C/D/E/F are in the JSON —
  reuse them verbatim in the adherence prompts instead of re-extracting).

**Resume procedure (fresh container):**
1. Rebuild env per "Environment rebuild" below (worktrees pinned: opus 0e265bb,
   fable e4076ba, codex 845e8a6; DBs only needed if re-running tests — normally NOT).
2. Do NOT re-run rubrics/quality/bugs/h2h/hygiene — load
   `analysis/workflow/completed-results.json`.
3. Run the 12 missing adherence audits (blocks C,D,E,F × 3 branches) using the
   cached rubrics — the agent prompt template is in
   `analysis/workflow/zeno-v3-branch-grading.js` (adherence stage).
4. Adversarially verify the serious (critical/major) bug-hunt findings from the
   JSON (refuter prompt template also in the script).
5. Synthesize `analysis/REPORT.md`: per-model grades (adherence, architecture,
   correctness, tests, hygiene, ops/bootstrap) + overall ranking + the
   main-switch recommendation (weigh fable-latest 533ddd6's green 1453-test
   consolidation vs opus/codex endpoints). Push; draft PR #4 already exists.

---

Original first-pause notes (2026-07-06) follow. This file holds everything needed to resume
the analysis without redoing paid work. Task: compare and grade the three branches
that each executed the same transformation plan (26 packages / 199 tasks, base
commit `9a3d7255065371a043b392fc1bdbe186bfa93a33` = the plan commit on `main`).

## The three branches

| Key | Model | Branch | Commits | Window |
|---|---|---|---|---|
| opus | Claude Opus 4.8 | `origin/zeno-v3-opus` | 435 | Jun 13–29 (~16 days) |
| fable | Claude Fable 5 | `origin/zeno-v3-fable` | 230 | Jul 2–3 (~1.5 days) |
| codex | OpenAI Codex | `origin/codex/zeno-v3-transformation-507b` | 205 | Jun 24–30 (~6 days) |

`origin/claude/zeno-v3-transformation-eznkex` == base commit (not a contender).

## COMPLETED: deterministic gates (objective results — do not redo)

All three branches: `tsc --noEmit` = 0 errors. Final test results on fresh
per-branch Postgres DBs (Postgres 16, localhost:5432, role zeno/zeno_dev):

| Branch | Unit | Integration | Total green | Bootstrap friction |
|---|---|---|---|---|
| opus | 1045/1045 (182 files) | 270/270 (91 files) | 1315 | HIGH: needs `db push` + `db seed` + 3 committed index scripts (`scripts/b2-dnt-active-session-index.ts`, `d3-payment-open-attempt-index.ts`, `e1-product-content-unique-index.ts`, run with explicit DATABASE_URL) **+ 2 partial unique indexes that exist only as tracker notes, recreated manually**: `Application_one_open_per_product ON Application(customerId,productId) WHERE status IN ('OPEN','PAUSED','REFERRED')` and `answer_active_unique ON Answer(questionId,applicationId) WHERE status='ACTIVE'` |
| fable | 1157/1157 total, 252 files (unit + integration in one `npm test` run; integration ring = 221 tests/79 files) | (included) | 1157 | LOW: `db push` + `prisma db seed` (seed also creates the partial indexes) |
| codex | 1170/1170 (269 files, includes integration) | (included) | 1170 | LOWEST: `prisma migrate deploy` works from an empty DB (codex authored a baseline `init_current_schema` migration + 23-migration chain incl. partial indexes). NOTE: test harness hardcodes DB name `zeno_codex_test` in `__tests__/integration/test-db-env.test.ts` |

Known pre-existing flake (documented by both opus CLAUDE.md and fable handoff):
`__tests__/lib/events/instrumentation.test.ts` — treat as pass when sole failure.

Gate log tails: `analysis/gates/*.txt`. Env used per worktree (.env): DATABASE_URL
per-branch DB, ENCRYPTION_KEY=64-hex, CONFIRM_TOKEN_SECRET/JWT_SECRET/NEXTAUTH_SECRET
set, PAYMENT_PROVIDER=mock, EMAIL_PROVIDER=mock, DOCUMENT_EXTRACTION_PROVIDER=mock,
dummy OPENAI/ANTHROPIC keys. DBs: zeno_test_opus, zeno_test_fable, zeno_codex_test.

## COMPLETED: self-reported status (verified from branch docs)

- **opus**: claims all 26 packages complete incl. F5 live gauntlet
  (`docs/superpowers/plans/zeno-v3-progress.md` — extremely detailed per-task tracker
  with spec-review/adversarial-review notes), then continued with live-conversation
  debugging (streaming race fix, questionnaire retry, diagnostics ratchet).
- **fable**: claims 25/26; F5 explicitly partial — deterministic gates green, live
  LLM gates blocked on OpenAI quota
  (`docs/superpowers/notes/2026-07-02-zeno-v3-fable-cloud-handoff.md`, checklist §9).
- **codex**: claims F5 complete (`docs/superpowers/plans/zeno-v3-codex-progress.md`
  with red/green evidence per task; headings for B0–B3, D3–D4, all of E are missing
  from the doc, but the code/models for those packages DO exist in the tree).

## IN PROGRESS: multi-agent review workflow (stopped mid-run)

- Run ID: `wf_cc662be7-e30`; script copy: `analysis/workflow/zeno-v3-branch-grading.js`
- Result cache (journal): `analysis/workflow/journal.jsonl` — contains COMPLETED
  results for: all 6 block rubrics (A–F), git-hygiene grading, and ~2 more agents.
- To resume IN THE SAME container: `Workflow({scriptPath: <session script path>,
  resumeFromRunId: "wf_cc662be7-e30"})` — cached agents return instantly.
- In a FRESH container: restore the journal by copying
  `analysis/workflow/journal.jsonl` back to
  `<transcriptDir>/journal.jsonl` won't work across sessions; instead re-launch the
  script (it is self-contained) — only the ~9 completed agents' work is re-paid, or
  mine the cached rubric/hygiene results out of the committed journal.jsonl (each
  `result` line's `result` field is the agent's structured output).
- Remaining when stopped: 18 adherence audits (branch × block), 6 quality reviews
  (arch/tests × branch), 3 bug hunts + adversarial verification, 4 head-to-head
  deep dives (spine, engines, money-flip, verification harness).

## Environment rebuild (fresh container)

1. Worktrees: `git worktree add --detach <scratchpad>/worktrees/{opus,fable,codex} <ref>`
2. `npm ci` in each; write `.env` per above; start postgres (`service postgresql start`),
   create role zeno + DBs; provision per-branch (see Bootstrap friction column).
3. Plan doc: `docs/superpowers/plans/2026-06-12-zeno-v3-transformation-plan.md`
   (11,660 lines; blocks at lines A:63 B:2067 C:3849 D:5649 E:7544 F:9771).

## Remaining work

1. Re-launch/resume the review workflow; collect all structured results.
2. Synthesize graded report (per-branch grades: plan adherence, architecture,
   correctness, tests, hygiene, ops/bootstrap; overall ranking) into
   `analysis/REPORT.md` on this branch.
3. Push, open/update draft PR.
