# Zeno State Grounding Sections — Design

> **Sub-project of the Zeno reliability redesign (2026-05-20).** Related specs:
> - [Default Discovery Toolset](2026-05-20-zeno-discovery-toolset-design.md)
> - [Skill Pack Contract](2026-05-20-zeno-skill-pack-contract-design.md)
> - [Tool-Mediated Side Effects](2026-05-20-zeno-tool-mediated-effects-design.md)

## Problem

The system prompt today tells the agent how to behave but never tells it what is currently true. When `productContext`, `workflowInstructions`, or `coachingBriefing` are null (no product / workflow / playbook), those sections are simply omitted from the prompt. There is no "the system has no product / no workflow / no GDPR consent" signal — silence is the only indicator.

Combined with skill packs that inject behavioral guidance assuming those states exist (see [Skill Pack Contract](2026-05-20-zeno-skill-pack-contract-design.md)), the agent reads positive instructions to "facilitate the questionnaire" or "sell the product" with no counter-signal, and performs accordingly. The agent has no way to introspect what is *actually* the case in the database.

Reference: conversation `cmpdx52t6001gv00yv4km5usg`. The agent ran a 19-turn fake questionnaire and acknowledged twice (turns 19 and 27) that no application existed — but had no constraint or grounding telling it that meant *stop*. It kept performing the injected instructions.

## Goals

- Add an explicit, always-included section to every prompt that names the current system state as ground truth.
- Use explicit negation ("✗ No workflow is active") rather than absence — so the agent reads the falseness instead of inferring from silence.
- Introduce schema fields for the consent/disclosure facts the system claims to track but doesn't actually record yet.
- Position the section above `constraints` so constraints can refer to it.

## Non-goals

- Replacing the existing compliance check. The grounding section makes the agent behave more compliantly by design, but the compliance checker continues to run as-is.
- Adding fields to the customer profile beyond consent/disclosure tracking.

## Design

### Schema additions

`prisma/schema.prisma` — add three nullable fields to the `Customer` model:

```prisma
model Customer {
  // ... existing fields ...
  gdprConsentAt              DateTime?
  gdprConsentScope           String?      // e.g. "data_processing_for_quote"
  aiDisclosureAcknowledgedAt DateTime?
}
```

Migration name: `add-customer-consent-tracking`.

### State grounding loader

New function in `lib/chat/context-loaders.ts`:

```ts
export function loadStateGrounding(input: {
  workflowSession: { currentStep: { code: string, name: string } | null, status: string } | null,
  application: { id: string, status: string, currentQuestionIndex: number | null, totalQuestions: number | null } | null,
  product: { code: string, name: string } | null,
  customer: { gdprConsentAt: Date | null, gdprConsentScope: string | null, aiDisclosureAcknowledgedAt: Date | null },
}): string {
  // build lines, return joined string with the standard header
}
```

Output (negative form — all state is empty):

```
=== CURRENT SYSTEM STATE (ground truth — do not contradict) ===
✗ No workflow is active
✗ No application has been started
✗ No product is selected
✗ GDPR consent has NOT been granted by this customer
✗ AI disclosure has NOT been acknowledged by this customer

You cannot claim to have completed any of these. To change state, call the matching tool and wait for its success.
```

Output (positive form — fully populated):

```
=== CURRENT SYSTEM STATE (ground truth — do not contradict) ===
✓ Active workflow: dnt_questionnaire (step 3/8)
✓ Active application: APP-12345 (question 5/14)
✓ Selected product: LIFE-PRO — Asigurare Viață Premium
✓ GDPR consent: Granted at 2026-05-20 12:48 for data_processing_for_quote
✓ AI disclosure: Acknowledged at 2026-05-20 12:45
```

Mixed states show each fact independently. Format is one line per fact, ✓ or ✗ prefix, label and value when present.

### Section registry

In `lib/chat/prompt-builder.ts` `SECTION_REGISTRY`, add a new entry:

```ts
{ key: 'stateGrounding', priority: 2.5, layer: 'constitution', alwaysInclude: true, prefix: '' }
```

Priority 2.5 places it between `constraints` (2) and `capabilityManifest` (3). `alwaysInclude: true` means the reasoning gate cannot exclude it. The prefix is empty because the loader output already includes its own `=== CURRENT SYSTEM STATE ===` header.

### PromptSections type

Add to the `PromptSections` interface in `lib/chat/prompt-builder.ts`:

```ts
stateGrounding: string  // always populated by loadStateGrounding
```

`loadAllSections` in `lib/chat/context-loaders.ts` calls `loadStateGrounding` synchronously (no DB calls — inputs are already on `turnCtx`) and includes the result in the returned object.

### Constraints text addendum

Append to base `constraints`:

> Refer to the CURRENT SYSTEM STATE section above as ground truth. If a fact is marked ✗, you cannot claim it is true. To change a state from ✗ to ✓, you must call the matching tool successfully — its confirmation will be rendered for the customer automatically. Do not perform actions that contradict the listed state.

## Data flow

```
loadAllSections is called for the turn
  ↓
loadStateGrounding(input) reads from turnCtx (workflowSession, application, product, customer)
  ↓
returns a single string with one line per fact (✓ or ✗)
  ↓
buildPrompt assembles sections in priority order; stateGrounding lands between constraints and capabilityManifest
  ↓
LLM receives a prompt that explicitly names what is and is not true
  ↓
constraints text instructs the agent to treat ✗ facts as forbidden claims
```

## Error handling

- The loader is synchronous and takes already-loaded data from `turnCtx`. No DB call, no error case.
- If a customer row predates this migration and the consent fields are null, the loader correctly outputs the ✗ form. No special handling needed.

## Testing

- **Unit:** `loadStateGrounding` returns the all-negative form when every input is null.
- **Unit:** `loadStateGrounding` returns the all-positive form when every input is populated.
- **Unit:** `loadStateGrounding` handles mixed inputs (e.g. product set, workflow null) and produces the correct per-line ✓/✗ output.
- **Unit:** `buildPrompt` places `stateGrounding` between `constraints` and `capabilityManifest` in the rendered prompt, with `alwaysInclude: true` overriding any gate exclusion.
- **Integration:** on a fresh conversation, the assembled system prompt contains the negative-form `=== CURRENT SYSTEM STATE ===` section ahead of `capabilityManifest`.
- **Behavioral (mocked LLM):** given the negative-form state grounding section + a user message asking about a non-existent product, the LLM (stubbed) response does not claim to have started an application or saved any data.
- **Schema:** migration applies cleanly and rolls back cleanly; consent fields default to null.

## Migration

- Run the new Prisma migration `add-customer-consent-tracking` to add the three nullable Customer fields.
- No data backfill is needed — all existing customers correctly read as "no consent, no disclosure acknowledged" (which is the most conservative default).

## Out of scope (follow-ups for other sub-projects)

- The tools that *populate* `gdprConsentAt` and `aiDisclosureAcknowledgedAt` are introduced in [Tool-Mediated Side Effects](2026-05-20-zeno-tool-mediated-effects-design.md). This sub-project only adds the fields and the grounding display.
- Migration of existing skill pack content that referenced fake state is handled in [Skill Pack Contract](2026-05-20-zeno-skill-pack-contract-design.md).
