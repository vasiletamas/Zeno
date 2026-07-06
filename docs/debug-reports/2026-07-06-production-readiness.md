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

1. **Fabricated regulatory answers (CRITICAL, partially mitigated).** The model persisted DNT answers the customer never gave (family size "2" after five bare "da"; life-subtype "Protecție simplă" — the suitability-driving fact) in two conversations. Fix #7 adds the prompt rule, but a **deterministic guard** is still needed: reject/flag questionnaire writes whose value has no anchor in the customer's recent messages, plus a diagnostics check (ratchet rule) so fabrications can never pass silently. Evidence: refusal conv turns 34/40, happy conv turns 84/92.
2. **GDPR consent timing (CRITICAL).** Personal data (CNP, income, occupation, family, education) is collected and persisted while recorded consent state is `GDPR consent: missing`; `sign_dnt` is *the sole consent-capturing commit* and sits at the END of collection. All four customers: full data sets, **zero ConsentEvent rows**. Either capture `gdpr_processing` consent at `open_dnt_session` (before CNP), or document the Art. 6(1)(b) pre-contractual basis and add retention cleanup for unsigned sessions.
3. **CNP stored in plaintext (HIGH).** `DntAnswer.value` holds the raw 13-digit CNP; the AES-GCM envelope stores (`Customer.cnpEncrypted`, `CustomerProfileField`) are empty — violating the schema's own rule (`schema.prisma:650`). Erasure executor does not cover these rows. `lib/tools/handlers/dnt-handlers.ts:328-341`.
4. **Checksum-invalid CNP silently accepted (HIGH).** `1960229410014` fails the checksum; the answer saves, the profile mirror silently skips, age/residency eligibility facts can never derive, and the customer is never asked to re-check.
5. **Pending-confirmation is invisible to the engine (HIGH).** After `requires_confirmation`, `nextBestAction` still says `call sign_dnt` every turn — the derived state has no "awaiting customer confirmation" concept, so the model is re-pushed into the trap. Persist the pending token; block the tool with `awaiting_customer_confirmation`; add a loop-breaker (N identical reissues → vary guidance/escalate).
6. **BD-medical confirmations are a dead end even in the GUI (HIGH).** `confirm-required-card.tsx` whitelists `CONFIRMABLE_TOOLS=['sign_dnt','accept_quote']` — `write_question_answer`/`modify_answer` confirmations render **no card**, and their cross-turn token has no carrier; the first sensitive medical question would deadlock a real application. Same class as the sign_dnt bug, one funnel stage later.
7. **`questionnaireContext` is permanently null (HIGH).** `loadAllSections` passes a hard-coded `workflowStepCode=null` ("dead input") and the orchestrator never patches it — the APPLICATION/QUESTIONNAIRE stage has NO current-question surface (same bug as the fixed DNT one, next stage over). Current question text/options/context-hit/medical-affirmation logging are all unreachable. Render it from derived state like `dntContext` (fix #1/#2 pattern).

### P1 — resilience / observability (production-blocking for ops)

8. **Fallback model is retired (HIGH).** `main-chat` fails over to `claude-sonnet-4-20250514` (retired 2026-06-15). And `lib/llm/errors.ts` doesn't classify 404/model-not-found (falls to 'unknown' → no retry, no failover). When OpenAI goes down, failover 404s and the customer turn dies. Update the seed to a current model; classify 404; validate configured model IDs at startup. (Local `.env` also still has a placeholder `ANTHROPIC_API_KEY`.)
9. **Token/cost accounting records zero, always (CRITICAL for ops).** `openai.ts` yields the `done` chunk on `finish_reason` — but with `stream_options.include_usage` OpenAI sends usage in a LATER chunk; usage is never emitted (Anthropic streaming path emits none at all). All 200 recorded turns: `totalInputTokens: 0`. Cost monitoring, cache-hit monitoring, and the >50k-token anomaly are all dead.
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

## Addendum — post-fix validation observations (run `cmr940u78…`)

- **Anti-fabrication rule verified live:** faced with 28 consecutive unusable replies ("da" to the family-size question), the agent refused to invent a value every single time and re-asked with exact options — previously it fabricated "2" after five attempts. (This correctly exposed a sim-script gap: the scripted customer had no family-size answer pattern; both answer policies now fixed.)
- **State-claim discipline still fails under pressure (P0-1 evidence):** in the same run the agent said "răspunsul corect rămâne NU" about the marketing consent while the recorded value stayed `yes` — a semantic state claim the pattern-based narration constraint does not catch. The deterministic guard (compare claimed state transitions against ledger/DB deltas per turn) remains the top open item alongside the fabrication write-guard.
