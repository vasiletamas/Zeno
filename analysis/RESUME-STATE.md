# Zeno v3 model-branch analysis — PAUSED session state

Paused 2026-07-06 at the user's request. This file holds everything needed to resume
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
