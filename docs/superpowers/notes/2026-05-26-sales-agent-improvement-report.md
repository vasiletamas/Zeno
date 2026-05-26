# Sales Agent Improvement — Session Report

**Date:** 2026-05-26
**Conversations that triggered the work:**
- `cmpm891f000003k0yv1tz50k1` — Zeno conceded an addon objection immediately
- `cmpmftp8t000o3k0y0qhtdu8d` — Zeno asked a discovery question after the customer confirmed interest in a one-product catalog
- `cmpmlutbx001m3k0yd3jx4so6` — auto-assignment didn't fire when the customer greeted before stating intent (caught and fixed mid-session)

## What we started with

Three observed pathologies in real conversations:

1. **Skill packs silently rejected.** The 2026-05-20 skill-pack contract redesign restricted packs to writing only `domainGuidance`, but the migration step (moving existing pack content out of reserved keys) had never been done. Result: every active pack contributed exactly zero characters of sales coaching to the prompt. The agent ran on stock identity + constraints.
2. **`get_objection_strategy` returned a "wing it" message.** The handler required `conversation.productId`, which was null during the entire presentation phase. Nine richly-written objection strategies sat in the DB unused.
3. **Generic product framing.** Zeno presented Protect as three equal bullets ("life cover, accident cover, treatment-abroad option"), losing the differentiator that justifies the product. Compliance checker also flagged "missing needs assessment" on every turn — application-phase rigor applied to presentation-phase reality.

## What we built

### Thread #1 — Skill pack migration + editorial improvements (commit `1547aee`)

Migrated `life-insurance-discovery` and `life-insurance-closing` pack content from the rejected `coachingBriefing` key to the allowed `domainGuidance` key. Four targeted edits during the move:
- Discovery pack: new "Cum prezinți Protect prima dată" section telling the agent to lead with the treatment-abroad differentiator, not list it as one of three bullets.
- Closing pack: expanded "Nu cred că am nevoie" into two variants (whole-product rejection vs addon rejection), with a four-step script for addon rejection: validate → probe → reframe with concrete cost (~€80-150k) → respect autonomy.
- Discovery pack: removed broken "TEHNICA 7" cross-reference.
- Both packs: dropped the redundant English duplicate paragraphs (~600 chars/turn).

Re-seeded the two pack rows; the other five packs (`questionnaire-facilitation`, `post-sale-*`) still write to reserved keys and are out of scope.

### Phase model + candidate product (specs `fa9c9dd`, plan `c9d4a11`, impl `c61f22b`..`5e85e9d`)

An architectural shift that emerged from thread #2 investigation. The system now distinguishes:
- **Presentation phase** — pre-application; explore catalog, build value, defend feature objections. Compliance enforces transparency only (AI disclosure, insurer disclosure, GDPR, no fabricated claims).
- **Application phase** — DNT onward; structured questionnaire, full IDD/GDPR compliance.

Phase is derived (not stored) from `conversation.application?.status`. The new helper `lib/chat/phase.ts:getConversationPhase` is the single read.

A new **candidate product** concept gives tools and the prompt product context before formal commitment:
- Three new nullable columns on `Conversation`: `candidateProductId`, `candidateConfidence`, `candidateSetAt`.
- Auto-assigned on any turn whose message keyword-matches one unambiguous catalog product (initial bug: gated on `messageCount === 0`; fixed in `714f216` to run on every turn until a candidate is set, with a cheap pre-check to avoid unnecessary DB queries).
- New `set_candidate_product` LLM tool for explicit setting/updating.
- `get_objection_strategy` now falls back through `productId → candidateProductId → pack-inferred unique catalog match → generic message`.
- `start_application` promotes the candidate to committed `productId`.
- Discovery pack gained a "single match → skip qualifying" rule.

### Debug visibility (commits `5e85e9d` + identity-card series earlier this session)

The Identity & Stored Context card now surfaces a "Conversation State" group with:
- Phase as a colored badge (`presentation` blue, `application` green, `post_sale` purple).
- Committed product as `✓ <ProductName>` or `✗ not set (no application yet)`.
- Candidate productId (truncated) + confidence + set-at timestamp.

Diff highlighting works for free — any of these flipping turn-to-turn lights up yellow with `(was: ...)`. `dump-conversation.ts` was also extended to surface phase + candidate in its META block for terminal inspection.

## How the original three issues are addressed

### Issue 1 — Skill pack section rejection

**Status:** Resolved for the two life-insurance packs.

**Mechanism:** Pack content migrated from `coachingBriefing` (reserved) to `domainGuidance` (writable). The prompt builder already had a `domainGuidance` section registered at priority 6; that section was previously empty for every turn. After the migration, the discovery pack contributes ~5030 chars and the closing pack ~2654 chars per turn.

**Future impact:** Any sales conversation handled by these two packs now receives the documented sales technique guidance. The "Nu cred că am nevoie" objection has a documented two-variant script the LLM can follow. The "Cum prezinți Protect" framing rule reaches the LLM on every presentation-phase turn.

**Open work:** Five other packs (`questionnaire-facilitation`, `post-sale-onboarding`, `post-sale-support`, `post-sale-claims`, `post-sale-renewal`) still write to reserved keys. Their content is mostly workflow-step coaching that belongs on `WorkflowStep.salesPlaybook`, currently empty across all 12 step rows. A future sweep would migrate that content step-by-step.

### Issue 2 — `get_objection_strategy` returning a non-useful fallback

**Status:** Resolved.

**Mechanism:** Three changes compounded:
- The fallback chain in `lib/tools/handlers/objection-handlers.ts` now reads candidate before giving up, and synthesizes a candidate from active skill packs when neither productId nor candidateProductId is set.
- Auto-candidate-assignment in the orchestrator means most conversations have a candidate set by turn 2-3.
- The closing pack's domainGuidance, now reaching the LLM, includes the validate→probe→reframe-with-cost script for addon objections — so even when the strategy lookup falls through, the agent has the pattern in its prompt.

**Future impact:** Addon-objection scenarios like *"asta cu tratamentul nu cred ca am nevoie"* will now hit a real strategy row from `ObjectionStrategy` (9 types, ~5000 chars each with multiple techniques). The agent has both the tool data AND the pack guidance reinforcing the same approach.

**Open work:**
- The proposed `addon_no_need` objection type was not added to the strategy table. The pack handles it sufficiently for now, but having a dedicated tool-backed strategy would tighten the routing.
- `PACK_TO_INSURANCE_TYPE` in `objection-handlers.ts` is hardcoded for two pack slugs. When HOME/AUTO/HEALTH packs are added, this map needs extending — or better, moved to a `flags.insuranceType` field on the pack row.

### Issue 3 — Generic product framing

**Status:** Primary symptom resolved; minor secondary concern documented.

**Mechanism:**
- Discovery pack's "Cum prezinți Protect prima dată" section explicitly tells the agent to lead with the differentiator (treatment-abroad ~€80-150k) rather than listing it as an equal bullet.
- The "single match → skip qualifying" rule (Task 11) prevents the agent from asking *"ce v-a determinat să vă gândiți la asigurare?"* when the catalog has exactly one match for the stated category.
- Auto-assignment ensures the candidate product is known by the time the LLM reaches the framing decision.

**Evidence:** Conversation `cmpmlutbx001m3k0yd3jx4so6` turn 3 (post-fix) reads *"o asigurare de viață care se diferențiază prin opțiunea de tratament medical în străinătate ... iar pe lângă asta include și protecție de bază"* — differentiator first, baseline coverage as "plus this." Compare to the pre-fix framing in `cmpm891f000003k0yv1tz50k1` where the three components were equal bullets.

**Future impact:** Initial product presentations will consistently lead with the unique value. Compliance checker no longer flags "missing needs assessment" during presentation, so the trace becomes diagnostic (real concerns surface) instead of noise.

**Open work — secondary concern:** When asked for detail (*"explica-mi un pic partea asta"*), the agent sometimes hedges (*"detaliile exacte depind de termenii poliței"*) rather than calling `get_product_info`. The discovery pack's "Semnale de pregătire" rule may still be too cautious for explicit detail requests. A small edit to that rule — distinguishing "wait for signals before *recommending*" from "answer concrete questions when asked" — would close this gap.

## Cross-cutting outcomes

- **Compliance noise dropped substantially.** Presentation-phase turns no longer get flagged with "missing needs assessment" / "missing suitability" / "insufficient informed consent" — those checks now belong to application phase only. Trace surfaces become useful again.
- **Debug pane became materially more useful.** Phase, candidate, and committed-product state are now visible per turn with diff highlighting. The user can verify the auto-assignment and phase transitions without dropping into psql.
- **Architecture cleaner.** `Conversation.productId` now means "committed for an application"; `candidateProductId` means "what we're talking about." Phase is derived. Tools have a deterministic fallback order. The mental model maps to how real sales conversations actually flow.

## Test surface added this session

- 3 unit tests for `getConversationPhase` (`__tests__/lib/chat/phase.test.ts`)
- 9 unit tests for `inferCandidate` (`__tests__/lib/chat/candidate-inference.test.ts`)
- 3 unit tests for `setCandidateProduct` (`__tests__/lib/tools/handlers/candidate-handlers.test.ts`)
- 4 unit tests for objection-fallback chain (`__tests__/lib/tools/handlers/objection-fallback.test.ts`)
- 2 unit tests for start_application candidate promotion (`__tests__/lib/tools/handlers/application-promotion.test.ts`)
- 3 unit tests for compliance phase awareness (`__tests__/lib/chat/compliance-phase.test.ts`)
- 4 unit tests for `buildIdentityPayload` (`__tests__/lib/chat/debug-identity.test.ts`)
- 5 unit tests for `diffIdentity` (`__tests__/components/debug/identity-diff.test.ts`)
- 2 + 4 integration tests (`__tests__/integration/phase-transition.test.ts`, `__tests__/integration/auto-candidate-assignment.test.ts`)

Total: **39 new tests**, full suite at **562/562 passing** at end of session.

## Recommended follow-ups (in priority order)

1. **Migrate remaining pack content.** The five packs still writing to reserved keys silently contribute nothing. Their content (mostly questionnaire facilitation + post-sale flows) belongs on `WorkflowStep.salesPlaybook` for the relevant steps. Same shape as thread #1 but per workflow step.
2. **Fix discovery pack rule about answering detail questions.** When the customer asks *"explain X"*, the pack should authorize `get_product_info` even before the "two cumulative readiness signals" are met. A short rule addition.
3. **Add the `addon_no_need` objection strategy type.** Closes the routing gap for addon-rejection objections so the tool returns the right script directly instead of relying on the pack to carry the load.
4. **Move the pack→category map out of code.** `PACK_TO_INSURANCE_TYPE` in `objection-handlers.ts` should be a pack-row field (`flags.insuranceType`).
5. **Make `start_application` atomic.** Wrap `appCreate` + `conversation.update({ productId })` in `prisma.$transaction([...])` so an in-flight failure can't leave the two rows out of sync.
6. **Add RCA/CASCO + `apartament` keywords to `inferCandidate`.** Romanian-market specific terms that aren't covered by the current LIFE/HOME/AUTO/HEALTH/TRAVEL set.
