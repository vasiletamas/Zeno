# Zeno prompt-section inventory + M13 pathology baseline (A4.1)

Behavioral-content inventory taken BEFORE the A4 sections rework (M13 criteria
a–c). Every `SECTION_REGISTRY` key appears exactly once with a destination or
a "retired because X" note. Pathology baselines are recorded verbatim below
and re-run after the rework (A4.5, criterion d).

## 1. Pathology baseline — BEFORE the rework (criterion a)

Command: `npx tsx scripts/verify-pathology1.ts 3 && npx tsx scripts/verify-pathology2.ts && npx tsx scripts/verify-pathology3.ts && npx tsx scripts/verify-pathology4.ts`

Run 2026-07-02 (cloud, live OpenAI). Verbatim summary lines:

```
P1: ==== 3/3 trials fully detector-clean ====
P2: ==== stalls-after-"da" across 2 trials: 0 (lower = better; advances instead of interrogating) ====
P3: ==== across 3 trials: BLIND choices=0 (want 0), INFORMED choices=3 ====
P4: ==== 3/3 trials clean (pivots to Protect, no invented categories) ====
```

ALL FOUR CLEAN — criterion a satisfied; the rework may proceed.
(Sandbox note: the pathology scripts print their verdict and then linger on
open handles instead of exiting — P2–P4's "EXIT 143" in the raw log is the
supervisor reaping the already-finished process AFTER its verdict printed,
not a failure. P1 exited 0 on its own.)

## 2. Section inventory (criterion c: every key, exactly once)

Sources read: `lib/chat/prompt-builder.ts` SECTION_REGISTRY (15 keys), every
loader in `lib/chat/context-loaders.ts`, `lib/chat/phase-sections-map.ts`,
seeded `Agent.systemPrompt`/`constraints` in `prisma/seeds/seed-agents.ts`.

Scenario labels: P1 tool-narration, P2 deflection loop, P3 blind forced
choices, P4 empty-category, CAT catalog-overview guardrails, OOS
out-of-scope decline, CP consultative pushback.

| # | Section key | Behavioral rules carried (quoted/condensed) | Serves | Target home |
|---|---|---|---|---|
| 1 | `agentIdentity` | The seeded MAIN_CHAT_PROMPT: first-turn disclosure ("Sunt Zeno, consilier virtual… un sistem"; never "AI"; insurer disclosed at first product mention, not opener; no products named on turn 1; ONE open question); HUMAN HANDOFF reactive + async only; CORE BEHAVIORS (listen first, explain simply, honest about unknowns); CUSTOMER SIGNAL AWARENESS; PRODUCT KNOWLEDGE catalog-vs-specifics ("generic training knowledge is NOT a valid source"); "TOOL USE IS INVISIBLE INFRASTRUCTURE" (forbidden "vrei să verific…" family; read tool errors for preconditions, never swallow); PRODUCT DISCOVERY GUARDRAILS 1–6 (catalog-first, name-from-catalog/quote-from-tool, grounded discovery dimensions, ranges-vs-quote pricing, one question per turn, insurer disclosure); PACING; ANSWER FIRST — DON'T DEFLECT (bare "da" = act now); OFF-TOPIC HANDLING | P1, P2, P3, P4, CAT, OOS, CP | UNCHANGED — phase-agnostic constitution, ALWAYS |
| 2 | `constraints` | Seeded constraints JSON: no invented URLs; no fake forms; no promises without tool actions; past tense for completed actions; insurance/financial only; CURRENT SYSTEM STATE is ground truth (✗ facts cannot be claimed); no side-effect claims in prose ("am notat/am salvat/I saved…" forbidden — tools render confirmations) | P1, OOS, CP | UNCHANGED — ALWAYS |
| 3 | `stateGrounding` | "=== CURRENT SYSTEM STATE (ground truth — do not contradict) ===" ✓/✗ facts (workflow, application, product, GDPR consent, AI disclosure) + "You cannot claim to have completed any of these. To change state, call the matching tool and wait for its success." | P1, CP | UNCHANGED — ALWAYS. (B1 re-points the consent facts to ConsentEvent when the Customer columns drop.) |
| 4 | `capabilityManifest` | "My tools for this conversation: …" + "I can only act through these tools." Fed from engine exposure since A3.1 (patched after gate). | P1 | DISCOVERY (target map) |
| 5 | `catalogOverview` | "These are the ONLY products in the catalog… Any category NOT listed here is NOT available — never imply otherwise"; empty-catalog sentinel "nothing to sell" | P4, CAT | UNCHANGED — ALWAYS |
| 6 | `productContext` | Product name/type/description, key features, premium RANGE only ("Exact pricing is available only via generate_quote"), addon coverage amounts + waiting period | P3, CAT | DISCOVERY; QUOTE; APPLICATION/QUOTE_GENERATION. RETIRED from PAYMENT/POLICY because the sale is closed — product pitching post-close is pathology surface, and post-sale product facts belong to get_policy_info (D4). |
| 7 | `coachingBriefing` | WorkflowStep.salesPlaybook (dead source — no WorkflowSession ever exists) falling back to Product.defaultPlaybook: sales-coaching prose | CP | DISCOVERY only. RETIRED from QUOTE + APPLICATION/QUOTE_GENERATION because closing coaching after the customer has already converged adds pressure where compliance risk is highest (T10.D4); the QUOTE surface keeps productContext + complianceGuidance instead. |
| 8 | `domainGuidance` | Populated ONLY by mergeSkillPackSections (PACK_WRITABLE_KEYS = {domainGuidance}); no phase map references it | — | NO A4 CHANGE — the key exists only as the skill-pack injection slot; the entire SkillPack subsystem is deleted in A5 (M12 salvage-audit first). Recorded here so its retirement is deliberate, not silent. |
| 9 | `complianceGuidance` | Injected by the orchestrator when the compliance checker flags rules (rulesForPhase: narrow PRESENTATION_RULES in DISCOVERY, full IDD/GDPR set elsewhere) | CP, legal | APPLICATION/DNT; APPLICATION/QUESTIONNAIRE; APPLICATION/QUOTE_GENERATION; QUOTE. NOTE: the compliance CHECKER still runs for PAYMENT/POLICY (COMPLIANCE_RELEVANT_BY_PHASE unchanged); only the static guidance section is dropped there — the new paymentContext/policyContext carry the phase-specific compliance language (no in-force claims before ACTIVE, no selling post-close). |
| 10 | `situationalBriefing` | formatDerivedBriefing: Phase/subphase, engine nextBestAction, product, selection, remaining question codes, flagsForReview (A3.ADD-1), available actions, blocked actions with reason codes + "NEVER work around a blocked action" (A3.3) | P2, P3, CP | UNCHANGED — ALWAYS; A4.4 adds per-stage facts (DNT remaining, quote validUntil, payment status). |
| 11 | `customerMemory` | "=== RETURNING CUSTOMER ===" insights by category, >30-day entries marked "(unverified)", token-capped | CP | DISCOVERY (target map) |
| 12 | `agentKnowledge` | "=== PROVEN PATTERNS ===" AgentKnowledge rows (min n=5, top 5 by success rate) | CP | DISCOVERY (target map) |
| 13 | `customerContext` | "=== CUSTOMER PROFILE ===" name/language/age/anonymous + extractedProfile demographics, family, motivations, interests | CP | DISCOVERY (target map) |
| 14 | `workflowInstructions` | "=== ACTIVE WORKFLOW ===" step name/instructions/allowed tools/collected data — loader keyed on WorkflowSession | — | RETIRED because the workflow machine is dead config: WorkflowSession rows are never created in the phase-derived architecture, so the loader has returned null on every live turn since the machine died; its behavioral value (per-step instructions + tool list) is superseded by situationalBriefing + the engine-computed tool list (A3.1). Nothing to salvage: the step prose lives only in seed-workflows.ts rows that A5 deletes (M9 — history disposable). Removed from ALWAYS in A4.3. |
| 15 | `questionnaireContext` | "=== ACTIVE QUESTIONNAIRE ===" progress, current question + type + options (P3: present REAL options, never invented), CONTEXT-HIT block ("DO NOT RE-ASK — confirm the extracted value"; medical hits require explicit DA/NU affirmation) | P3, CP | APPLICATION/QUESTIONNAIRE (target map). ⚠ KNOWN LATENT GAP (pre-existing, NOT introduced by A4): loadQuestionnaireContext still keys on workflowStepCode, which is always null since the workflow machine died — the section renders null on live turns. The questionnaire tool surface + its context re-keying are owned by C1 (ruling 7); A4 keeps the section mapped so C1 has a home to light up. |

## 3. Old → new mapping (criterion b)

| Old (A1 content-preserving map) | New target home (T10.D4) |
|---|---|
| ALWAYS: agentIdentity, constraints, stateGrounding, catalogOverview, situationalBriefing, **workflowInstructions** | ALWAYS loses workflowInstructions (retired — dead machine, see §2 row 14) |
| DISCOVERY (old DISCOVERY ∪ old SELECTION): capabilityManifest, customerContext, customerMemory, agentKnowledge, productContext, coachingBriefing | DISCOVERY: unchanged set — SELECTION's product/coaching content stays absorbed here |
| old CONSENT payload → APPLICATION/DNT: complianceGuidance | APPLICATION/DNT: **dntContext (new)** + complianceGuidance — the DNT/consent compliance payload gets a dedicated per-state section |
| APPLICATION/QUESTIONNAIRE: questionnaireContext, complianceGuidance | unchanged |
| APPLICATION/QUOTE_GENERATION (old QUOTE ready-to-generate): productContext, coachingBriefing, complianceGuidance | productContext, complianceGuidance — coaching retired (§2 row 7) |
| QUOTE (old QUOTE set): productContext, coachingBriefing, complianceGuidance | productContext, complianceGuidance — coaching retired (§2 row 7) |
| PAYMENT (old CLOSING set): productContext, complianceGuidance | **paymentContext (new)** — schedule facts, failure recovery, "the sale is closed — no selling, no upgrades" (productContext/complianceGuidance retirements: §2 rows 6, 9) |
| POLICY (old CLOSING set): productContext, complianceGuidance | **policyContext (new)** — policy status + engine-gated language ("never describe the policy as active or in force unless status is ACTIVE") |

Binding note A4.ADD-1: the APPLICATION-phase section copy must include the
T4-R6 soft channel-verification offer ("save your progress") shown only while
`identity.tier !== 'verified_channel'` — trigger data arrives with B3's
`verificationOffer` envelope flag (B3.ADD-3); the copy lands in the DNT/
questionnaire context sections when B3 provides the flag. Tracked here so
M13's inventory covers it.

## 4. Seeded agent prose (seed-agents.ts)

MAIN_CHAT_PROMPT and the main-chat constraints were swept for retired phase
vocabulary in A1.7 (clean). No A4 prompt-prose changes required by the
inventory: every behavioral rule in §2 row 1–2 is phase-agnostic
constitution content and keeps its home.

## 5. Completeness check (criterion c)

15/15 SECTION_REGISTRY keys inventoried exactly once: rows 1–15 above.
New keys added by A4.2: dntContext, paymentContext, policyContext (see §3).
No rule dropped without a retired-because-X note (rows 6, 7, 9, 14 carry
them).

## 6. Pathology verification — AFTER the rework (criterion d, A4.5)

Run 2026-07-02 (cloud, live OpenAI), same commands plus advance-flow.
Verbatim summary lines:

```
P1: ==== 3/3 trials fully detector-clean ====
P2: ==== stalls-after-"da" across 2 trials: 0 (lower = better; advances instead of interrogating) ====
P3: ==== across 3 trials: BLIND choices=0 (want 0), INFORMED choices=3 ====
P4: ==== 3/3 trials clean (pivots to Protect, no invented categories) ====
AF: ==== advance-flow: 2/2 trials PASS (advanced into DNT, no confirm-product ceremony) ====
```

ALL CLEAN after the rework — identical verdicts to the baseline, and the
sections rework did not re-introduce advance-flow stalls (2/2). M13 criteria
a–d all satisfied.
