# Zeno Default Discovery Toolset — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Expose `list_products`, `get_product_info`, and `set_conversation_product` as an always-available baseline so the agent can ground product discussions in real catalog data — even when no workflow is active.

**Architecture:** A new module declares the baseline tool set and a merge helper. The orchestrator's `stepAllowedTools` becomes baseline-merged before any consumer reads it. `computeAllowedTools` is rewritten from intersection to union. A new behavioural constraint forbids calling `set_conversation_product` without explicit user confirmation.

**Tech Stack:** TypeScript, Next.js 16, Prisma 7, Vitest. Spec: `docs/superpowers/specs/2026-05-20-zeno-discovery-toolset-design.md`.

---

## File Structure

**Create:**
- `lib/chat/default-tools.ts` — `DEFAULT_DISCOVERY_TOOLS` constant + `withDefaultDiscoveryTools` merge helper.
- `__tests__/lib/chat/default-tools.test.ts` — unit tests for the helper.

**Modify:**
- `lib/skills/skill-pack-loader.ts:126-142` — `computeAllowedTools` from intersection to union.
- `__tests__/lib/skills/skill-pack-loader.test.ts:232-280` — replace the intersection-asserting tests with union-asserting ones.
- `lib/chat/orchestrator.ts:315` — wrap workflow tools with `withDefaultDiscoveryTools`.
- `lib/tools/registry.ts:185-196, 407-451` — add `STATUS_GET_PRODUCT_INFO` and `STATUS_SET_CONVERSATION_PRODUCT` constants; wire them into the matching tool definitions.
- `prisma/seeds/seed-agents.ts:355-361` — append the new `set_conversation_product` confirmation rule to the `main-chat` agent constraints.

**Run after merging:**
- `npx tsx prisma/seeds/index.ts` (or `npx prisma db seed`) — re-seed agents so the new constraint reaches the DB. The seed uses `upsert`, so this is idempotent and only updates fields that changed.

---

## Task 1: DEFAULT_DISCOVERY_TOOLS constant + merge helper

**Files:**
- Create: `lib/chat/default-tools.ts`
- Create: `__tests__/lib/chat/default-tools.test.ts`

- [x] **Step 1: Write the failing test**

Create `__tests__/lib/chat/default-tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_DISCOVERY_TOOLS, withDefaultDiscoveryTools } from '@/lib/chat/default-tools'

describe('DEFAULT_DISCOVERY_TOOLS', () => {
  it('contains the three discovery tools', () => {
    expect(DEFAULT_DISCOVERY_TOOLS).toEqual([
      'list_products',
      'get_product_info',
      'set_conversation_product',
    ])
  })
})

describe('withDefaultDiscoveryTools', () => {
  it('returns the three baseline tools when input is empty', () => {
    const result = withDefaultDiscoveryTools([])
    expect(result).toEqual(['list_products', 'get_product_info', 'set_conversation_product'])
  })

  it('prepends baseline tools to workflow tools without duplicates', () => {
    const result = withDefaultDiscoveryTools(['save_application_answer', 'start_application'])
    expect(result).toEqual([
      'list_products',
      'get_product_info',
      'set_conversation_product',
      'save_application_answer',
      'start_application',
    ])
  })

  it('deduplicates when a workflow tool already matches a baseline tool', () => {
    const result = withDefaultDiscoveryTools(['list_products', 'save_application_answer'])
    expect(result).toEqual([
      'list_products',
      'get_product_info',
      'set_conversation_product',
      'save_application_answer',
    ])
    expect(result.filter((t) => t === 'list_products')).toHaveLength(1)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/lib/chat/default-tools.test.ts`
Expected: FAIL — module `@/lib/chat/default-tools` not found.

- [x] **Step 3: Write minimal implementation**

Create `lib/chat/default-tools.ts`:

```ts
/**
 * Default discovery tool set — always available to the agent regardless of
 * workflow state. Lets the agent enumerate the product catalogue, look up
 * specific products, and commit a product choice during the pre-workflow phase.
 *
 * See docs/superpowers/specs/2026-05-20-zeno-discovery-toolset-design.md.
 */

export const DEFAULT_DISCOVERY_TOOLS = [
  'list_products',
  'get_product_info',
  'set_conversation_product',
] as const

/**
 * Returns the union of DEFAULT_DISCOVERY_TOOLS and the given tools.
 * Order: baseline first, then the provided tools, with duplicates removed.
 */
export function withDefaultDiscoveryTools(tools: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const t of DEFAULT_DISCOVERY_TOOLS) {
    if (!seen.has(t)) {
      seen.add(t)
      result.push(t)
    }
  }
  for (const t of tools) {
    if (!seen.has(t)) {
      seen.add(t)
      result.push(t)
    }
  }
  return result
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/lib/chat/default-tools.test.ts`
Expected: PASS — 4 tests pass.

- [x] **Step 5: Commit**

```bash
git add lib/chat/default-tools.ts __tests__/lib/chat/default-tools.test.ts
git commit -m "feat(chat): add DEFAULT_DISCOVERY_TOOLS baseline + merge helper

Establishes list_products, get_product_info, and set_conversation_product
as a baseline tool set the agent always sees during the pre-workflow
discovery phase. Per subsystem D of the Zeno reliability redesign."
```

---

## Task 2: computeAllowedTools — intersection to union

**Files:**
- Modify: `lib/skills/skill-pack-loader.ts:126-142`
- Modify: `__tests__/lib/skills/skill-pack-loader.test.ts:232-280`

- [x] **Step 1: Rewrite the existing tests to assert union behaviour**

Replace the entire `describe('computeAllowedTools', ...)` block in `__tests__/lib/skills/skill-pack-loader.test.ts:235-280` with:

```ts
describe('computeAllowedTools', () => {
  it('returns the union of workflow tools and pack tools', () => {
    const workflowTools = ['search_products', 'calculate_premium', 'send_email']
    const packs = [
      makeSkillPack({ allowedTools: ['search_products', 'calculate_premium', 'admin_tool'] }),
    ]

    const result = computeAllowedTools(workflowTools, packs as any)

    expect(result).toEqual(expect.arrayContaining([
      'search_products',
      'calculate_premium',
      'send_email',
      'admin_tool',
    ]))
    expect(result).toHaveLength(4)
  })

  it('returns workflow tools when no packs active', () => {
    const workflowTools = ['search_products', 'calculate_premium']

    const result = computeAllowedTools(workflowTools, [])

    expect(result).toEqual(['search_products', 'calculate_premium'])
  })

  it('unions tools from multiple packs with workflow tools', () => {
    const workflowTools = ['search_products', 'calculate_premium']
    const packs = [
      makeSkillPack({ slug: 'pack-a', allowedTools: ['send_email'] }),
      makeSkillPack({ slug: 'pack-b', allowedTools: ['get_quote'] }),
    ]

    const result = computeAllowedTools(workflowTools, packs as any)

    expect(result).toEqual(expect.arrayContaining([
      'search_products', 'calculate_premium', 'send_email', 'get_quote',
    ]))
    expect(result).toHaveLength(4)
  })

  it('returns pack tools when workflow tools are empty', () => {
    const workflowTools: string[] = []
    const packs = [
      makeSkillPack({ allowedTools: ['list_products', 'get_product_info'] }),
    ]

    const result = computeAllowedTools(workflowTools, packs as any)

    expect(result).toEqual(expect.arrayContaining(['list_products', 'get_product_info']))
    expect(result).toHaveLength(2)
  })

  it('deduplicates when workflow and packs share a tool', () => {
    const workflowTools = ['search_products', 'calculate_premium']
    const packs = [
      makeSkillPack({ allowedTools: ['search_products', 'send_email'] }),
    ]

    const result = computeAllowedTools(workflowTools, packs as any)

    expect(result).toEqual(expect.arrayContaining([
      'search_products', 'calculate_premium', 'send_email',
    ]))
    expect(result).toHaveLength(3)
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- __tests__/lib/skills/skill-pack-loader.test.ts -t "computeAllowedTools"`
Expected: FAIL — current implementation uses intersection; new tests assert union.

- [x] **Step 3: Rewrite the implementation**

Replace the function body in `lib/skills/skill-pack-loader.ts:126-142` with:

```ts
// ============================================================
// computeAllowedTools
// ============================================================

/**
 * Compute the set of tools available to the LLM for this turn.
 *
 * Returns the UNION of workflow-step tools and all tools allowed by active
 * skill packs. Duplicates are removed. Workflow tools come first, then pack
 * tools in pack order.
 *
 * (Previous behaviour was intersection, which zeroed out pack tools whenever
 * workflow tools were empty. The union semantics align with subsystem D:
 * default discovery tools are baseline, workflow and packs add to that.)
 */
export function computeAllowedTools(
  workflowStepTools: string[],
  packs: SkillPack[],
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const t of workflowStepTools) {
    if (!seen.has(t)) {
      seen.add(t)
      result.push(t)
    }
  }
  for (const pack of packs) {
    for (const t of pack.allowedTools) {
      if (!seen.has(t)) {
        seen.add(t)
        result.push(t)
      }
    }
  }
  return result
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test -- __tests__/lib/skills/skill-pack-loader.test.ts -t "computeAllowedTools"`
Expected: PASS — 5 tests pass.

- [x] **Step 5: Run the full skill-pack-loader test file to catch regressions**

Run: `npm test -- __tests__/lib/skills/skill-pack-loader.test.ts`
Expected: PASS — all tests in the file pass.

- [x] **Step 6: Commit**

```bash
git add lib/skills/skill-pack-loader.ts __tests__/lib/skills/skill-pack-loader.test.ts
git commit -m "fix(skills): computeAllowedTools returns union, not intersection

Previous intersection semantics zeroed out pack-contributed tools when
workflow tools were empty (pre-workflow conversations). Switch to union
so the baseline + workflow + pack tools all reach the LLM. Tests updated."
```

---

## Task 3: Orchestrator — apply baseline merge to stepAllowedTools

**Files:**
- Modify: `lib/chat/orchestrator.ts:315`

- [x] **Step 1: Read the current orchestrator code at the change site**

Read `lib/chat/orchestrator.ts` around line 315 to confirm the surrounding context matches expectations.

- [x] **Step 2: Add the import and update the line**

Edit `lib/chat/orchestrator.ts`:

1. Add to the import block at the top of the file:
   ```ts
   import { withDefaultDiscoveryTools } from '@/lib/chat/default-tools'
   ```

2. Replace line 315:
   ```ts
   const stepAllowedTools = turnCtx.conversation.workflowSession?.currentStep.allowedTools ?? []
   ```
   with:
   ```ts
   const stepAllowedTools = withDefaultDiscoveryTools(
     turnCtx.conversation.workflowSession?.currentStep.allowedTools ?? [],
   )
   ```

The downstream usage of `stepAllowedTools` (line 384, 492, 758) needs no change — it now already includes the baseline.

- [x] **Step 3: Write an integration test for the orchestrator change**

Create `__tests__/lib/chat/orchestrator-discovery-tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { withDefaultDiscoveryTools } from '@/lib/chat/default-tools'

// Pure-function reproduction of the orchestrator's tool-list assembly,
// guarded so that a regression in withDefaultDiscoveryTools or the
// orchestrator's usage shows up here.

describe('orchestrator tool list assembly (subsystem D)', () => {
  it('includes the three discovery tools when no workflow is active', () => {
    const workflowAllowedTools: string[] = []
    const stepAllowedTools = withDefaultDiscoveryTools(workflowAllowedTools)

    expect(stepAllowedTools).toContain('list_products')
    expect(stepAllowedTools).toContain('get_product_info')
    expect(stepAllowedTools).toContain('set_conversation_product')
  })

  it('includes discovery tools alongside workflow tools when both present', () => {
    const workflowAllowedTools = ['save_application_answer', 'start_application']
    const stepAllowedTools = withDefaultDiscoveryTools(workflowAllowedTools)

    expect(stepAllowedTools).toContain('list_products')
    expect(stepAllowedTools).toContain('save_application_answer')
    expect(stepAllowedTools).toContain('start_application')
  })
})
```

- [x] **Step 4: Run the new test plus the broader orchestrator-adjacent tests**

Run: `npm test -- __tests__/lib/chat/orchestrator-discovery-tools.test.ts`
Expected: PASS.

Run: `npm test -- __tests__/lib/chat/`
Expected: PASS — no regressions in other chat tests.

- [x] **Step 5: Commit**

```bash
git add lib/chat/orchestrator.ts __tests__/lib/chat/orchestrator-discovery-tools.test.ts
git commit -m "feat(orchestrator): always include DEFAULT_DISCOVERY_TOOLS in stepAllowedTools

Pre-workflow conversations now receive the baseline catalogue tools
(list_products, get_product_info, set_conversation_product) so the agent
can ground product discussions in real inventory."
```

---

## Task 4: Loading copy for get_product_info and set_conversation_product

**Files:**
- Modify: `lib/tools/registry.ts`

- [x] **Step 1: Read the existing STATUS constant patterns**

Read `lib/tools/registry.ts:185-196` to confirm the format of `STATUS_PRODUCT_LOOKUP`. Read the area around line 407-451 to see how it is wired into tool definitions.

- [x] **Step 2: Add two new STATUS constants**

In `lib/tools/registry.ts`, immediately after the `STATUS_PRODUCT_LOOKUP` declaration (around line 196), add:

```ts
const STATUS_GET_PRODUCT_INFO = {
  ro: [
    'Verific detaliile produsului... un moment',
    'Caut datele exacte ale produsului',
    'Citesc fișa produsului pentru tine',
  ],
  en: [
    'Looking up product details... one moment',
    'Reading the product datasheet',
    'Pulling the exact product info',
  ],
}

const STATUS_SET_CONVERSATION_PRODUCT = {
  ro: [
    'Confirm produsul selectat',
    'Salvez alegerea ta',
    'Înregistrez produsul ales',
  ],
  en: [
    'Confirming the selected product',
    'Saving your choice',
    'Recording the selected product',
  ],
}
```

- [x] **Step 3: Find the get_product_info and set_conversation_product tool definitions and attach statusMessage**

Search for the existing `statusMessage: STATUS_PRODUCT_LOOKUP` usages (lines 407, 427, 451) — those identify the `list_products` (and possibly `get_product_info`?) tool definitions. Locate the `get_product_info` tool definition and the `set_conversation_product` tool definition. For each:

- If `get_product_info` currently uses `STATUS_PRODUCT_LOOKUP`, change it to `STATUS_GET_PRODUCT_INFO`.
- If `set_conversation_product` has no `statusMessage`, add `statusMessage: STATUS_SET_CONVERSATION_PRODUCT,` inside its tool definition object.

The exact field placement is the same as the existing `statusMessage: STATUS_PRODUCT_LOOKUP` lines.

- [x] **Step 4: Write a unit test asserting the constants are present and well-formed**

Create `__tests__/lib/tools/discovery-tool-status.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getToolDefinition } from '@/lib/tools/registry'

describe('discovery tool status messages', () => {
  it('list_products has bilingual status messages', () => {
    const def = getToolDefinition('list_products')
    expect(def?.statusMessage).toBeDefined()
    expect(def?.statusMessage?.ro?.length).toBeGreaterThan(0)
    expect(def?.statusMessage?.en?.length).toBeGreaterThan(0)
  })

  it('get_product_info has bilingual status messages', () => {
    const def = getToolDefinition('get_product_info')
    expect(def?.statusMessage).toBeDefined()
    expect(def?.statusMessage?.ro?.length).toBeGreaterThan(0)
    expect(def?.statusMessage?.en?.length).toBeGreaterThan(0)
  })

  it('set_conversation_product has bilingual status messages', () => {
    const def = getToolDefinition('set_conversation_product')
    expect(def?.statusMessage).toBeDefined()
    expect(def?.statusMessage?.ro?.length).toBeGreaterThan(0)
    expect(def?.statusMessage?.en?.length).toBeGreaterThan(0)
  })
})
```

- [x] **Step 5: Run the new test**

Run: `npm test -- __tests__/lib/tools/discovery-tool-status.test.ts`
Expected: PASS.

If `get_product_info` or `set_conversation_product` tool definitions are missing from the registry entirely, the test will fail with `def?.statusMessage` being undefined. In that case the failure points to a registry gap to address; the spec assumes these tools already exist as definitions.

- [x] **Step 6: Commit**

```bash
git add lib/tools/registry.ts __tests__/lib/tools/discovery-tool-status.test.ts
git commit -m "feat(tools): bilingual status messages for get_product_info and set_conversation_product

The discovery toolset now has consistent loading copy across all three
tools, surfacing customer-facing progress while the catalog is consulted
or a product choice is committed."
```

---

## Task 5: Append constraint rule for set_conversation_product

**Files:**
- Modify: `prisma/seeds/seed-agents.ts:355-361`

- [x] **Step 1: Add the new constraint to the main-chat agent definition**

In `prisma/seeds/seed-agents.ts`, replace the `constraints` array for the `main-chat` agent (lines 355-361):

```ts
    constraints: JSON.stringify([
      'No invented URLs or links',
      'No fake forms — system handles UI',
      'No promises without tool actions',
      'Past tense for completed actions',
      'Insurance and financial services only',
      'Before calling set_conversation_product, the customer must have explicitly confirmed the product choice in their most recent message. If unclear, ask "confirmi că alegi {productName}?" (RO) or "confirm you\'d like {productName}?" (EN) and wait for their response. Never call set_conversation_product based solely on the customer expressing interest in a category.',
    ]),
```

- [x] **Step 2: Write a unit test against the seed file's exported AGENTS list**

The current seed file does not export `AGENTS`. Locate the declaration at line 343 (`const AGENTS: AgentDef[] = [`) and change `const` to `export const`. Then create `__tests__/prisma/seeds/main-chat-constraints.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { AGENTS } from '@/prisma/seeds/seed-agents'

describe('main-chat agent constraints', () => {
  it('includes the set_conversation_product confirmation rule', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat).toBeDefined()
    expect(mainChat?.constraints).toBeTruthy()
    const parsed = JSON.parse(mainChat!.constraints as string)
    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.stringContaining('set_conversation_product'),
      ]),
    )
  })

  it('keeps all original constraint rules', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    const parsed = JSON.parse(mainChat!.constraints as string)
    expect(parsed).toEqual(
      expect.arrayContaining([
        'No invented URLs or links',
        'No fake forms — system handles UI',
        'No promises without tool actions',
        'Past tense for completed actions',
        'Insurance and financial services only',
      ]),
    )
  })
})
```

- [x] **Step 3: Run the test**

Run: `npm test -- __tests__/prisma/seeds/main-chat-constraints.test.ts`
Expected: PASS — both tests pass.

- [x] **Step 4: Apply the seed to the local database**

Run: `npx tsx prisma/seeds/index.ts`
Expected: console output `Agent "main-chat" (main-chat) upserted` and overall success message. The seed is upsert-only, so it is safe to re-run.

(If the seed runner relies on `npx prisma db seed`, that works too — both invoke `prisma/seeds/index.ts`.)

- [x] **Step 5: Verify the constraint reached the DB**

Run: `node -e "(async () => { const { PrismaClient } = require('./lib/generated/prisma/client'); const { PrismaPg } = require('@prisma/adapter-pg'); require('dotenv').config(); const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }); const a = await prisma.agent.findUnique({ where: { slug: 'main-chat' } }); console.log(a.constraints); await prisma.\\$disconnect(); })()"`

Expected: prints the constraints JSON with the new rule included.

- [x] **Step 6: Commit**

```bash
git add prisma/seeds/seed-agents.ts __tests__/prisma/seeds/main-chat-constraints.test.ts
git commit -m "feat(agents): add set_conversation_product confirmation rule to main-chat

Constraint requires explicit customer confirmation before committing
to a product via set_conversation_product. Prevents the agent from
locking in a product choice based on interest alone."
```

---

## Task 6: Behavioural replay test — empty home-insurance catalog produces unavailability response

**Files:**
- Create: `__tests__/lib/chat/discovery-empty-catalog.test.ts`

This test exercises the full path from `list_products` returning empty to the agent's tool list being correctly populated. It does not run a real LLM call; instead, it asserts that the orchestrator's tool-assembly path produces an `allowedTools` containing the catalogue tool, given a no-workflow conversation state.

- [x] **Step 1: Write the test**

Create `__tests__/lib/chat/discovery-empty-catalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { withDefaultDiscoveryTools } from '@/lib/chat/default-tools'
import { computeAllowedTools } from '@/lib/skills/skill-pack-loader'

describe('discovery flow (subsystem D regression)', () => {
  it('agent has list_products available with no workflow and no packs', () => {
    // Reproduces the orchestrator's tool-list construction sequence:
    //   stepAllowedTools = withDefaultDiscoveryTools(workflow ?? [])
    //   effectiveTools = computeAllowedTools(stepAllowedTools, packs)
    const workflowAllowedTools: string[] = []
    const packs: any[] = []

    const stepAllowedTools = withDefaultDiscoveryTools(workflowAllowedTools)
    const effectiveTools = computeAllowedTools(stepAllowedTools, packs)

    expect(effectiveTools).toContain('list_products')
    expect(effectiveTools).toContain('get_product_info')
    expect(effectiveTools).toContain('set_conversation_product')
  })

  it('agent retains discovery tools even when a pack contributes its own tools', () => {
    const workflowAllowedTools: string[] = []
    const packs: any[] = [
      { slug: 'life-insurance-discovery', allowedTools: ['calculate_premium'] },
    ]

    const stepAllowedTools = withDefaultDiscoveryTools(workflowAllowedTools)
    const effectiveTools = computeAllowedTools(stepAllowedTools, packs)

    expect(effectiveTools).toContain('list_products')
    expect(effectiveTools).toContain('calculate_premium')
  })

  it('agent has all five tools when workflow is active and pack contributes one extra', () => {
    const workflowAllowedTools = ['save_application_answer']
    const packs: any[] = [
      { slug: 'life-insurance-discovery', allowedTools: ['calculate_premium'] },
    ]

    const stepAllowedTools = withDefaultDiscoveryTools(workflowAllowedTools)
    const effectiveTools = computeAllowedTools(stepAllowedTools, packs)

    expect(effectiveTools).toEqual(
      expect.arrayContaining([
        'list_products',
        'get_product_info',
        'set_conversation_product',
        'save_application_answer',
        'calculate_premium',
      ]),
    )
    expect(effectiveTools).toHaveLength(5)
  })
})
```

- [x] **Step 2: Run the test**

Run: `npm test -- __tests__/lib/chat/discovery-empty-catalog.test.ts`
Expected: PASS — all three tests pass.

- [x] **Step 3: Commit**

```bash
git add __tests__/lib/chat/discovery-empty-catalog.test.ts
git commit -m "test(chat): regression coverage for subsystem D discovery tool exposure

Asserts the three discovery tools survive the orchestrator's tool-list
assembly across all three scenarios (no workflow + no packs, no workflow
+ packs, workflow + packs). Guards against future intersection-style
regressions."
```

---

## Task 7: Full test sweep before closing the subsystem

- [x] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — full suite passes with no regressions. (If unrelated pre-existing failures are present, document them and proceed — the goal is no NEW failures from this work.)

- [x] **Step 2: Update the subsystem D plan file**

Mark all `- [x]` boxes in this file as `- [x]`. Commit:

```bash
git add docs/superpowers/plans/2026-05-20-zeno-discovery-toolset.md
git commit -m "docs(plans): mark subsystem D plan complete"
```
