# Zeno debug notes — 2026-05-20

Issues surfaced by walking a real conversation end-to-end. Each entry is a problem to fix later, not a fix itself.

---

## Issue 1 — Tool gating is workflow-scoped, blocking pre-workflow discovery

**Where:** `lib/chat/orchestrator.ts:315`, `lib/chat/context-loaders.ts:67-85, 731`

**Summary:** Tools available to the LLM are loaded exclusively from `workflowSession.currentStep.allowedTools`. Conversations without an active workflow get `allowedTools = []`, which means `loadCapabilityManifest([])` returns null and no tools are exposed to the model — including the already-implemented `list_products` and `get_product_info`.

**Why this is wrong:** Product discovery is *pre-workflow* by design. A workflow attaches once a specific product has been identified. So during the exact phase where the agent needs to enumerate the catalog and ground its responses in real inventory, it has zero tool access.

**Repro:** Conversation `cmpdx52t6001gv00yv4km5usg`, turn 4. User: "vreau o asigurare pentru locuinta". `workflow: null`, `sectionSizes` missing `capabilityManifest`. Agent asked "apartament sau casă?" instead of acknowledging unavailability or listing options.

**Expected behaviour (per design):** When the user expresses product intent and no product is attached yet, the agent should call `list_products`, receive the catalog, and either say "we only carry X" or "we offer 1/2/3/4 — tell me more so I can recommend."

**Fix direction:** Define a default discovery toolset (`list_products`, `get_product_info`) that is available whenever no workflow is active. Likely a constant exposed alongside or merged into `stepAllowedTools` when `workflowSession == null`.

**Out of scope here:** Whether the agent should also persist the selected product to `conversation.productId` once identified (probably yes, but separate change).

---

## Issue 2 — Reasoning gate biased by stored profile; skill pack playbook runs without inventory grounding

**Where:** `lib/chat/reasoning-gate.ts:155-170` (gate input construction), `lib/chat/orchestrator.ts:548-584` (skill pack merge), `lib/chat/context-loaders.ts:744-745` (productContext gated on productId)

**Summary:** Two compounding problems:

1. **Profile-bias in skill pack selection.** The reasoning gate receives the customer's `extractedProfile` (interests, motivations) and its own prior `activeSkillPacks` as input on every turn. When a customer has been pre-tagged for a category (e.g. life insurance), the gate keeps recommending the matching pack even when the current message clearly pivots to a different category. The pattern is self-reinforcing because the gate sees its own previous recommendation.
2. **Un-grounded playbook injection.** When a skill pack is active but `conversation.productId` is null, `loadProductContext` and the base `loadCoachingBriefing` both return null — but `mergeSkillPackSections` still injects the pack's own `coachingBriefing` content. Net result: the prompt contains "PRODUCT SALES PLAYBOOK" (how to sell life insurance) with no corresponding "PRODUCT CONTEXT" (what we actually sell). Agent acts on the playbook because that's the only signal it has.

**Repro:** Same conversation as Issue 1, turn 4. Customer profile: `interests: ["asigurare de viață", "tratament în străinătate..."]`. Current message: "vreau o asigurare pentru locuinta". Gate's `situationType: "product_inquiry"` (correctly identified), `recommendedSkillPacks: ["life-insurance-discovery"]` (incorrectly held over). `sectionSizes.coachingBriefing = 3463` despite `productId == null`.

**Fix direction (two parts):**

- **Gate:** Weight current-turn message over stored profile interests; consider removing self-feedback of prior `activeSkillPacks` as gate input, or downweighting it explicitly in the prompt. Prompt should explicitly state "current message overrides stored interests when they conflict."
- **Skill packs:** A pack that contributes a sales playbook should require a grounding section (productContext or catalog) to be present, otherwise it shouldn't merge its playbook content. Alternative: gate skill packs on `productId` being set, and use a lighter "pre-discovery" pack variant when it isn't.

**Note:** Issue 1's fix (exposing `list_products` during discovery) significantly reduces the harm of Issue 2 — even with a biased pack, an agent that can see the real catalog should self-correct. Issue 2 is still real but lower priority once Issue 1 is in.

---
