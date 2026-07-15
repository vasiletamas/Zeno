# Debugging conversations — the three-level stack

Zeno's conversation debugging works over ONE substrate: the recorded
per-turn evidence (TurnDebug payloads with legality snapshots, the
CommitLedger, ConversationExport v2). Three levels consume it:

| Level | Tool | When |
|---|---|---|
| 1 — live | **Debug drawer** (dev only, toggle in chat) | while reproducing: per-turn Legality chips (available green / blocked red with reason codes, engine+content versions), anomaly badges from the runtime invariant monitors, the Commit timeline panel, the `recompute` button (replay diff), `download` (the v2 export) |
| 2 — deterministic | **Checker CLI** — `npx tsx scripts/diagnose-conversation.ts <id>` \| `--all --since=N` \| `--dir=artifacts/sims` | triage: single conversation, dev-DB batch, or CI over exported sims; exit 1 iff any error-severity finding |
| 3 — root cause | **/diagnose-conversation skill** | investigation: checker findings → raw rows → file:line root cause → report in docs/debug-reports/ → ratchet |

## The evidence rule

**Never diagnose from conversation prose.** The transcript is a pointer;
the recorded state is the evidence. Every claim must be verified against
TurnDebug payloads, CommitLedger rows, or domain tables before it goes in
a report.

## Where artifacts live

- **TurnDebug** (Postgres): one row per turn, payload = the full DebugTurn
  (identity, gate, legality snapshots, prompt sections, tool calls+results,
  narration verdicts, totals incl. anomalies).
- **CommitLedger** (Postgres): every write attempt — outcome, effects,
  reasonCode, idempotencyDisposition, targetRef; post_commit legality
  entries join turns to rows via `commitLedgerId`.
- **artifacts/sims/**: exported ConversationExport JSON per sim trial
  (gitignored); the first passing trial per scenario is committed under
  `__tests__/fixtures/exports/`.
- **docs/debug-reports/**: skill-produced root-cause reports.
- **artifacts/judge/**: non-gating LLM-judge verdicts (trend data only).

## Recompute-and-diff: bug vs changelog

The replay (`scripts/replay-conversation.ts <id>`, the drawer `recompute`
button, or the checker's `recompute_drift` finding) re-runs deriveAndExpose
over the STORED redacted snapshots and diffs against the stored verdicts:

- **same engine version + diff = BUG** (`same_version_drift`, exit 1) —
  the engine is not deterministic over its inputs, or a rule changed
  without an engineVersion bump;
- **different version + diff = behavioral changelog**
  (`cross_version_change`, informational).

Caveat: a few rules are time-dependent (quote expiry, free-look window,
DNT-expiring) — replaying OLD conversations can surface time-driven diffs
that are neither. Replay soon after recording for a clean signal.

## Flake policy and n-of-m

- Unit suite: `__tests__/lib/events/instrumentation.test.ts` is the ONE
  documented flake — a run counts as PASS iff it is the sole failure AND
  passes in isolation. Anything else blocks.
- Live sims (`npm run sims:spec -- 3 2`): scenario PASS = ≥2 of 3 trials
  (T12.D4 n-of-m); single-trial variance is expected LLM behavior, a
  scenario failing its threshold is a regression.
- LLM judges (`npm run sims:judge`): NEVER gate — trend data only.
