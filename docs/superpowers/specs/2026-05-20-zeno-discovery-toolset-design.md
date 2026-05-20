# Zeno Default Discovery Toolset — Design

> **Sub-project of the Zeno reliability redesign (2026-05-20).** Related specs:
> - [State Grounding](2026-05-20-zeno-state-grounding-design.md)
> - [Skill Pack Contract](2026-05-20-zeno-skill-pack-contract-design.md)
> - [Tool-Mediated Side Effects](2026-05-20-zeno-tool-mediated-effects-design.md)

## Problem

Tools available to the LLM are loaded exclusively from `workflowSession.currentStep.allowedTools` (`lib/chat/orchestrator.ts:315`). Conversations without an active workflow get `allowedTools = []`, which means `loadCapabilityManifest([])` returns `null` and the LLM has zero tools — including `list_products` and `get_product_info`. Product discovery is pre-workflow by design, so this is exactly the phase where catalog tools are needed.

Reference: conversation `cmpdx52t6001gv00yv4km5usg`, turn 4. User asked "vreau o asigurare pentru locuinta", agent had no tools, asked "apartament sau casă?" instead of consulting the catalog. The system then ran a 19-turn fake home-insurance questionnaire before admitting (turn 39) it had no home products.

A secondary defect: `computeAllowedTools` in `lib/skills/skill-pack-loader.ts:126-142` uses intersection between workflow tools and pack tools. When workflow tools are empty (no workflow active), the intersection is empty regardless of what packs allow.

## Goals

- Expose a defined baseline of discovery tools on every turn, regardless of workflow state.
- Give the agent a deterministic path from "user expresses product intent" to "agent enumerates catalog or admits unavailability."
- Fix the intersection bug so pack-contributed tools survive when no workflow is active.

## Non-goals

- Changing how the reasoning gate prioritizes tools in `toolGuidance.prioritize`.
- Implementing per-customer or per-channel tool filtering.
- A `set_conversation_product` hard-coded confirmation check at the handler level (handled by constraints + the broader behavioral system).

## Design

### Default discovery tool set

A new module exports the baseline:

```ts
// lib/chat/default-tools.ts
export const DEFAULT_DISCOVERY_TOOLS = [
  'list_products',
  'get_product_info',
  'set_conversation_product',
] as const
```

### Allowed-tools merge

The orchestrator's allowed-tools computation moves from intersection to union:

```ts
// in lib/chat/orchestrator.ts (replacing line 315 and the downstream computeAllowedTools call)
const baseTools = DEFAULT_DISCOVERY_TOOLS
const workflowTools = turnCtx.conversation.workflowSession?.currentStep.allowedTools ?? []
const packTools = activePacks.flatMap((p) => p.allowedTools)
const allowedTools = Array.from(new Set([...baseTools, ...workflowTools, ...packTools]))
```

`computeAllowedTools` in `lib/skills/skill-pack-loader.ts` is updated to be the union helper above, or removed in favor of inlining the merge in the orchestrator. Tests that exercise the old intersection behavior are updated to expect union.

### Constraint guardrail for set_conversation_product

The agent can call all three tools at will. To prevent accidental product commitment, append to base `constraints`:

> Before calling `set_conversation_product`, the customer must have explicitly confirmed the product choice in their most recent message. If unclear, ask "confirmi că alegi {productName}?" or "confirm you'd like {productName}?" and wait for their response. Never call `set_conversation_product` based solely on the customer expressing interest in a category.

### Loading copy

`list_products` already has loading status copy (`STATUS_PRODUCT_LOOKUP` in `lib/tools/registry.ts:185-196`). Add equivalent copy for `get_product_info` and `set_conversation_product` (RO + EN, 2-3 variants each), following the same pattern.

## Data flow

```
turn start
  ↓
orchestrator builds allowedTools = DEFAULT_DISCOVERY_TOOLS ∪ workflowStepTools ∪ packTools
  ↓
loadCapabilityManifest(allowedTools) returns the formatted manifest
  ↓
manifest is included in prompt (it is non-empty because baseline is always present)
  ↓
LLM has list_products / get_product_info / set_conversation_product available
  ↓
when LLM calls list_products with a category filter, tool returns either
  a non-empty product list (agent can present options) OR
  message: "No products found matching the criteria." (agent acknowledges unavailability)
```

## Error handling

- `list_products` returns empty result → agent must acknowledge unavailability. This is currently the tool's success path (`success: true, count: 0`). No additional handling needed at the orchestrator level; the agent's response is shaped by the constraints + the empty result.
- `set_conversation_product` called for an invalid productId → tool returns `success: false` with error. Agent surfaces the error in prose (no claim that the product was selected). This is also handled by Subsystem C (tool-mediated side effects).

## Testing

- **Unit:** `orchestrator` produces `allowedTools` including all three discovery tools when `workflowSession` is null and no packs are active.
- **Unit:** `orchestrator`'s `allowedTools` is the union of baseline + workflow + pack tools (assert presence of pack tools when workflow tools are empty).
- **Unit:** `loadCapabilityManifest` is non-null on conversations with no workflow (baseline tools populate the manifest).
- **Integration (replay):** a turn equivalent to "vreau o asigurare pentru locuinta" on a fresh conversation. Assert `list_products` is in the LLM's available tools list.
- **Behavioral (mocked LLM):** given the discovery toolset and a stubbed LLM that calls `list_products({insuranceType: 'home'})`, then the tool returns an empty result, the next-turn LLM response (also stubbed) acknowledges unavailability rather than asking clarifying questions.

## Migration

None required. This is additive; no existing data needs to change. Old conversations work the same; new conversations get the baseline tools.

## Out of scope (follow-ups for other sub-projects)

- Confirmation rendering when `set_conversation_product` succeeds — handled by [Tool-Mediated Side Effects](2026-05-20-zeno-tool-mediated-effects-design.md).
- The reasoning gate's `toolGuidance.prioritize` recommending discovery tools for `product_inquiry` situations — fits naturally with [Skill Pack Contract](2026-05-20-zeno-skill-pack-contract-design.md)'s gate fixes but not strictly required for this sub-project to function.
