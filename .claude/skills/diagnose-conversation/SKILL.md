---
name: diagnose-conversation
description: Root-cause a Zeno conversation from recorded evidence — deterministic checker first, raw rows second, prose never. Use when a conversation misbehaved (stall, wrong claim, failed commit, deadlock) or when a sim/CI triage run flags findings.
---

# Diagnose a conversation (T14.D6 layer 2)

Evidence rule: **never diagnose from conversation prose.** The recorded
state — TurnDebug payloads, CommitLedger rows, legality snapshots — is the
evidence; the transcript is only a pointer into it.

## Procedure

1. **Run the checker and treat its findings as ground truth.**

   ```bash
   npx tsx scripts/diagnose-conversation.ts <conversationId> --json
   ```

   (Batch triage: `--all --since=7`; CI mode over exported files:
   `--dir=artifacts/sims`.) If the checker reports nothing but the report
   claims misbehavior, suspect a checker gap — see step 5.

2. **Pull the raw evidence for every flagged turn.** Query the DB and read
   recorded state FIRST (verify-from-source):
   - the TurnDebug payload (`prisma.turnDebug.findMany({ where: { conversationId } })`) —
     legality snapshots (turn_start + post_commit), tool calls/results,
     prompt sections, totals.anomalies;
   - the CommitLedger rows (`prisma.commitLedger.findMany({ where: { conversationId } })`) —
     outcome, effects, reasonCode, idempotencyDisposition, targetRef;
   - the relevant domain rows (Application/Quote/Dnt/ConsentEvent/…).
   Confirm the finding's evidence field against the raw rows before
   reasoning further.

3. **Root-cause into the codebase.** Classify as exactly one of:
   `prompt-content` / `engine-rule` / `handler-bug` / `tool-exposure` /
   `data-seed` / `llm-behavior`. Cite file:line for the owning surface
   (ACTION_RULES and derivePhase in lib/engines/derive-and-expose.ts,
   gateway order in lib/tools/gateway.ts, handlers in lib/tools/handlers/,
   prompt sections in lib/chat/context-loaders.ts, seeds in prisma/seeds/).

4. **Write the report** to `docs/debug-reports/<date>-<conversationId>.md`
   with sections: **What happened / Where (file:line) / Why / Concrete fix /
   Prevention.**

5. **RATCHET RULE (mandatory exit criterion).** If the investigation
   surfaced an issue class the checker missed, add a new deterministic
   check to `lib/diagnostics/` TEST-FIRST before closing. The catalog only
   grows. Severity refinements count (precedent: tool_call_failed's
   recovered/unrecovered split came from a triage pass) — but never weaken
   a check to silence a finding you have not root-caused.
