# Zeno production-readiness assessment — 2026-07-06 (local acceptance run)

**Verdict: NOT production-ready.** Until today's fixes, **no conversation — simulated or human — had ever completed the funnel** on this build: every recorded conversation died in DISCOVERY, most at the DNT signature step. The two "passing" sim scenarios passed vacuously (their goals never executed). 28 findings were confirmed by adversarial verification against recorded evidence (TurnDebug, CommitLedger, DB rows); 7 defects were fixed today, test-first.

Method: 3 stock spec-sims + 1 authored change-answer sim + 1 human conversation, deterministic checker (`scripts/diagnose-conversation.ts`) on each, then a 37-agent evidence-reading pass (per-conversation deep reads + performance/compliance/architecture lenses, every finding adversarially verified). Raw findings: session workflow output; repro commands are embedded per finding there.

---

## Fixed today (test-first; all suites green)

| # | Fix | Where |
|---|-----|-------|
| 1 | DNT pending question code exposed in derived state (`dnt.pendingCode`, handler-identical walk order) and pinned into the per-turn briefing + dntContext — kills the invented-question-code failure (100% of first attempts failed before) | `lib/engines/snapshot-loader.ts`, `lib/engines/domain-types.ts`, `lib/chat/phase-sections-map.ts`, `lib/chat/context-loaders.ts` |
| 2 | `dntContext` re-keyed on `sessionActive` (DNT legally runs in DISCOVERY pre-application; the section never rendered there) | `lib/chat/context-loaders.ts:814` |
| 3 | MULTI_SELECT invalid-option error now lists the valid options (was: 28-turn stall on `DNT_INCOME_SOURCE` when customer said "din salariu") | `lib/engines/questionnaire-engine.ts:130` |
| 4 | `requires_confirmation` envelopes carry a model-facing `_instruction` (card shown; do NOT retry; invite customer to confirm) | `lib/tools/gateway.ts` (both confirm paths) |
| 5 | `confirm_required` card event now emitted from the **LLM tool loop**, not only the GUI-action path — the root of the sign_dnt deadlock: the card never rendered for chat-initiated signing | `lib/chat/orchestrator.ts` (~1195) |
| 6 | Correction guidance in briefing/dntContext (change an already-answered question via THAT question's code; write-or-change) — the model had written a correction request into the current question's code and then falsely told the customer the preference was updated | `lib/chat/phase-sections-map.ts`, `lib/chat/context-loaders.ts` |
| 7 | Anti-fabrication rule in dntContext (never write values the customer didn't state) — the model had persisted invented `DNT_FAMILY_SIZE="2"` and `DNT_LIFE_SUBTYPE="Protecție simplă"` after bare "da" replies | `lib/chat/context-loaders.ts` |

Harness/test-infra fixes: sim runner now replays `confirm_required` cards as customer clicks (`scripts/sims/run-spec-sims.ts`); new change-answer scenario `scripts/sims/run-change-answer-sim.ts` with DB-evidence asserts; `TEST_DATABASE_URL` (zeno_test) so the integration ring never touches dev data.

---

## Open findings (confirmed, ranked)

### P0 — funnel-blocking / regulatory

1. **Fabricated regulatory answers (CRITICAL) — FIXED 2026-07-06 (late session).** Deterministic write-guard live at all four value-writing commits (`write_dnt_answer`, `write_question_answer`, `modify_answer`, `collect_customer_field`): agent-actor writes whose value has no anchor are rejected `value_not_grounded`. Grounding paths (pure module `lib/engines/anti-fabrication.ts`): customer words (digits, RO number words, dates incl. CNP-embedded yymmdd), enum option-label overlap ("din salariu" → salary_pension), confirmed proposal (CONTEXT-HIT flow), already-recorded value (idempotent re-writes). GUI/operator actors bypass — a card click is first-party input. Diagnostics net: `questionnaire_answer_fabricated` (same module — write-guard and audit cannot drift) + `state_claim_without_commit` ("am corectat…" prose in a turn that committed nothing — the recorded lie of run `cmr940u78`). Validated: happy-path sim PASSES end-to-end with the guard live (conv `cmr9n7ieo…`, zero guard hits — grounded conversations pass untouched); zero false positives replaying all three recorded scenario exports; 15 pure + 8 integration + 9 diagnostics tests. Suite: 1268/1268.
2. **GDPR consent timing (CRITICAL) — FIXED 2026-07-06 (late session, ratified option 2).** Pre-sign DNT collection documented under GDPR Art. 6(1)(b) (steps at the data subject's request prior to a contract — the customer asked for the recommendation; the needs analysis is that step); explicit `gdpr_processing` consent for continued processing stays captured at sign_dnt (the consent-labelled card CTA, B1.5). The basis lapses with an abandoned request: `cleanupUnsignedDntSessions` (`lib/gdpr/retention-cleanup.ts`, runner `scripts/run-retention-cleanup.ts` for ops cron) deletes unsigned drafts inactive beyond 30 days (`legalReviewPending` — compliance to confirm the window). Basis documented on the `dnt_unsigned_sessions` policy row. Tests: `retention-cleanup.test.ts`.
3. **CNP stored in plaintext (HIGH) — FIXED 2026-07-06 (late session).** `write_dnt_answer` persists `maskCnp(value)` for DNT_CNP — the AES-GCM profile envelope is the only carrier of the real identifier (also stops the full CNP leaking into dnt facts / `get_current_state` / the prompt). Erasure scrubs legacy raw rows in surviving signed sessions to the ERASED marker. UPDATE-session prefill handles the mask (as-is), raw legacy values (re-mask), and the erasure marker (re-ask). Tests: `dnt-cnp-protection.test.ts` + the sign-dnt renewal suite.
4. **Checksum-invalid CNP silently accepted (HIGH).** `1960229410014` fails the checksum; the answer saves, the profile mirror silently skips, age/residency eligibility facts can never derive, and the customer is never asked to re-check.
5. **Pending-confirmation is invisible to the engine (HIGH).** After `requires_confirmation`, `nextBestAction` still says `call sign_dnt` every turn — the derived state has no "awaiting customer confirmation" concept, so the model is re-pushed into the trap. Persist the pending token; block the tool with `awaiting_customer_confirmation`; add a loop-breaker (N identical reissues → vary guidance/escalate).
6. **BD-medical confirmations are a dead end even in the GUI (HIGH).** `confirm-required-card.tsx` whitelists `CONFIRMABLE_TOOLS=['sign_dnt','accept_quote']` — `write_question_answer`/`modify_answer` confirmations render **no card**, and their cross-turn token has no carrier; the first sensitive medical question would deadlock a real application. Same class as the sign_dnt bug, one funnel stage later.
7. **`questionnaireContext` is permanently null (HIGH) — FIXED 2026-07-06 (late session).** The section now derives entirely from the conversation's active application through the same engine path the tools use (canonical group codes with the addon-gated bd_medical set, `getNextQuestion`'s visible unanswered question with its EXACT code, progress, CONTEXT-HIT incl. the medical-affirmation audit log); null for terminal/frozen applications. The dead workflow-step helpers are retired. Tests: `questionnaire-context.test.ts` (integration) + the rewritten context-hit unit suite.

### P1 — resilience / observability (production-blocking for ops)

8. **Fallback model is retired (HIGH) — FIXED 2026-07-06 (late session).** main-chat fails over to `claude-sonnet-5`; `classifyError` maps 404 (retired model / dead endpoint) to `provider_down` so failover actually triggers; a seed test pins that no agent runs on or fails over to a retired model. (Local `.env` still has a placeholder `ANTHROPIC_API_KEY` — failover stays dead locally until a real key lands; ops item, not code.)
9. **Token/cost accounting records zero, always (CRITICAL for ops) — FIXED 2026-07-06 (late session).** Both OpenAI stream emitters finish the stream before emitting `done` (the usage rides a FINAL chunk after `finish_reason`); both Anthropic emitters now read `message_start`/`message_delta` usage. **Verified live: 48/48 turns of the final happy-path run record nonzero input tokens (6k–27k).** Tests: `streaming-usage.test.ts` (synthetic streams, both providers, text + tool paths).
10. **"LLM retry detected" anomaly is 100% false positive.** It fires on the normal second LLM round of every tool-calling turn (97/97 with tool calls, 0/3 without); real retries inside `executeWithRetries` emit **no event**. Replace the call-count heuristic with dedicated `llm:call:retry` / `llm:failover` events.
11. **`requires_confirmation` failures are invisible to diagnostics.** A 52-failure funnel-killing deadlock produced zero warn/error findings — the failures carry no error string and `confirm_token_reissued` is info-only. Escalate repeated reissues for the same argsHash to error.
12. **Silent turn failures / dead air.** The human user's first two messages were persisted, never answered, and produced **no TurnDebug row** (13 minutes of dead air, zero diagnostics). Persist a TurnDebug row with the error on aborted turns; show a user-visible retry affordance.
13. **Turn latency.** Multiple `llm_tools` phases >10s (worst 18.3s) on GPT-5.4 with two LLM rounds per turn. Consider fast-path answers (there is a fast-path gate already), smaller model for the tool round, or streaming-first UX.

### P2 — test integrity / quality

14. **Vacuous sim passes.** `dnt-refusal` PASSED without ever emitting the refusal (turn cap hit first); `quote-decline` PASSED without ever generating a quote (asserts are style-only; `goalReached` is only an early-exit). Make goal completion a pass criterion; the stalled transcripts were even recorded as golden fixtures (`__tests__/fixtures/exports/*.export.json`) — re-record all three after the confirm fixes.
15. **Tool schema/description inconsistency.** All six `requiresConfirmation` commits omit `confirmToken` from LLM-facing schemas (`additionalProperties:false`) while four descriptions say "re-call with the token" — the documented recovery is schema-illegal. Decide per tool: GUI-card-only (then fix the descriptions) or model-resendable (then add the param). Consent tools should arguably stay GUI-only.
16. **UX polish.** Raw enum tokens sometimes shown to customers (`salary_pension`, `middle_school`); the agent identifies the right option from free text but re-asks instead of writing it; repeated near-identical messages during stalls (checker: `repeated_assistant_message`, similarity 1.0).

---

## Sim scoreboard (before → after fixes)

| Scenario | Before | After |
|---|---|---|
| happy-path | FAIL — 28-turn invalid-option stall, then 54-turn sign_dnt loop, died in DISCOVERY | rerun in progress at time of writing (DNT now completes cleanly; signing card now emitted + replayed) |
| dnt-refusal | "PASS" (vacuous — refusal never sent) | needs maxTurns raise + non-vacuous assert (P2 #14) |
| quote-decline | "PASS" (vacuous — no quote ever issued) | needs goal-as-pass-criterion (P2 #14) |
| change-answer (new) | agent falsely claimed a correction it never wrote | correction genuinely lands (final value flips); agent now refuses to misroute and points to the right question |

Conversations for browsing (admin → conversations): happy `cmr92ez24…`, refusal `cmr92mhtz…`, decline `cmr92nsrs…`, change-answer `cmr93ef09…`, manual `cmr90g5tk…`.

## Final scoreboard (end of 2026-07-06 session, all fixes applied)

- **Test suite: 1175/1175 green** (registry tests relocated to the integration ring; two instrumentation double-mock flakes made deterministic).
- **Change-answer scenario: PASS** — marketing consent verifiably flips yes→no in the DB on the customer's correction request, agent's claim matches recorded state, funnel continues to signing.
- **Happy-path (conv `cmr96b8su…`): DNT 11/11 with one immediately-recovered rejection → sign_dnt confirmed via card in 1s → application → coverage → BD-medical answer confirmed via card → QUOTE ISSUED (12:07:54) → identity fields + channel verification all applied.** Remaining gap: the accept_quote → disclosures → payment → policy segment was never attempted (sim answer policy has no patterns for disclosure acks / accept ask; possible real defects behind it remain unmeasured). That segment is the next simulation target.
- P0 fixes landed this session beyond the original seven: pending-confirmation in derived state + briefing (P0-5), confirm-card coverage incl. BD medical (P0-6), CNP checksum rejection at the DNT (P0-4, with the personas fixture re-modeled), `confirmation_stalled` + `dnt_answer_fabricated` diagnostics checks (ratchet).

## FINAL SCOREBOARD — post-quote validation complete (2026-07-06 evening)

- **happy-path: PASS end-to-end for the first time** (conv `cmr9eli9n…`):
  DNT 11/11 → sign card → application → addon cascade → 6 BD answers (no
  per-answer cards) → **ONE batch medical signature** → quote 390 RON/an
  (addon priced in) → disclosures acked → identity collected via DECOMPOSED
  needs (`declared:dateOfBirth`, `declared:phone`) → channel verified →
  **accept_quote confirmed via card (advance_phase)** →
  ensure_payment_session → settlement → **installment PAID + Policy
  PENDING_SUBMISSION + MedicalDeclarationSignature row**. All
  fullFunnelDbChecks green. The run survived a 2.5h LLM-provider outage
  (circuit opened and recovered) — the only checker error is that turn's
  duration.
- **dnt-refusal: PASS. quote-decline: PASS.** (1/1 each, post-change rerun.)
- **Test suite: 1234/1234 green** (998 unit + 236 integration; was 1177 at
  session start). Happy-path fixture re-recorded through POLICY.
- Sim iteration count: 7 live runs, each stall root-caused from
  CommitLedger/TurnDebug evidence — full trail in
  `2026-07-06-cmr99s5cb0001ms0e9er0j0ii.md`.

## Addendum 2 — post-quote validation session (2026-07-06 evening)

**Ratified spec deviation (product owner): T6.D3 batch medical signature.**
Per-answer `CONFIRM_ALWAYS` cards made the medical questionnaire seven
confirmations long (user-reported UX defect). `CONFIRM_ALWAYS` now means
(a) member of the batch medical declaration signed ONCE via the new
`sign_medical_declarations` commit (sign_dnt precedent — one card summarizing
all declarations) and (b) confirm-on-modify with cascade preview.
Implementation (all test-first; engineVersion 1.34.0): consequence-planner
rule change, `MedicalDeclarationSignature` model (hash-bound to active
revisions — a later modify unsigns by recomputation, nothing cleared),
`medical_declarations_unsigned` gate on generate_quote, conditional-confirm
handler + registry + GUI card + action adapter, agent-prompt completion rule.
New suites: `__tests__/lib/engines/medical-declarations.test.ts`,
`__tests__/integration/sign-medical-declarations.test.ts`.

**New findings from post-quote sim runs** (evidence in
`docs/debug-reports/2026-07-06-cmr99s5cb0001ms0e9er0j0ii.md`):
- **D-NEW-1 (P1):** `set_application` idempotent replay makes the advertised
  cancel_quote → re-apply recovery a dead end in the same conversation.
- **D-NEW-2 (P2):** `collect_customer_field` accepted `"da"` as the customer
  name (minLength-only validation).
- **D-NEW-3 (P0-1 evidence):** agent fabricated a plausible cuid as a tool
  argument (`set_candidate_product`), unrecovered → cascaded into quote
  cancellation. Fabrication reaches TOOL ARGS, not just prose.
- **D-NEW-4 (fixed, ratchet):** 4 read tools registered without
  `sideEffects: false` ran in the writing partition and spammed
  `missing_consequences`; registry invariant test added.
- **D-NEW-5 (fixed, ratchet):** `blocked_action_attempted` judged same-turn
  commits against the stale turn_start snapshot; rolling baseline added.
- **D-NEW-6 (FIXED same session):** `escalate_to_human` applied 45× fresh in
  one conversation. The handler now absorbs repeats while an OPEN/IN_PROGRESS
  ESCALATION work item exists for the conversation (`already_escalated`
  reason code; resolved items permit legitimate re-escalation; the exposure
  floor is deliberately untouched — always-reachable human is a safety
  invariant). Tests: `__tests__/integration/escalate-to-human.test.ts`.

## Addendum — post-fix validation observations (run `cmr940u78…`)

- **Anti-fabrication rule verified live:** faced with 28 consecutive unusable replies ("da" to the family-size question), the agent refused to invent a value every single time and re-asked with exact options — previously it fabricated "2" after five attempts. (This correctly exposed a sim-script gap: the scripted customer had no family-size answer pattern; both answer policies now fixed.)
- **State-claim discipline still fails under pressure (P0-1 evidence):** in the same run the agent said "răspunsul corect rămâne NU" about the marketing consent while the recorded value stayed `yes` — a semantic state claim the pattern-based narration constraint does not catch. The deterministic guard (compare claimed state transitions against ledger/DB deltas per turn) remains the top open item alongside the fabrication write-guard.
