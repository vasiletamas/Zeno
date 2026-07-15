# Dead-config salvage audit — SkillPacks + Workflow machine (A5.1, M12 mandatory-first)

Sources audited in full: `prisma/seeds/seed-skill-packs.ts` (7 packs),
`prisma/seeds/seed-workflows.ts` (2 workflows, 12 steps of agentInstructions).
Every guidance paragraph is listed with: still true? → new home, or
"retired because X". Playbook PRICES are always retired (M12). Phantom tools
referenced by dead config (`save_customer_field`, `get_quote`,
`get_policy_details` — never registered) carry nothing to port.

## Skill packs

### 1. life-insurance-discovery (domainGuidance)
| Guidance | Still true? | Disposition |
|---|---|---|
| One question per turn; listen actively | yes | RETIRED — duplicate of MAIN_CHAT_PROMPT guardrail 5 (already home) |
| "No prices / no get_product_info in first 2 turns even if the customer names the category" | **no** | RETIRED because it contradicts the pathology-fixed behavior: catalog-first guardrail 1(b) + ANSWER-FIRST require naming the matching product and answering immediately; the P2 deflection fix exists precisely because this rule caused stalling |
| Single-match category → skip qualifying interrogation, present the product directly, ONE deepening question, never repeat it after a "da" | yes | **PORTED** → seed-agents MAIN_CHAT_PROMPT (SINGLE-MATCH CATEGORY block) — product-agnostic discovery behavior, battle-tested against the deflection pathology |
| Age question: explain why it's needed, never insist after refusal | yes | **PORTED** → seed-agents MAIN_CHAT_PROMPT (same block) — absent from playbook and prompt |
| Mortgage/credit: don't probe directly in discovery | yes | RETIRED — subsumed by guardrail 3 (discovery questions only on tool-backed dimensions) + signal-awareness section; no live pathology tied to it |
| "Cum prezinți Protect prima dată" — lead with the treatment-abroad differentiator; €80-150k treatment cost framing | partially | Product-SPECIFIC coaching: the differentiator-first approach already lives in Product.defaultPlaybook (coachingBriefing, 5 matching passages). The €80-150k figures are price-class claims → RETIRED per M12 (prices only from the engine). Remaining nuance recorded for **E1/T11 ProductContent** when authored product content gets versioned |
| Insurer-disclosure-at-first-product | yes | RETIRED — duplicate of MAIN_CHAT_PROMPT guardrail 6 |

### 2. life-insurance-closing (domainGuidance)
| Guidance | Still true? | Disposition |
|---|---|---|
| No product-confirmation ceremony; affirm choice and propose the concrete next step | yes | RETIRED — structurally superseded: the engine's nextBestAction + exposure drive advance (advance-flow sim's CEREMONY detector pins it at 0) |
| Objection scripts (price, "need to think", spouse) | yes | RETIRED — duplicate: seed-objections.ts rows (price_base/price_total/need_to_think/…) served via get_objection_strategy are strictly richer |
| "No need" two-variant split (whole product vs addon), addon-rejection ladder | yes | RETIRED — duplicate: seed-objections `no_need` + `low_benefit` strategies cover both variants with stronger, age-banded content |
| €80-150k figures, "urgency once per conversation" | — | RETIRED per M12 (prices) / duplicate (constraints already bound tone) |

### 3. questionnaire-facilitation (workflowInstructions)
| Guidance | Still true? | Disposition |
|---|---|---|
| Interruption handling: answer the customer's question fully FIRST, then offer to resume; never force resumption | yes | **PORTED** → loadDntContext (A4 section) — behavioral rule with no current home |
| Medical questions: frame confidentiality before asking, neutral non-judgmental tone | yes | **PORTED** → loadDntContext |
| Resume from last unanswered, summarize progress, never restart unasked | yes | RETIRED — the engine owns position (answeredCount/missingCodes in briefing + dntContext progress line); phrasing detail deferred to **C1** (questionnaire tool surface owner) |
| Confirm answers before proceeding ("Am notat…") | **no** | RETIRED because it now violates the no-side-effect-claims constraint — confirmations are system-rendered from tool results |
| "DNT (De Nu Tratament)" expansion | **no** | RETIRED — wrong expansion of the acronym; nothing to port |

### 4–6. post-sale-onboarding / support / claims (workflowInstructions)
| Guidance | Still true? | Disposition |
|---|---|---|
| No upsell/cross-sell post-close | yes | **PORTED** → loadPolicyContext (A4 section; paymentContext already carries "no selling, no upgrades") |
| Claims: empathy before process; can explain process + confirm policy status, canNOT approve/assess/promise amounts or timelines | yes | **PORTED** → loadPolicyContext (condensed boundary lines) |
| Policy modifications/payments issues → human Allianz-Țiriac channel | yes | **PORTED** → loadPolicyContext (condensed) |
| Waiting-period/document walkthrough, claims phone details | partially | Deferred to **D4** (get_policy_info + document retiming own the data-backed version); hardcoded contact/waiting-period specifics RETIRED (must come from product/policy data, not prompt prose) |

### 7. post-sale-renewal (coachingBriefing)
| Guidance | Still true? | Disposition |
|---|---|---|
| Renewal-as-coverage-review, non-renewal handling | yes, later | Deferred to **E4** (re-engagement v1 owns proactive outbound); nothing exists to attach it to today — recorded here so E4 inherits it |

## Workflow step agentInstructions (product-discovery + life-insurance-purchase)

| Step(s) | Content | Disposition |
|---|---|---|
| needs_discovery | discovery conduct, candidate-setting signals ("don't over-qualify") | RETIRED — duplicates MAIN_CHAT_PROMPT + set_candidate_product's registry description; candidate inference also exists |
| dnt_check / application_check AUTO steps | "call X immediately" procedural glue | RETIRED — the step machine is dead; the engine's nextBestAction drives the same advance |
| dnt_questionnaire / application_fill | "UI shows the question as a card — don't repeat the text, keep transitions brief" | yes → **PORTED** → loadDntContext (card-rendering rule) |
| dnt_questionnaire / application_fill | answer VALUE mapping ("da"→matching option value, boolean true/false) | RETIRED — tool validation errors surface the valid enum values and the A3.7/A4.5 sims pass 2/2 without prompt-level mapping; per-question option VALUES render in questionnaireContext when C1 re-keys it |
| dnt_sign | "sign_dnt with confirmSignature+gdprConsent when they confirm" | RETIRED — obsolete contract: the gateway owns two-step confirmation (A2/A3); GUI/agent round-trip a confirmToken |
| application_fill | "10x annual income / mortgage+5yr" coverage guideline | RETIRED as hardcoded advice — recommendation formulas are **C3** (suitability engine) content, config not prose |
| quote_review | quote presentation coaching | RETIRED — coaching deliberately removed from QUOTE surfaces (A4.3, inventory row 7); factual quote data renders via QuoteCard + productContext |
| completed | policy-issued celebration + what's-covered recap | RETIRED — PolicyIssuedCard (UI) + policyContext own it; D4 documents flow owns the recap data |
| all steps | "TOOL RULES: past tense, don't narrate, don't ask permission" | RETIRED — duplicate of MAIN_CHAT_PROMPT TOOL-USE-IS-INVISIBLE + constraints |

## Ports executed in this task

1. `prisma/seeds/seed-agents.ts` MAIN_CHAT_PROMPT — SINGLE-MATCH CATEGORY
   block (present directly + one deepening question; age-question rationale +
   refusal handling). Reseeded via scripts/reseed-agents.ts.
2. `lib/chat/context-loaders.ts` loadDntContext — interruption handling,
   medical-question framing, don't-repeat-the-card rule.
3. `lib/chat/context-loaders.ts` loadPolicyContext — no upsell post-close,
   claims boundaries (empathy first; no approval/assessment/promises),
   modifications → human channel.

Behavioral proof (A5.1 step 3): pathology1 + pathology4 re-run CLEAN after
the ports (results below), full suite green.

```
P1: ==== 2/2 trials fully detector-clean ====
P4: ==== 3/3 trials clean (pivots to Protect, no invented categories) ====
```
Full suite after the ports: 134 files / 807 tests green; agents reseeded.

## erratum-1 note

`__tests__/lib/skills/advance-flow-tools.test.ts` (packs must grant funnel
tools) is deleted in A5.2: its regression is structurally superseded by
A3.1's exposure tests — the tool list is computed from the engine every turn,
packs no longer exist to mis-grant anything.
