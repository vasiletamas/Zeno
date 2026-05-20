# Zeno Skill Pack Contract Redesign — Design

> **Sub-project of the Zeno reliability redesign (2026-05-20).** Related specs:
> - [Default Discovery Toolset](2026-05-20-zeno-discovery-toolset-design.md)
> - [State Grounding](2026-05-20-zeno-state-grounding-design.md)
> - [Tool-Mediated Side Effects](2026-05-20-zeno-tool-mediated-effects-design.md)

## Problem

Skill packs today can overwrite almost any prompt section. The current contract reserves only three keys (`agentIdentity`, `constraints`, `capabilityManifest`) — everything else is open to packs. In practice this means packs inject `workflowInstructions`, `coachingBriefing`, `productContext`, and similar **state-bearing** sections without there being any real workflow / product / state in the database. The LLM, reading these injected instructions, performs them faithfully.

Reference: conversation `cmpdx52t6001gv00yv4km5usg`. The `life-insurance-discovery` pack injected 3463 chars of `coachingBriefing` with no product attached; the `questionnaire-facilitation` pack injected 2078 chars of `workflowInstructions` with no `workflowSession`. The agent ran a fake home-insurance questionnaire for 19 turns.

Two compounding gate-level defects also need to be fixed:

1. The reasoning gate receives its own previous `activeSkillPacks` as input (`lib/chat/reasoning-gate.ts:160-162`), creating self-reinforcement.
2. The gate weights `extractedProfile.interests` heavily, keeping a customer pre-tagged for life insurance on the life-insurance pack even after an explicit pivot to a different category.

A secondary defect: `computeAllowedTools` in `lib/skills/skill-pack-loader.ts:126-142` uses intersection. (Fixed in [Default Discovery Toolset](2026-05-20-zeno-discovery-toolset-design.md), reiterated here because pack tool merging is the same code.)

## Goals

- Restrict packs to a tiny, well-defined contribution surface: `constraints` (appended), `domainGuidance` (new prose section), `allowedTools` (additive union). Nothing else.
- Move all state-bearing content currently in packs (playbooks, workflow instructions) to schema-backed homes loaded by real loaders.
- Defense-in-depth validation: reject invalid pack rows at save time AND strip-and-warn at load time.
- Remove gate self-reinforcement and add explicit weighting of the current message over the stored profile.

## Non-goals

- Removing the skill pack mechanism entirely.
- Replacing the reasoning gate (model, output schema, or invocation pattern).
- Restructuring `WorkflowStep` beyond adding the new content field(s).

## Design

### Pack-writable contract

A new constant in `lib/skills/skill-pack-loader.ts` replaces the existing `CONSTITUTION_KEYS`:

```ts
// Inverted: packs can ONLY write keys in this set.
// Everything else is reserved for system loaders.
const PACK_WRITABLE_KEYS = new Set(['domainGuidance'])
```

The merge function inverts its check:

```ts
export function mergeSkillPackSections(
  baseSections: Record<string, string | null>,
  packs: SkillPack[],
): Record<string, string | null> {
  if (packs.length === 0) return baseSections
  const merged = { ...baseSections }
  const claimed = new Set<string>()
  const packConstraints: string[] = []

  for (const pack of packs) {
    for (const [key, value] of Object.entries(pack.promptSections ?? {})) {
      if (!PACK_WRITABLE_KEYS.has(key)) {
        logWarn({ message: 'skill_pack_section_rejected', metadata: { packSlug: pack.slug, key } })
        continue
      }
      if (claimed.has(key)) continue
      merged[key] = value
      claimed.add(key)
    }
    if (pack.constraints) packConstraints.push(pack.constraints)
  }

  if (packConstraints.length > 0) {
    const base = merged.constraints ?? ''
    merged.constraints = [base, ...packConstraints].filter(Boolean).join('\n')
  }

  return merged
}
```

### Tool union

`computeAllowedTools` becomes a union helper, consistent with the orchestrator update from [Default Discovery Toolset](2026-05-20-zeno-discovery-toolset-design.md). (If the orchestrator inlines the union, this function can be removed.)

```ts
export function computeAllowedTools(
  workflowStepTools: string[],
  packs: SkillPack[],
): string[] {
  const packToolsUnion = new Set<string>()
  for (const pack of packs) {
    for (const tool of pack.allowedTools) packToolsUnion.add(tool)
  }
  return Array.from(new Set([...workflowStepTools, ...packToolsUnion]))
}
```

### domainGuidance section in the prompt

`lib/chat/prompt-builder.ts` `SECTION_REGISTRY` gets a new entry:

```ts
{ key: 'domainGuidance', priority: 6, layer: 'stable', alwaysInclude: false, prefix: '=== DOMAIN GUIDANCE ===' }
```

Priority 6 places it after `coachingBriefing` (5) and before any dynamic suffix. `PromptSections` gains a `domainGuidance: string | null` field, populated by `mergeSkillPackSections` from active packs.

Purpose of the section, written in pack rows:
- Tone, voice, vocabulary specific to a domain (e.g. life insurance, claims handling)
- Style nudges that don't claim system state ("when discussing end-of-life topics, prefer warmth over precision")

What this section does NOT do:
- Claim that any system state exists
- Reference specific products, workflow steps, application progress
- Provide step-by-step "what to ask next" content (that's `salesPlaybook` on `WorkflowStep`, see below)

### Schema additions for migrated playbook content

`prisma/schema.prisma` — add a field to `WorkflowStep`:

```prisma
model WorkflowStep {
  // ... existing fields ...
  salesPlaybook String?  // coaching content scoped to this step
}
```

Migration name: `add-workflow-step-sales-playbook`.

If the migration of existing packs surfaces content that is genuinely facilitation-style (how to keep the customer moving through questions) and is distinct from sales coaching, a second optional field `facilitationGuidance: String?` is added in the same migration. The decision is made during content review (see Migration section).

### loadCoachingBriefing rewrite

`lib/chat/context-loaders.ts:207` — `loadCoachingBriefing` changes from product-keyed to workflow-step-keyed:

```ts
export async function loadCoachingBriefing(
  workflowStepCode: string | null,
): Promise<string | null> {
  if (!workflowStepCode) return null
  const step = await prisma.workflowStep.findUnique({
    where: { code: workflowStepCode },
    select: { salesPlaybook: true },
  })
  return step?.salesPlaybook ?? null
}
```

Result: no workflow → no coaching content. Exactly the correctness we want.

`loadAllSections` updates its call site accordingly, passing `workflowStepCode` instead of `productId`. The signature update propagates to any other callers (mainly `orchestrator.ts`).

### Pack save-time validation

Wherever pack rows are created or updated via API/admin, reject any `promptSections` payload with keys outside `PACK_WRITABLE_KEYS`:

```ts
export function validatePackPromptSections(sections: Record<string, string>): { valid: boolean; invalidKeys: string[] } {
  const invalidKeys = Object.keys(sections).filter((k) => !PACK_WRITABLE_KEYS.has(k))
  return { valid: invalidKeys.length === 0, invalidKeys }
}
```

API endpoint (or admin route — find the handler that updates `SkillPack`) returns HTTP 400 with the invalid keys when validation fails. Tests cover the rejection path.

### Reasoning gate fixes

Two changes in `lib/chat/reasoning-gate.ts`:

1. **Remove `[Active Skill Packs]` from gate input.** In `buildGateContextMessage` (`reasoning-gate.ts:155-170`), delete the block at lines 160-162 that adds the active-packs line. The gate no longer sees its own previous recommendations.

2. **Add explicit weighting rule to the gate prompt.** In whatever file holds the gate's system prompt template (locate via grep), insert text:

   > When the customer's current message names a product category different from their stored `extractedProfile.interests`, the current message overrides the stored interests. Never recommend a skill pack for a product category the customer is not currently asking about.

The `[Available Skill Packs]` listing stays — the gate still needs the catalogue of packs it can recommend.

## Data flow

```
turn start
  ↓
gate runs with input that no longer contains [Active Skill Packs]
  ↓
gate output: recommendedSkillPacks (based on current message + available packs + downweighted stored profile)
  ↓
activePacks = getActiveSkillPacks(recommendedSkillPacks)
  ↓
mergeSkillPackSections rejects any non-domainGuidance promptSections, logs warning per rejection
  ↓
allowedTools = union(default discovery, workflow step tools, pack tools)
  ↓
loadCoachingBriefing(workflowStepCode) returns step.salesPlaybook OR null
  ↓
final prompt: stateGrounding + constraints (base + pack-appended) + domainGuidance + coachingBriefing
              + everything else — all sections backed by real state or pack-writable-only content
```

## Error handling

- Pack save validation fails → API returns 400 with the list of invalid keys.
- Pack load encounters a pack row with reserved-key content (legacy data) → strip and warn; merge proceeds with the remaining valid sections.
- Migration leaves a pack with no usable content (all of its `promptSections` were reserved keys) → pack remains active but contributes nothing beyond `constraints` and `allowedTools`. No runtime error.

## Testing

- **Unit:** `mergeSkillPackSections` rejects keys outside `PACK_WRITABLE_KEYS` and logs a warning per rejection.
- **Unit:** `mergeSkillPackSections` accepts and merges `domainGuidance` (first-pack-wins on conflict, ordered by priority).
- **Unit:** `mergeSkillPackSections` appends pack constraints to base constraints.
- **Unit:** `computeAllowedTools` returns the union of workflow + pack tools (no intersection).
- **Unit:** `validatePackPromptSections` returns invalidKeys for any key outside the allowed set.
- **Unit:** save endpoint returns 400 with the invalidKeys array when the payload contains reserved keys.
- **Unit:** `loadCoachingBriefing` returns null when `workflowStepCode` is null.
- **Unit:** `loadCoachingBriefing` returns the `WorkflowStep.salesPlaybook` content when the step has it set.
- **Unit:** gate input builder (`buildGateContextMessage`) does NOT include any `[Active Skill Packs]` line.
- **Behavioral (mocked LLM):** with the new gate prompt, given `extractedProfile.interests = ['life insurance']` and a current message about home insurance, the LLM (stubbed) returns `recommendedSkillPacks` that does not contain `life-insurance-discovery`.
- **Migration:** after running the data migration, no pack row in the DB has `promptSections` keys outside the allowed set.

## Migration

1. **Apply schema migration** `add-workflow-step-sales-playbook` (and optionally `facilitationGuidance` if needed after content review).
2. **Content review** — for each existing pack with `promptSections.coachingBriefing` or `promptSections.workflowInstructions`:
   - Identify which workflow step(s) the content belongs to. This is a manual mapping decision since one pack might apply to multiple steps.
   - Move the content to `WorkflowStep.salesPlaybook` (or split into salesPlaybook + facilitationGuidance) for the matching steps.
   - If pack content includes voice/tone material that isn't step-specific, extract it into a `domainGuidance` entry on the pack row instead.
   - If pack content is now empty after extraction, the pack row stays (it still has `constraints` and `allowedTools`).
3. **Apply schema/data migration scripts.**
4. **Run validation:** assert no pack row has `promptSections` keys outside `PACK_WRITABLE_KEYS`. Failing rows are listed and fixed by re-running the content review for those packs.

The content review is the load-bearing step — it requires reading the actual pack content and making editorial decisions about where each block belongs. A script can produce the candidate mapping for review, but the final assignments are human-reviewed.

## Out of scope (follow-ups for other sub-projects)

- The `domainGuidance` section's content quality across packs — this is editorial work that follows naturally from the content review but is not gated on this sub-project's code completion.
- Mode transitions (`closing_signal`, `objection`, etc.) and pack reactivity — the gate continues to recommend packs the same way, just without the self-reinforcement loop. Further mode-handling work is a separate concern.
