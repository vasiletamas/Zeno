# Agent Extensibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add skill-pack-based agent extensibility with conversation mode routing, gate-triggered compliance checking, and admin UI for skill pack configuration.

**Architecture:** Skill packs are DB-stored bundles of prompt sections + tools + constraints that the reasoning gate selects per turn. Conversation mode (SALES, ONBOARDING, SUPPORT, CLAIMS, RENEWAL) is tracked on the conversation record and drives agent resolution. A new compliance-checker agent runs in parallel when the gate flags compliance-relevant turns.

**Tech Stack:** Prisma (schema + migrations), TypeScript, Vitest, Next.js App Router, React, Tailwind CSS, shadcn/ui

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `lib/skills/skill-pack-loader.ts` | Load, cache, merge skill packs; compute allowed tools |
| `lib/chat/compliance-checker.ts` | Execute compliance check agent, parse structured output |
| `lib/chat/agent-resolver.ts` | Map conversation mode to agent slug |
| `prisma/seeds/seed-skill-packs.ts` | Seed 7 initial skill packs |
| `app/api/admin/skill-packs/route.ts` | GET list, no POST (admin can't create) |
| `app/api/admin/skill-packs/[id]/route.ts` | GET detail, PUT update |
| `app/api/admin/skill-packs/[id]/toggle/route.ts` | POST activate/deactivate |
| `app/api/admin/skill-packs/flush-cache/route.ts` | POST flush cache |
| `app/admin/(protected)/skill-packs/page.tsx` | Skill pack list + edit page |
| `components/admin/skill-pack-table.tsx` | Skill pack list table component |
| `components/admin/skill-pack-editor.tsx` | Skill pack detail editor component |
| `__tests__/lib/skills/skill-pack-loader.test.ts` | Unit tests for loader + merging |
| `__tests__/lib/chat/compliance-checker.test.ts` | Unit tests for compliance checker |
| `__tests__/lib/chat/agent-resolver.test.ts` | Unit tests for agent resolution |
| `__tests__/integration/skill-pack-orchestrator.test.ts` | Integration test for full pipeline |

### Modified Files
| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add SkillPack model, add `role` to Agent (drop `type`/enum), add `mode`+`activeSkillPacks` to Conversation |
| `lib/llm/agent-config.ts` | Update AgentConfig interface: `role` instead of `type` |
| `lib/chat/reasoning-gate.ts` | Extend ReasoningGateOutput + ReasoningGateInput, update FALLBACK_OUTPUT, update buildGateContextMessage |
| `lib/chat/prompt-builder.ts` | Add `complianceGuidance` section to SECTION_REGISTRY |
| `lib/chat/context-loaders.ts` | Add `complianceGuidance` to PromptSections type and loadAllSections return |
| `lib/chat/orchestrator.ts` | Replace hardcoded 'main-chat', add skill pack loading, add compliance check, extend TurnState + turn trace |
| `prisma/seeds/seed-agents.ts` | Add compliance-checker agent, change `type` → `role` |
| `prisma/seed.ts` | Import and call seedSkillPacks |
| `app/admin/(protected)/agents/page.tsx` | Display `role` instead of `type` |
| `components/admin/agent-config-row.tsx` | Change `type` → `role` in interface and display |

---

### Task 1: Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add SkillPack model to schema**

Add after the Agent model in `prisma/schema.prisma`:

```prisma
model SkillPack {
  id             String   @id @default(cuid())
  slug           String   @unique
  name           String
  category       String   // PRODUCT, WORKFLOW_PHASE, POST_SALE
  description    String
  promptSections Json     // { sectionKey: content }
  allowedTools   String[]
  constraints    String?  @db.Text
  flags          Json?    // { persuasive: boolean, ... }
  isActive       Boolean  @default(true)
  priority       Int      @default(0)
  agents         Agent[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

- [ ] **Step 2: Update Agent model — replace type enum with role string**

Replace the Agent model:

```prisma
model Agent {
  id               String      @id @default(cuid())
  slug             String      @unique
  name             String
  role             String      // replaces AgentType enum
  provider         LLMProvider @default(OPENAI)
  model            String
  fallbackProvider LLMProvider? @default(ANTHROPIC)
  fallbackModel    String?
  temperature      Float       @default(0.7)
  maxTokens        Int         @default(4096)
  systemPrompt     String?     @db.Text
  constraints      String?     @db.Text
  isActive         Boolean     @default(true)
  skillPacks       SkillPack[]
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt
}
```

Remove the `AgentType` enum entirely.

- [ ] **Step 3: Add mode and activeSkillPacks to Conversation model**

Add two fields to the Conversation model:

```prisma
model Conversation {
  // ...existing fields
  mode             String    @default("SALES")
  activeSkillPacks String[]
  // ...existing relations
}
```

- [ ] **Step 4: Generate and apply migration**

Run:
```bash
npx prisma migrate dev --name add-skill-packs-and-agent-extensibility
```
Expected: Migration created and applied successfully. Prisma Client regenerated.

- [ ] **Step 5: Fix any type references to AgentType enum**

Search the codebase for `AgentType` references and update them to use the `role` string field. Key locations:
- `prisma/seeds/seed-agents.ts` — change `type: 'MAIN_CHAT'` → `role: 'main-chat'` etc.
- `lib/llm/agent-config.ts` — update `AgentConfig` interface to use `role: string` instead of `type: AgentType`
- `components/admin/agent-config-row.tsx` — change `type` → `role` in interface
- `app/admin/(protected)/agents/page.tsx` — change `type` → `role` in display

- [ ] **Step 6: Verify build compiles**

Run:
```bash
npx tsc --noEmit
```
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ lib/llm/agent-config.ts prisma/seeds/seed-agents.ts components/admin/agent-config-row.tsx app/admin/\(protected\)/agents/page.tsx
git commit -m "feat: add SkillPack model, replace AgentType enum with role string"
```

---

### Task 2: Skill Pack Loader

**Files:**
- Create: `lib/skills/skill-pack-loader.ts`
- Test: `__tests__/lib/skills/skill-pack-loader.test.ts`

- [ ] **Step 1: Write failing tests for skill pack loader**

```typescript
// __tests__/lib/skills/skill-pack-loader.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma
vi.mock('@/lib/db', () => ({
  prisma: {
    skillPack: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/db'
import {
  getSkillPack,
  getActiveSkillPacks,
  mergeSkillPackSections,
  computeAllowedTools,
  flushSkillPackCache,
} from '@/lib/skills/skill-pack-loader'

const mockPack = (overrides: Partial<{
  slug: string
  promptSections: Record<string, string>
  allowedTools: string[]
  constraints: string | null
  flags: Record<string, boolean> | null
  isActive: boolean
  priority: number
}> = {}) => ({
  id: 'test-id',
  slug: overrides.slug ?? 'test-pack',
  name: 'Test Pack',
  category: 'PRODUCT',
  description: 'Test',
  promptSections: overrides.promptSections ?? { productContext: 'Test product info' },
  allowedTools: overrides.allowedTools ?? ['list_products', 'get_product_info'],
  constraints: overrides.constraints ?? null,
  flags: overrides.flags ?? null,
  isActive: overrides.isActive ?? true,
  priority: overrides.priority ?? 0,
  createdAt: new Date(),
  updatedAt: new Date(),
})

describe('getSkillPack', () => {
  beforeEach(() => {
    flushSkillPackCache()
    vi.clearAllMocks()
  })

  it('loads a skill pack by slug', async () => {
    const pack = mockPack({ slug: 'life-insurance-discovery' })
    vi.mocked(prisma.skillPack.findUnique).mockResolvedValue(pack as never)

    const result = await getSkillPack('life-insurance-discovery')
    expect(result.slug).toBe('life-insurance-discovery')
    expect(prisma.skillPack.findUnique).toHaveBeenCalledWith({
      where: { slug: 'life-insurance-discovery' },
    })
  })

  it('caches result on second call', async () => {
    const pack = mockPack()
    vi.mocked(prisma.skillPack.findUnique).mockResolvedValue(pack as never)

    await getSkillPack('test-pack')
    await getSkillPack('test-pack')
    expect(prisma.skillPack.findUnique).toHaveBeenCalledTimes(1)
  })

  it('throws on inactive skill pack', async () => {
    const pack = mockPack({ isActive: false })
    vi.mocked(prisma.skillPack.findUnique).mockResolvedValue(pack as never)

    await expect(getSkillPack('test-pack')).rejects.toThrow('inactive')
  })

  it('throws on unknown slug', async () => {
    vi.mocked(prisma.skillPack.findUnique).mockResolvedValue(null)

    await expect(getSkillPack('unknown')).rejects.toThrow('not found')
  })
})

describe('getActiveSkillPacks', () => {
  beforeEach(() => {
    flushSkillPackCache()
    vi.clearAllMocks()
  })

  it('returns empty array for empty slugs', async () => {
    const result = await getActiveSkillPacks([])
    expect(result).toEqual([])
  })

  it('returns packs sorted by priority descending', async () => {
    const low = mockPack({ slug: 'low', priority: 1 })
    const high = mockPack({ slug: 'high', priority: 10 })
    vi.mocked(prisma.skillPack.findMany).mockResolvedValue([low, high] as never)

    const result = await getActiveSkillPacks(['low', 'high'])
    expect(result[0].slug).toBe('high')
    expect(result[1].slug).toBe('low')
  })

  it('filters out inactive packs silently', async () => {
    const active = mockPack({ slug: 'active', isActive: true })
    const inactive = mockPack({ slug: 'inactive', isActive: false })
    vi.mocked(prisma.skillPack.findMany).mockResolvedValue([active, inactive] as never)

    const result = await getActiveSkillPacks(['active', 'inactive'])
    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe('active')
  })
})

describe('mergeSkillPackSections', () => {
  it('merges pack sections into base sections', () => {
    const base = {
      agentIdentity: 'I am Zeno',
      constraints: 'Base constraints',
      productContext: 'Base product info',
    }
    const packs = [mockPack({
      promptSections: { productContext: 'Override product info' },
      priority: 5,
    })]

    const result = mergeSkillPackSections(base, packs)
    expect(result.productContext).toBe('Override product info')
  })

  it('never overrides constitution layer sections', () => {
    const base = {
      agentIdentity: 'I am Zeno',
      constraints: 'Base constraints',
      capabilityManifest: 'Base tools',
    }
    const packs = [mockPack({
      promptSections: {
        agentIdentity: 'I am Evil',
        constraints: 'No constraints',
        capabilityManifest: 'All tools',
        productContext: 'New product',
      },
      priority: 99,
    })]

    const result = mergeSkillPackSections(base, packs)
    expect(result.agentIdentity).toBe('I am Zeno')
    expect(result.constraints).toBe('Base constraints')
    expect(result.capabilityManifest).toBe('Base tools')
    expect(result.productContext).toBe('New product')
  })

  it('higher priority pack wins on conflicts', () => {
    const base = { productContext: 'Base' }
    const lowPack = mockPack({
      slug: 'low',
      promptSections: { productContext: 'Low priority' },
      priority: 1,
    })
    const highPack = mockPack({
      slug: 'high',
      promptSections: { productContext: 'High priority' },
      priority: 10,
    })

    // Packs should already be sorted by priority desc from getActiveSkillPacks
    const result = mergeSkillPackSections(base, [highPack, lowPack])
    expect(result.productContext).toBe('High priority')
  })

  it('appends pack constraints to base constraints', () => {
    const base = { constraints: 'Be polite' }
    const packs = [mockPack({ constraints: 'Never discuss competitors' })]

    const result = mergeSkillPackSections(base, packs)
    expect(result.constraints).toContain('Be polite')
    expect(result.constraints).toContain('Never discuss competitors')
  })

  it('returns base sections unchanged when no packs', () => {
    const base = { agentIdentity: 'I am Zeno', productContext: 'Product' }
    const result = mergeSkillPackSections(base, [])
    expect(result).toEqual(base)
  })
})

describe('computeAllowedTools', () => {
  it('returns intersection of workflow tools and pack tools', () => {
    const workflowTools = ['list_products', 'get_product_info', 'start_application']
    const packs = [mockPack({ allowedTools: ['list_products', 'get_product_info'] })]

    const result = computeAllowedTools(workflowTools, packs)
    expect(result).toEqual(['list_products', 'get_product_info'])
    expect(result).not.toContain('start_application')
  })

  it('returns workflow tools when no packs active', () => {
    const workflowTools = ['list_products', 'start_application']
    const result = computeAllowedTools(workflowTools, [])
    expect(result).toEqual(workflowTools)
  })

  it('unions tools from multiple packs before intersecting', () => {
    const workflowTools = ['list_products', 'get_quote', 'start_application']
    const pack1 = mockPack({ slug: 'a', allowedTools: ['list_products'] })
    const pack2 = mockPack({ slug: 'b', allowedTools: ['get_quote'] })

    const result = computeAllowedTools(workflowTools, [pack1, pack2])
    expect(result).toContain('list_products')
    expect(result).toContain('get_quote')
    expect(result).not.toContain('start_application')
  })

  it('returns empty array when no overlap', () => {
    const workflowTools = ['start_application']
    const packs = [mockPack({ allowedTools: ['list_products'] })]

    const result = computeAllowedTools(workflowTools, packs)
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/skills/skill-pack-loader.test.ts`
Expected: FAIL — module `@/lib/skills/skill-pack-loader` not found.

- [ ] **Step 3: Implement skill pack loader**

```typescript
// lib/skills/skill-pack-loader.ts
import { prisma } from '@/lib/db'
import { LRUCache } from '@/lib/chat/token-budget'

/**
 * Constitution layer section keys that skill packs can never override.
 */
const CONSTITUTION_KEYS = new Set(['agentIdentity', 'constraints', 'capabilityManifest'])

/**
 * Cache: slug → SkillPack, 5-minute TTL, max 50 entries.
 */
const cache = new LRUCache<{
  id: string
  slug: string
  name: string
  category: string
  description: string
  promptSections: Record<string, string>
  allowedTools: string[]
  constraints: string | null
  flags: Record<string, boolean> | null
  isActive: boolean
  priority: number
}>(50, 300_000)

/**
 * Load a single skill pack by slug. Throws if not found or inactive.
 */
export async function getSkillPack(slug: string) {
  const cached = cache.get(slug)
  if (cached) return cached

  const pack = await prisma.skillPack.findUnique({ where: { slug } })

  if (!pack) {
    throw new Error(`SkillPack "${slug}" not found`)
  }
  if (!pack.isActive) {
    throw new Error(`SkillPack "${slug}" is inactive`)
  }

  const normalized = {
    id: pack.id,
    slug: pack.slug,
    name: pack.name,
    category: pack.category,
    description: pack.description,
    promptSections: (pack.promptSections ?? {}) as Record<string, string>,
    allowedTools: pack.allowedTools,
    constraints: pack.constraints,
    flags: (pack.flags ?? null) as Record<string, boolean> | null,
    isActive: pack.isActive,
    priority: pack.priority,
  }

  cache.set(slug, normalized)
  return normalized
}

/**
 * Load multiple skill packs by slugs. Returns only active packs, sorted by
 * priority descending (highest first). Inactive packs are silently filtered.
 */
export async function getActiveSkillPacks(slugs: string[]) {
  if (slugs.length === 0) return []

  const packs = await prisma.skillPack.findMany({
    where: { slug: { in: slugs } },
  })

  return packs
    .filter((p) => p.isActive)
    .sort((a, b) => b.priority - a.priority)
    .map((pack) => ({
      id: pack.id,
      slug: pack.slug,
      name: pack.name,
      category: pack.category,
      description: pack.description,
      promptSections: (pack.promptSections ?? {}) as Record<string, string>,
      allowedTools: pack.allowedTools,
      constraints: pack.constraints,
      flags: (pack.flags ?? null) as Record<string, boolean> | null,
      isActive: pack.isActive,
      priority: pack.priority,
    }))
}

/**
 * Merge skill pack prompt sections into base sections.
 *
 * Rules:
 * - Constitution layer (agentIdentity, constraints, capabilityManifest) is never overridden
 * - Packs must be sorted by priority descending — first pack wins on conflicts
 * - Pack constraints are appended to base constraints (not replaced)
 */
export function mergeSkillPackSections(
  baseSections: Record<string, string | null>,
  packs: { promptSections: Record<string, string>; constraints: string | null; priority: number }[],
): Record<string, string | null> {
  if (packs.length === 0) return { ...baseSections }

  const merged = { ...baseSections }
  const claimed = new Set<string>()

  // Collect constraint appendages
  const extraConstraints: string[] = []

  for (const pack of packs) {
    // Append constraints
    if (pack.constraints) {
      extraConstraints.push(pack.constraints)
    }

    // Merge prompt sections
    for (const [key, value] of Object.entries(pack.promptSections)) {
      // Never override constitution layer
      if (CONSTITUTION_KEYS.has(key)) continue
      // First pack (highest priority) claims the key
      if (claimed.has(key)) continue
      merged[key] = value
      claimed.add(key)
    }
  }

  // Append extra constraints to base
  if (extraConstraints.length > 0 && merged.constraints) {
    merged.constraints = merged.constraints + '\n\n' + extraConstraints.join('\n\n')
  }

  return merged
}

/**
 * Compute effective allowed tools: intersection of workflow step tools
 * and union of all active skill pack tools.
 *
 * Workflow step is the hard constraint (security boundary).
 * Skill packs refine within that boundary.
 */
export function computeAllowedTools(
  workflowStepTools: string[],
  packs: { allowedTools: string[] }[],
): string[] {
  if (packs.length === 0) return workflowStepTools

  // Union of all pack tools
  const packTools = new Set<string>()
  for (const pack of packs) {
    for (const tool of pack.allowedTools) {
      packTools.add(tool)
    }
  }

  // Intersection with workflow step tools
  return workflowStepTools.filter((t) => packTools.has(t))
}

/**
 * Flush the skill pack cache. Call after admin updates.
 */
export function flushSkillPackCache(): void {
  cache.clear()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/skills/skill-pack-loader.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/skills/skill-pack-loader.ts __tests__/lib/skills/skill-pack-loader.test.ts
git commit -m "feat: add skill pack loader with caching, merging, and tool scoping"
```

---

### Task 3: Agent Resolver

**Files:**
- Create: `lib/chat/agent-resolver.ts`
- Test: `__tests__/lib/chat/agent-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/lib/chat/agent-resolver.test.ts
import { describe, it, expect } from 'vitest'
import { resolveAgent } from '@/lib/chat/agent-resolver'

describe('resolveAgent', () => {
  it('returns main-chat for SALES mode', () => {
    expect(resolveAgent('SALES')).toBe('main-chat')
  })

  it('returns main-chat for ONBOARDING mode', () => {
    expect(resolveAgent('ONBOARDING')).toBe('main-chat')
  })

  it('returns main-chat for SUPPORT mode', () => {
    expect(resolveAgent('SUPPORT')).toBe('main-chat')
  })

  it('returns main-chat for CLAIMS mode', () => {
    expect(resolveAgent('CLAIMS')).toBe('main-chat')
  })

  it('returns main-chat for RENEWAL mode', () => {
    expect(resolveAgent('RENEWAL')).toBe('main-chat')
  })

  it('returns main-chat for unknown mode (fallback)', () => {
    expect(resolveAgent('UNKNOWN_MODE')).toBe('main-chat')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/chat/agent-resolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement agent resolver**

```typescript
// lib/chat/agent-resolver.ts

/**
 * Resolve which agent slug handles a given conversation mode.
 *
 * Currently all modes use 'main-chat' with different skill packs.
 * This function is the abstraction point — when a mode needs a
 * separate agent (different persona), only this function changes.
 */
export function resolveAgent(mode: string): string {
  switch (mode) {
    case 'SALES':
    case 'ONBOARDING':
    case 'SUPPORT':
    case 'CLAIMS':
    case 'RENEWAL':
      return 'main-chat'
    default:
      return 'main-chat'
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/chat/agent-resolver.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/chat/agent-resolver.ts __tests__/lib/chat/agent-resolver.test.ts
git commit -m "feat: add agent resolver for conversation mode routing"
```

---

### Task 4: Extend Reasoning Gate Output

**Files:**
- Modify: `lib/chat/reasoning-gate.ts`
- Test: `__tests__/lib/chat/reasoning-gate-extended.test.ts`

- [ ] **Step 1: Write failing tests for extended gate output parsing**

```typescript
// __tests__/lib/chat/reasoning-gate-extended.test.ts
import { describe, it, expect } from 'vitest'

// We test parseGateResponse which is not exported — we'll test via the
// public interface by mocking gateway. But first let's test the type
// contract by importing the output type.
import type { ReasoningGateOutput } from '@/lib/chat/reasoning-gate'

describe('ReasoningGateOutput extended fields', () => {
  it('type includes recommendedSkillPacks', () => {
    const output: ReasoningGateOutput = {
      situationType: 'discovery',
      complexity: 'simple',
      confidence: 0.9,
      requiredSections: [],
      excludedSections: [],
      briefing: 'test',
      toolGuidance: { prioritize: [], discourage: [] },
      recommendedSkillPacks: ['life-insurance-discovery'],
      complianceRelevant: false,
    }
    expect(output.recommendedSkillPacks).toEqual(['life-insurance-discovery'])
  })

  it('type includes modeTransition', () => {
    const output: ReasoningGateOutput = {
      situationType: 'post-sale',
      complexity: 'simple',
      confidence: 0.85,
      requiredSections: [],
      excludedSections: [],
      briefing: 'test',
      toolGuidance: { prioritize: [], discourage: [] },
      recommendedSkillPacks: ['post-sale-support'],
      modeTransition: 'SUPPORT',
      complianceRelevant: false,
    }
    expect(output.modeTransition).toBe('SUPPORT')
  })

  it('type includes complianceRelevant', () => {
    const output: ReasoningGateOutput = {
      situationType: 'recommendation',
      complexity: 'complex',
      confidence: 0.95,
      requiredSections: ['productContext'],
      excludedSections: [],
      briefing: 'test',
      toolGuidance: { prioritize: [], discourage: [] },
      recommendedSkillPacks: ['life-insurance-closing'],
      complianceRelevant: true,
    }
    expect(output.complianceRelevant).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/chat/reasoning-gate-extended.test.ts`
Expected: FAIL — `recommendedSkillPacks` does not exist on type `ReasoningGateOutput`.

- [ ] **Step 3: Extend ReasoningGateOutput interface**

In `lib/chat/reasoning-gate.ts`, update the interface (around line 46):

```typescript
export interface ReasoningGateOutput {
  situationType: string
  complexity: 'simple' | 'moderate' | 'complex'
  confidence: number
  contradictions?: { tension: string; resolution: string; winner: string }[]
  concernActions?: {
    concern: string
    gateAssessment: string
    action: string
    reason: string
  }[]
  requiredSections: string[]
  excludedSections: string[]
  briefing: string
  toolGuidance: { prioritize: string[]; discourage: string[] }
  knowledgeGaps?: string[]

  // Sub-project #4: Agent Extensibility
  recommendedSkillPacks: string[]
  modeTransition?: string
  complianceRelevant: boolean
}
```

- [ ] **Step 4: Update FALLBACK_OUTPUT constant**

In `lib/chat/reasoning-gate.ts`, update the fallback (around line 68):

```typescript
const FALLBACK_OUTPUT: ReasoningGateOutput = {
  situationType: 'unknown',
  complexity: 'moderate',
  confidence: 0,
  requiredSections: [],
  excludedSections: [],
  briefing: '',
  toolGuidance: { prioritize: [], discourage: [] },
  recommendedSkillPacks: [],
  complianceRelevant: false,
}
```

- [ ] **Step 5: Update parseGateResponse to handle new fields**

In the `parseGateResponse` function inside `lib/chat/reasoning-gate.ts`, add parsing for the new fields after existing parsing logic:

```typescript
// After existing field parsing, add:
const recommendedSkillPacks = Array.isArray(parsed.recommendedSkillPacks)
  ? parsed.recommendedSkillPacks.filter((s: unknown) => typeof s === 'string')
  : []

const modeTransition = typeof parsed.modeTransition === 'string'
  ? parsed.modeTransition
  : undefined

const complianceRelevant = parsed.complianceRelevant === true
```

And include them in the return object:

```typescript
return {
  // ...existing fields
  recommendedSkillPacks,
  modeTransition,
  complianceRelevant,
}
```

- [ ] **Step 6: Extend ReasoningGateInput and buildGateContextMessage**

In `lib/chat/reasoning-gate.ts`, add to the `ReasoningGateInput` interface:

```typescript
export interface ReasoningGateInput {
  // ...existing fields
  currentMode: string
  availableSkillPacks: { slug: string; description: string }[]
  activeSkillPacks: string[]
}
```

In `buildGateContextMessage`, append new context to the message:

```typescript
// Add after existing context sections:
parts.push(`\n[Conversation Mode] ${input.currentMode}`)

if (input.activeSkillPacks.length > 0) {
  parts.push(`[Active Skill Packs] ${input.activeSkillPacks.join(', ')}`)
}

if (input.availableSkillPacks.length > 0) {
  parts.push(`[Available Skill Packs]\n${input.availableSkillPacks
    .map((p) => `- ${p.slug}: ${p.description}`)
    .join('\n')}`)
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/chat/reasoning-gate-extended.test.ts`
Expected: All tests PASS.

- [ ] **Step 8: Run all existing tests to check for regressions**

Run: `npx vitest run`
Expected: All tests PASS (existing gate tests may need FALLBACK_OUTPUT update if they check for exact shape).

- [ ] **Step 9: Commit**

```bash
git add lib/chat/reasoning-gate.ts __tests__/lib/chat/reasoning-gate-extended.test.ts
git commit -m "feat: extend reasoning gate with skill pack selection, mode transitions, compliance flag"
```

---

### Task 5: Compliance Checker Agent

**Files:**
- Create: `lib/chat/compliance-checker.ts`
- Test: `__tests__/lib/chat/compliance-checker.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/lib/chat/compliance-checker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/llm/gateway', () => ({
  gateway: {
    call: vi.fn(),
  },
}))

vi.mock('@/lib/errors/logger', () => ({
  logWarn: vi.fn(),
}))

import { gateway } from '@/lib/llm/gateway'
import { executeComplianceCheck, type ComplianceCheckResult } from '@/lib/chat/compliance-checker'

describe('executeComplianceCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns parsed compliance result on valid response', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({
        passed: false,
        gaps: ['Customer needs not formally identified'],
        suggestions: ['Ask customer to confirm protection needs'],
      }),
    } as never)

    const result = await executeComplianceCheck({
      messages: [{ role: 'user', content: 'I want the cheapest plan' }],
      workflowStepCode: 'quote_presentation',
      customerProfile: { age: 35 },
    })

    expect(result.passed).toBe(false)
    expect(result.gaps).toHaveLength(1)
    expect(result.suggestions).toHaveLength(1)
  })

  it('calls gateway with compliance-checker slug', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({ passed: true, gaps: [], suggestions: [] }),
    } as never)

    await executeComplianceCheck({
      messages: [{ role: 'user', content: 'test' }],
      workflowStepCode: null,
      customerProfile: null,
    })

    expect(gateway.call).toHaveBeenCalledWith(
      'compliance-checker',
      expect.objectContaining({ messages: expect.any(Array) }),
    )
  })

  it('returns passing result on empty response', async () => {
    vi.mocked(gateway.call).mockResolvedValue({ content: '' } as never)

    const result = await executeComplianceCheck({
      messages: [],
      workflowStepCode: null,
      customerProfile: null,
    })

    expect(result.passed).toBe(true)
    expect(result.gaps).toEqual([])
  })

  it('returns passing result on parse failure', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: 'not json at all',
    } as never)

    const result = await executeComplianceCheck({
      messages: [],
      workflowStepCode: null,
      customerProfile: null,
    })

    expect(result.passed).toBe(true)
    expect(result.gaps).toEqual([])
  })

  it('returns passing result on gateway error (fail-open)', async () => {
    vi.mocked(gateway.call).mockRejectedValue(new Error('timeout'))

    const result = await executeComplianceCheck({
      messages: [],
      workflowStepCode: null,
      customerProfile: null,
    })

    expect(result.passed).toBe(true)
    expect(result.gaps).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/chat/compliance-checker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement compliance checker**

```typescript
// lib/chat/compliance-checker.ts
import { gateway } from '@/lib/llm/gateway'
import { logWarn } from '@/lib/errors/logger'
import type { Message } from '@/lib/llm/providers/types'

export interface ComplianceCheckInput {
  messages: Message[]
  workflowStepCode: string | null
  customerProfile: Record<string, unknown> | null
}

export interface ComplianceCheckResult {
  passed: boolean
  gaps: string[]
  suggestions: string[]
}

const PASS_RESULT: ComplianceCheckResult = {
  passed: true,
  gaps: [],
  suggestions: [],
}

/**
 * Execute the compliance checker agent.
 *
 * Evaluates the conversation against IDD/GDPR requirements:
 * - Needs identification before recommendation
 * - Suitability assessment
 * - Proper disclosure
 * - Informed consent
 * - GDPR data consent
 *
 * Fail-open: any error returns a passing result. The compliance checker
 * is a guardrail, not a gate — it never blocks the response.
 */
export async function executeComplianceCheck(
  input: ComplianceCheckInput,
): Promise<ComplianceCheckResult> {
  try {
    const contextParts: string[] = [
      'Evaluate this insurance conversation for IDD and GDPR compliance.',
      'Check: (1) needs identification before recommendation, (2) suitability assessment, (3) disclosure of role and insurer, (4) informed consent, (5) GDPR data consent.',
      'Respond with JSON only: { "passed": boolean, "gaps": string[], "suggestions": string[] }',
    ]

    if (input.workflowStepCode) {
      contextParts.push(`Current workflow step: ${input.workflowStepCode}`)
    }
    if (input.customerProfile) {
      contextParts.push(`Customer profile: ${JSON.stringify(input.customerProfile)}`)
    }

    const systemMessage: Message = {
      role: 'user',
      content: contextParts.join('\n'),
    }

    // Build message array: system context + recent conversation messages
    const messages: Message[] = [
      systemMessage,
      ...input.messages.slice(-10), // Last 10 messages for context
    ]

    const response = await gateway.call('compliance-checker', { messages })

    if (!response.content) {
      return { ...PASS_RESULT }
    }

    return parseComplianceResponse(response.content)
  } catch (err: unknown) {
    logWarn({
      layer: 'orchestrator',
      category: 'compliance_checker',
      message: 'Compliance checker failed, defaulting to pass',
      error: err,
    })
    return { ...PASS_RESULT }
  }
}

function parseComplianceResponse(content: string): ComplianceCheckResult {
  try {
    // Extract JSON from response (may have markdown wrapping)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { ...PASS_RESULT }

    const parsed = JSON.parse(jsonMatch[0])

    return {
      passed: parsed.passed === true,
      gaps: Array.isArray(parsed.gaps)
        ? parsed.gaps.filter((g: unknown) => typeof g === 'string')
        : [],
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.filter((s: unknown) => typeof s === 'string')
        : [],
    }
  } catch {
    return { ...PASS_RESULT }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/chat/compliance-checker.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/chat/compliance-checker.ts __tests__/lib/chat/compliance-checker.test.ts
git commit -m "feat: add compliance checker agent with fail-open behavior"
```

---

### Task 6: Add complianceGuidance Prompt Section

**Files:**
- Modify: `lib/chat/prompt-builder.ts`
- Modify: `lib/chat/context-loaders.ts`

- [ ] **Step 1: Add complianceGuidance to SECTION_REGISTRY**

In `lib/chat/prompt-builder.ts`, add a new entry to `SECTION_REGISTRY` after `situationalBriefing` (priority 10):

```typescript
  { key: 'complianceGuidance', priority: 9, layer: 'dynamic', alwaysInclude: false, prefix: '=== COMPLIANCE GUIDANCE ===' },
```

Priority 9 places it just before situationalBriefing, ensuring compliance guidance is seen early in the dynamic section.

- [ ] **Step 2: Add complianceGuidance to PromptSections type**

In `lib/chat/context-loaders.ts`, find the `PromptSections` type (or wherever it's defined) and add:

```typescript
complianceGuidance?: string | null
```

Also add it to the return value of `loadAllSections`:

```typescript
return {
  // ...existing sections
  complianceGuidance: null, // injected by orchestrator when compliance checker runs
}
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add lib/chat/prompt-builder.ts lib/chat/context-loaders.ts
git commit -m "feat: add complianceGuidance prompt section for compliance checker output"
```

---

### Task 7: Wire Orchestrator

**Files:**
- Modify: `lib/chat/orchestrator.ts`

This is the largest task — it connects all the new components into the 10-step pipeline.

- [ ] **Step 1: Add imports**

At the top of `lib/chat/orchestrator.ts`, add:

```typescript
import { resolveAgent } from './agent-resolver'
import { getActiveSkillPacks, mergeSkillPackSections, computeAllowedTools, flushSkillPackCache } from '@/lib/skills/skill-pack-loader'
import { executeComplianceCheck, type ComplianceCheckResult } from './compliance-checker'
```

- [ ] **Step 2: Extend TurnState**

In the `TurnState` interface, add:

```typescript
interface TurnState {
  // ...existing fields
  conversationMode: string
  activeSkillPacks: string[]
  complianceResult: ComplianceCheckResult | null
}
```

Initialize these in the TurnState creation (where the state object is first constructed):

```typescript
conversationMode: 'SALES',
activeSkillPacks: [],
complianceResult: null,
```

- [ ] **Step 3: Load conversation mode at Step 1**

After the conversation is resolved in Step 1, read the mode:

```typescript
// After conversation is loaded from DB
state.conversationMode = (conversation.mode as string) ?? 'SALES'
state.activeSkillPacks = (conversation.activeSkillPacks as string[]) ?? []
```

- [ ] **Step 4: Add mode transition check between Steps 2 and 3**

After Step 2 (save user message) and before Step 3 (reasoning gate), add:

```typescript
// =============================================
// STEP 2b — Mode transition (from previous turn's gate output)
// =============================================
// Mode transitions from workflow triggers (e.g., payment completed) are
// handled by tool handlers setting conversation.mode directly.
// Gate-triggered transitions are applied here from the previous turn.
```

Note: Gate-triggered transitions apply on the *current* turn's gate output at Step 4 (after the gate runs), not between Steps 2 and 3. The spec places it here but the gate hasn't run yet. We'll apply transitions right after the gate output is processed in Step 4.

- [ ] **Step 5: Extend reasoning gate call in Step 3**

Update the `executeReasoningGate` call to pass new context. Find the existing call site and change it to:

```typescript
// Load available skill packs for gate context
const allSkillPacks = await prisma.skillPack.findMany({
  where: { isActive: true },
  select: { slug: true, description: true },
})

const gateOutput = await executeReasoningGate({
  // ...existing fields
  currentMode: state.conversationMode,
  availableSkillPacks: allSkillPacks,
  activeSkillPacks: state.activeSkillPacks,
})
```

- [ ] **Step 6: Replace hardcoded 'main-chat' in Step 4 (context assembly)**

Replace:
```typescript
const agentConfig = await getAgentConfig('main-chat')
```

With:
```typescript
const agentSlug = resolveAgent(state.conversationMode)
const agentConfig = await getAgentConfig(agentSlug)
```

- [ ] **Step 7: Add skill pack loading and merging in Step 4**

After `loadAllSections` returns and before `buildPrompt` is called, add:

```typescript
// Load skill packs recommended by gate
const recommendedSlugs = gateOutput?.recommendedSkillPacks ?? []
const activePacks = recommendedSlugs.length > 0
  ? await getActiveSkillPacks(recommendedSlugs)
  : []

// Update conversation's active skill packs
state.activeSkillPacks = activePacks.map((p) => p.slug)

// Merge skill pack sections into base sections
const mergedSections = activePacks.length > 0
  ? mergeSkillPackSections(sections, activePacks)
  : sections
```

Then use `mergedSections` instead of `sections` when calling `buildPrompt`.

- [ ] **Step 8: Add mode transition from gate output in Step 4**

After processing the gate output:

```typescript
// Apply gate-triggered mode transition (requires confidence > 0.7)
if (
  gateOutput?.modeTransition &&
  gateOutput.confidence > 0.7 &&
  gateOutput.modeTransition !== state.conversationMode
) {
  state.conversationMode = gateOutput.modeTransition
  await prisma.conversation.update({
    where: { id: state.conversationId },
    data: { mode: gateOutput.modeTransition },
  })
}
```

- [ ] **Step 9: Add conditional compliance check in Step 4b (parallel)**

After the context assembly starts but before `buildPrompt`, add:

```typescript
// Step 4b — Conditional compliance check (parallel with remaining assembly)
let compliancePromise: Promise<ComplianceCheckResult> | null = null
if (gateOutput?.complianceRelevant) {
  compliancePromise = executeComplianceCheck({
    messages: windowMessages,
    workflowStepCode: state.workflowStepCode,
    customerProfile: sections.customerContext
      ? JSON.parse(sections.customerContext)
      : null,
  }).catch(() => ({
    passed: true,
    gaps: [] as string[],
    suggestions: [] as string[],
  }))
}
```

Then after merging sections and before building the prompt:

```typescript
// Await compliance result if running
if (compliancePromise) {
  const complianceResult = await compliancePromise
  state.complianceResult = complianceResult
  if (!complianceResult.passed && complianceResult.gaps.length > 0) {
    const guidanceText = [
      '[COMPLIANCE GUIDANCE - Address before responding]',
      'The following compliance gaps were detected:',
      ...complianceResult.gaps.map((g) => `- ${g}`),
      '',
      'Suggested actions:',
      ...complianceResult.suggestions.map((s) => `- ${s}`),
    ].join('\n')
    mergedSections.complianceGuidance = guidanceText
  }
}
```

- [ ] **Step 10: Replace hardcoded 'main-chat' in Steps 6-8 (gateway.stream)**

Find all instances of `gateway.stream('main-chat', ...)` in the tool loop and response streaming sections. Replace `'main-chat'` with `agentSlug`:

```typescript
// Before (appears ~5 times):
gateway.stream('main-chat', { ... })

// After:
gateway.stream(agentSlug, { ... })
```

- [ ] **Step 11: Update tool scoping in Steps 6-8**

Where tools are computed for the LLM call, replace:

```typescript
// Before:
const tools = getToolsForLLM(stepAllowedTools)

// After:
const effectiveTools = activePacks.length > 0
  ? computeAllowedTools(stepAllowedTools, activePacks)
  : stepAllowedTools
const tools = getToolsForLLM(effectiveTools)
```

- [ ] **Step 12: Update activeSkillPacks on conversation record**

After the turn completes successfully (before Step 10 trace write):

```typescript
// Persist active skill packs on conversation
await prisma.conversation.update({
  where: { id: state.conversationId },
  data: { activeSkillPacks: state.activeSkillPacks },
})
```

- [ ] **Step 13: Extend turn trace in Step 10**

In the TurnTrace write (Prisma create call), add the new fields. Note: this requires adding `activeSkillPacks`, `conversationMode`, and `complianceResult` fields to the TurnTrace model. If TurnTrace uses a `metadata` JSON field, add them there:

```typescript
// Add to turn trace metadata:
metadata: {
  // ...existing metadata
  activeSkillPacks: state.activeSkillPacks,
  conversationMode: state.conversationMode,
  complianceResult: state.complianceResult,
}
```

- [ ] **Step 14: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 15: Commit**

```bash
git add lib/chat/orchestrator.ts
git commit -m "feat: wire skill packs, agent resolution, and compliance check into orchestrator"
```

---

### Task 8: Seed Data

**Files:**
- Modify: `prisma/seeds/seed-agents.ts`
- Create: `prisma/seeds/seed-skill-packs.ts`
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Add compliance-checker to seed-agents.ts**

In the `AGENTS` array in `prisma/seeds/seed-agents.ts`, add:

```typescript
{
  slug: 'compliance-checker',
  name: 'Compliance Checker',
  role: 'compliance-checker',
  provider: 'OPENAI' as const,
  model: 'gpt-5.4-mini',
  fallbackProvider: 'ANTHROPIC' as const,
  fallbackModel: 'claude-haiku-4-5-20251001',
  temperature: 0.1,
  maxTokens: 1024,
  systemPrompt: `You are an insurance compliance evaluator for the Romanian market. You evaluate conversations against IDD (Insurance Distribution Directive) and GDPR requirements.

Evaluate these categories:
1. NEEDS IDENTIFICATION: Has the customer's insurance need been formally identified before any product recommendation?
2. SUITABILITY: Does the recommended product match the customer's stated needs, financial situation, and risk appetite?
3. DISCLOSURE: Has the agent disclosed its role as an AI assistant, the insurer relationship (Allianz-Tiriac), and relevant limitations?
4. INFORMED CONSENT: Has the customer received enough information to make an informed decision?
5. DATA CONSENT: Has GDPR consent been obtained before collecting personal data (name, CNP, address, etc.)?

Respond with JSON only:
{
  "passed": true/false,
  "gaps": ["description of each gap found"],
  "suggestions": ["specific action to address each gap"]
}

If all requirements are met, return { "passed": true, "gaps": [], "suggestions": [] }.
Be strict but fair. Only flag genuine compliance gaps, not stylistic preferences.`,
  constraints: null,
},
```

Also update all existing agents: change `type` to `role` with lowercase slug values:
- `type: 'MAIN_CHAT'` → `role: 'main-chat'`
- `type: 'REASONING_GATE'` → `role: 'reasoning-gate'`
- `type: 'SUMMARIZER'` → `role: 'summarizer'`
- `type: 'PROFILE_EXTRACTOR'` → `role: 'profile-extractor'`

Update the `seedAgents` function to use `role` instead of `type` in both `update` and `create` blocks.

- [ ] **Step 2: Create seed-skill-packs.ts**

```typescript
// prisma/seeds/seed-skill-packs.ts
import type { PrismaClient } from '@/lib/generated/prisma'

const SKILL_PACKS = [
  {
    slug: 'life-insurance-discovery',
    name: 'Life Insurance — Discovery',
    category: 'PRODUCT',
    description: 'Allianz Protect product knowledge and discovery-phase sales strategy for needs identification',
    promptSections: {
      coachingBriefing: `During the discovery phase, focus on understanding the customer's life situation:
- Ask about family composition, dependents, financial obligations
- Understand their current protection level and gaps
- Listen for buying signals: new baby, mortgage, career change
- Don't pitch products yet — build understanding first
- Use open-ended questions in Romanian: "Povestiți-mi despre familia dumneavoastră"`,
    },
    allowedTools: [
      'list_products',
      'get_product_info',
      'get_customer_profile',
      'save_customer_field',
      'get_objection_strategy',
    ],
    constraints: 'During discovery, do not present quotes or specific pricing. Focus on understanding needs.',
    flags: { persuasive: false, empathetic: true },
    priority: 5,
  },
  {
    slug: 'life-insurance-closing',
    name: 'Life Insurance — Closing',
    category: 'WORKFLOW_PHASE',
    description: 'Closing techniques, urgency creation, objection handling, and commitment language',
    promptSections: {
      coachingBriefing: `You are in the closing phase. The customer has seen the quote and is considering.
- Reinforce the value proposition tied to their specific needs
- Address objections with empathy, then redirect to benefits
- Create gentle urgency: "Protecția începe din momentul semnării"
- Ask for commitment directly: "Doriți să continuăm cu această opțiune?"
- If they hesitate, offer to review the options one more time
- Never pressure — guide toward a decision`,
    },
    allowedTools: [
      'list_products',
      'get_product_info',
      'get_customer_profile',
      'get_quote',
      'modify_quote',
      'get_objection_strategy',
      'initiate_payment',
      'start_application',
      'save_application_answer',
    ],
    constraints: 'Be assertive but never aggressive. Respect the customer\'s pace.',
    flags: { persuasive: true, empathetic: true },
    priority: 5,
  },
  {
    slug: 'questionnaire-facilitation',
    name: 'Questionnaire Facilitation',
    category: 'WORKFLOW_PHASE',
    description: 'Generic questionnaire management: interruptions, answer confirmation, resume, progress tracking, sensitivity',
    promptSections: {
      workflowInstructions: `You are facilitating a structured questionnaire. Follow these rules:

INTERRUPTIONS: If the customer asks a question unrelated to the current questionnaire item, answer it naturally, then resume: "Revenind la întrebarea noastră..."

ANSWER CONFIRMATION: If the customer previously mentioned information relevant to the current question (e.g., told you their age during discovery), don't re-ask. Instead confirm: "Mai devreme ați menționat că aveți 35 de ani. Este corect?"

PROGRESS: Periodically indicate progress: "Suntem la întrebarea 12 din 20, mai avem puțin."

SENSITIVITY: For medical or financial questions, soften your tone: "Următoarea întrebare este mai personală, dar este importantă pentru a vă oferi cea mai bună protecție..."

RESUME: If the conversation was paused and resumed, start from the last unanswered question. Don't repeat completed questions.

VALIDATION: If an answer seems inconsistent (e.g., age doesn't match CNP), ask for clarification politely.`,
    },
    allowedTools: [
      'check_dnt_status',
      'start_dnt_questionnaire',
      'save_dnt_answer',
      'sign_dnt',
      'start_application',
      'save_application_answer',
      'get_application_status',
      'check_bd_eligibility',
      'get_customer_profile',
      'save_customer_field',
    ],
    constraints: 'Never skip questions. Never fabricate answers. Always follow the questionnaire order unless conditional logic dictates otherwise.',
    flags: { persuasive: false, empathetic: true },
    priority: 10,
  },
  {
    slug: 'post-sale-onboarding',
    name: 'Post-Sale — Onboarding',
    category: 'POST_SALE',
    description: 'Welcome messaging, document download guidance, policy explanation, next-steps checklist',
    promptSections: {
      agentIdentity: null, // Don't override — keep Zeno persona
      coachingBriefing: `The customer just purchased a policy. Your role is now onboarding support:
- Welcome them warmly: "Felicitări pentru alegerea de a vă proteja familia!"
- Explain what happens next: policy activation timeline, document availability
- Guide them to download their policy documents and DNT report
- Explain key policy terms in simple language
- Provide the customer dashboard link for self-service
- Answer any immediate questions about their coverage
- Tone: warm, reassuring, celebratory — they made a good decision`,
    },
    allowedTools: [
      'get_customer_profile',
      'get_application_status',
      'get_policy_details',
    ],
    constraints: 'Do not upsell or cross-sell during onboarding. Focus entirely on helping them understand their purchase.',
    flags: { persuasive: false, empathetic: true },
    priority: 5,
  },
  {
    slug: 'post-sale-support',
    name: 'Post-Sale — Support',
    category: 'POST_SALE',
    description: 'FAQ handling, policy questions, contact escalation, general help',
    promptSections: {
      coachingBriefing: `You are in customer support mode. The customer has an existing policy and needs help:
- Answer policy questions clearly and accurately
- Help with document access and downloads
- Explain coverage details, exclusions, and terms
- For complex issues (claims, disputes, changes), provide the Allianz-Tiriac contact: 0800 100 888
- For urgent medical issues, remind them of emergency services
- Tone: helpful, patient, professional — they are your valued customer`,
    },
    allowedTools: [
      'get_customer_profile',
      'get_policy_details',
      'get_product_info',
    ],
    constraints: 'Never provide legal or medical advice. For complex policy changes, escalate to human support.',
    flags: { persuasive: false, empathetic: true },
    priority: 5,
  },
  {
    slug: 'post-sale-claims',
    name: 'Post-Sale — Claims',
    category: 'POST_SALE',
    description: 'Claims initiation process, required documentation, timeline expectations, empathetic tone',
    promptSections: {
      coachingBriefing: `The customer needs to initiate or inquire about an insurance claim. This is a sensitive moment:
- Express empathy first: "Îmi pare rău să aud asta. Vă voi ajuta cu procesul de daună."
- Explain the claims process step by step
- List required documentation: medical certificates, police reports, death certificate (if applicable)
- Set realistic timeline expectations: typical processing is 30-45 days
- Provide the claims department contact: claims@allianz-tiriac.ro or 0800 100 888
- For life insurance claims, be especially sensitive and compassionate
- Tone: deeply empathetic, patient, thorough — this may be the hardest moment of their life`,
    },
    allowedTools: [
      'get_customer_profile',
      'get_policy_details',
    ],
    constraints: 'Never rush a claims conversation. Never minimize the customer\'s situation. Always escalate to human claims support for actual claim processing.',
    flags: { persuasive: false, empathetic: true },
    priority: 5,
  },
  {
    slug: 'post-sale-renewal',
    name: 'Post-Sale — Renewal',
    category: 'POST_SALE',
    description: 'Renewal options, coverage review, upgrade/downgrade guidance, retention language',
    promptSections: {
      coachingBriefing: `The customer's policy is up for renewal or they want to discuss coverage changes:
- Review their current coverage and any changes in their life situation
- Present renewal options: same coverage, upgrade, or adjust
- If they want to cancel, understand why before offering alternatives
- Highlight the value they've received and continuity benefits
- For upgrades, explain additional coverage and pricing differences
- Tone: consultative, value-focused — help them make the best decision for their current situation`,
    },
    allowedTools: [
      'get_customer_profile',
      'get_policy_details',
      'list_products',
      'get_product_info',
      'get_quote',
    ],
    constraints: 'For cancellations, always attempt one respectful retention offer. Accept their decision gracefully if they insist.',
    flags: { persuasive: true, empathetic: true },
    priority: 5,
  },
]

export async function seedSkillPacks(prisma: PrismaClient) {
  console.log('  Seeding skill packs...')

  for (const pack of SKILL_PACKS) {
    await prisma.skillPack.upsert({
      where: { slug: pack.slug },
      update: {
        name: pack.name,
        category: pack.category,
        description: pack.description,
        promptSections: pack.promptSections,
        allowedTools: pack.allowedTools,
        constraints: pack.constraints,
        flags: pack.flags,
        priority: pack.priority,
      },
      create: {
        slug: pack.slug,
        name: pack.name,
        category: pack.category,
        description: pack.description,
        promptSections: pack.promptSections,
        allowedTools: pack.allowedTools,
        constraints: pack.constraints,
        flags: pack.flags,
        priority: pack.priority,
      },
    })

    console.log(`    Skill pack "${pack.slug}" (${pack.category}) upserted`)
  }

  console.log(`  ${SKILL_PACKS.length} skill packs seeded.`)
}
```

- [ ] **Step 3: Wire seed-skill-packs into main seed file**

In `prisma/seed.ts`, add:

```typescript
import { seedSkillPacks } from './seeds/seed-skill-packs'
```

And call it after `seedAgents`:

```typescript
await seedSkillPacks(prisma)
```

- [ ] **Step 4: Run seed**

Run:
```bash
npx prisma db seed
```
Expected: All agents (including compliance-checker) and all 7 skill packs seeded successfully.

- [ ] **Step 5: Commit**

```bash
git add prisma/seeds/seed-agents.ts prisma/seeds/seed-skill-packs.ts prisma/seed.ts
git commit -m "feat: seed compliance-checker agent and 7 initial skill packs"
```

---

### Task 9: Admin API Routes for Skill Packs

**Files:**
- Create: `app/api/admin/skill-packs/route.ts`
- Create: `app/api/admin/skill-packs/[id]/route.ts`
- Create: `app/api/admin/skill-packs/[id]/toggle/route.ts`
- Create: `app/api/admin/skill-packs/flush-cache/route.ts`

- [ ] **Step 1: Create GET /api/admin/skill-packs (list)**

```typescript
// app/api/admin/skill-packs/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function GET() {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const skillPacks = await prisma.skillPack.findMany({
    orderBy: [{ category: 'asc' }, { priority: 'desc' }, { name: 'asc' }],
  })

  return NextResponse.json(skillPacks)
}
```

- [ ] **Step 2: Create GET/PUT /api/admin/skill-packs/[id]**

```typescript
// app/api/admin/skill-packs/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { flushSkillPackCache } from '@/lib/skills/skill-pack-loader'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const skillPack = await prisma.skillPack.findUnique({ where: { id } })
  if (!skillPack) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(skillPack)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()

  const updated = await prisma.skillPack.update({
    where: { id },
    data: {
      name: body.name,
      description: body.description,
      promptSections: body.promptSections,
      allowedTools: body.allowedTools,
      constraints: body.constraints,
      flags: body.flags,
      priority: body.priority,
    },
  })

  flushSkillPackCache()

  return NextResponse.json(updated)
}
```

- [ ] **Step 3: Create POST /api/admin/skill-packs/[id]/toggle**

```typescript
// app/api/admin/skill-packs/[id]/toggle/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { flushSkillPackCache } from '@/lib/skills/skill-pack-loader'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const current = await prisma.skillPack.findUnique({
    where: { id },
    select: { isActive: true },
  })
  if (!current) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const updated = await prisma.skillPack.update({
    where: { id },
    data: { isActive: !current.isActive },
  })

  flushSkillPackCache()

  return NextResponse.json(updated)
}
```

- [ ] **Step 4: Create POST /api/admin/skill-packs/flush-cache**

```typescript
// app/api/admin/skill-packs/flush-cache/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'
import { flushSkillPackCache } from '@/lib/skills/skill-pack-loader'

export async function POST() {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  flushSkillPackCache()

  return NextResponse.json({ flushed: true })
}
```

- [ ] **Step 5: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/skill-packs/
git commit -m "feat: add admin API routes for skill pack CRUD and cache management"
```

---

### Task 10: Admin UI — Skill Packs Page

**Files:**
- Create: `app/admin/(protected)/skill-packs/page.tsx`
- Create: `components/admin/skill-pack-table.tsx`
- Create: `components/admin/skill-pack-editor.tsx`
- Modify: Admin sidebar to add skill-packs nav link

- [ ] **Step 1: Create skill-pack-table component**

```typescript
// components/admin/skill-pack-table.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface SkillPackData {
  id: string
  slug: string
  name: string
  category: string
  description: string
  priority: number
  isActive: boolean
}

interface SkillPackTableProps {
  skillPacks: SkillPackData[]
}

const CATEGORY_LABELS: Record<string, string> = {
  PRODUCT: 'Product',
  WORKFLOW_PHASE: 'Workflow Phase',
  POST_SALE: 'Post-Sale',
}

export default function SkillPackTable({ skillPacks }: SkillPackTableProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<string>('ALL')
  const [toggling, setToggling] = useState<string | null>(null)

  const filtered = filter === 'ALL'
    ? skillPacks
    : skillPacks.filter((p) => p.category === filter)

  async function handleToggle(id: string) {
    setToggling(id)
    try {
      await fetch(`/api/admin/skill-packs/${id}/toggle`, { method: 'POST' })
      router.refresh()
    } finally {
      setToggling(null)
    }
  }

  return (
    <div>
      {/* Category filter tabs */}
      <div className="mb-4 flex gap-2">
        {['ALL', 'PRODUCT', 'WORKFLOW_PHASE', 'POST_SALE'].map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === cat
                ? 'bg-zeno-500 text-white'
                : 'bg-cloud-100 text-night-600 hover:bg-cloud-200'
            }`}
          >
            {cat === 'ALL' ? 'All' : CATEGORY_LABELS[cat] ?? cat}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-cloud-200">
        <table className="w-full text-sm">
          <thead className="bg-cloud-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-night-600">Name</th>
              <th className="px-4 py-3 text-left font-medium text-night-600">Slug</th>
              <th className="px-4 py-3 text-left font-medium text-night-600">Category</th>
              <th className="px-4 py-3 text-center font-medium text-night-600">Priority</th>
              <th className="px-4 py-3 text-center font-medium text-night-600">Active</th>
              <th className="px-4 py-3 text-right font-medium text-night-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cloud-100">
            {filtered.map((pack) => (
              <tr key={pack.id} className="hover:bg-cloud-50">
                <td className="px-4 py-3 font-medium text-night">{pack.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-night-500">{pack.slug}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-cloud-100 px-2 py-0.5 text-xs font-medium text-night-600">
                    {CATEGORY_LABELS[pack.category] ?? pack.category}
                  </span>
                </td>
                <td className="px-4 py-3 text-center text-night-500">{pack.priority}</td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => handleToggle(pack.id)}
                    disabled={toggling === pack.id}
                    className={`inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      pack.isActive ? 'bg-zeno-500' : 'bg-cloud-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                        pack.isActive ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => router.push(`/admin/skill-packs?edit=${pack.id}`)}
                    className="text-sm font-medium text-zeno-600 hover:text-zeno-700"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create skill-pack-editor component**

```typescript
// components/admin/skill-pack-editor.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface SkillPackDetail {
  id: string
  slug: string
  name: string
  category: string
  description: string
  promptSections: Record<string, string>
  allowedTools: string[]
  constraints: string | null
  flags: Record<string, boolean> | null
  priority: number
  isActive: boolean
}

interface SkillPackEditorProps {
  skillPack: SkillPackDetail
  allToolNames: string[]
}

export default function SkillPackEditor({ skillPack, allToolNames }: SkillPackEditorProps) {
  const router = useRouter()
  const [name, setName] = useState(skillPack.name)
  const [description, setDescription] = useState(skillPack.description)
  const [promptSections, setPromptSections] = useState<Record<string, string>>(
    skillPack.promptSections ?? {},
  )
  const [allowedTools, setAllowedTools] = useState<Set<string>>(
    new Set(skillPack.allowedTools),
  )
  const [constraints, setConstraints] = useState(skillPack.constraints ?? '')
  const [priority, setPriority] = useState(skillPack.priority)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function updateSection(key: string, value: string) {
    setPromptSections((prev) => ({ ...prev, [key]: value }))
  }

  function removeSection(key: string) {
    setPromptSections((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function toggleTool(tool: string) {
    setAllowedTools((prev) => {
      const next = new Set(prev)
      if (next.has(tool)) next.delete(tool)
      else next.add(tool)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await fetch(`/api/admin/skill-packs/${skillPack.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          promptSections,
          allowedTools: Array.from(allowedTools),
          constraints: constraints || null,
          flags: skillPack.flags,
          priority,
        }),
      })
      setSaved(true)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-cloud-200 bg-white p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-night">{skillPack.name}</h3>
          <p className="font-mono text-xs text-night-400">{skillPack.slug} &middot; {skillPack.category}</p>
        </div>
        <button
          onClick={() => router.push('/admin/skill-packs')}
          className="text-sm text-night-500 hover:text-night-700"
        >
          Back to list
        </button>
      </div>

      {/* Name & Description */}
      <div className="mb-4 grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-night-600">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-cloud-200 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-night-600">Priority</label>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="w-full rounded-md border border-cloud-200 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-night-600">Description</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-md border border-cloud-200 px-3 py-2 text-sm"
        />
      </div>

      {/* Prompt Sections */}
      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium text-night-600">Prompt Sections</label>
        {Object.entries(promptSections).map(([key, value]) => (
          <div key={key} className="mb-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-xs text-night-500">{key}</span>
              <button
                onClick={() => removeSection(key)}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
            <textarea
              value={value}
              onChange={(e) => updateSection(key, e.target.value)}
              rows={4}
              className="w-full rounded-md border border-cloud-200 px-3 py-2 font-mono text-xs"
            />
          </div>
        ))}
      </div>

      {/* Constraints */}
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-night-600">Constraints</label>
        <textarea
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-cloud-200 px-3 py-2 font-mono text-xs"
        />
      </div>

      {/* Allowed Tools */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-night-600">
          Allowed Tools ({allowedTools.size} selected)
        </label>
        <div className="grid grid-cols-3 gap-1">
          {allToolNames.map((tool) => (
            <label key={tool} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-cloud-50">
              <input
                type="checkbox"
                checked={allowedTools.has(tool)}
                onChange={() => toggleTool(tool)}
                className="rounded border-cloud-300"
              />
              <span className="font-mono">{tool}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-zeno-500 px-4 py-2 text-sm font-medium text-white hover:bg-zeno-600 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create skill-packs admin page**

```typescript
// app/admin/(protected)/skill-packs/page.tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { getRegisteredToolNames } from '@/lib/tools/registry'
import SkillPackTable from '@/components/admin/skill-pack-table'
import SkillPackEditor from '@/components/admin/skill-pack-editor'

interface Props {
  searchParams: Promise<{ edit?: string }>
}

export default async function SkillPacksPage({ searchParams }: Props) {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) redirect('/admin/login')
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') redirect('/admin')

  const { edit } = await searchParams

  const skillPacks = await prisma.skillPack.findMany({
    orderBy: [{ category: 'asc' }, { priority: 'desc' }, { name: 'asc' }],
  })

  const serialized = JSON.parse(JSON.stringify(skillPacks))

  // If editing a specific skill pack
  if (edit) {
    const pack = skillPacks.find((p) => p.id === edit)
    if (pack) {
      const allToolNames = getRegisteredToolNames()
      return (
        <div>
          <h2 className="mb-6 text-xl font-medium text-night">Skill Packs</h2>
          <SkillPackEditor
            skillPack={JSON.parse(JSON.stringify(pack))}
            allToolNames={allToolNames}
          />
        </div>
      )
    }
  }

  return (
    <div>
      <h2 className="mb-6 text-xl font-medium text-night">Skill Packs</h2>
      <SkillPackTable skillPacks={serialized} />
    </div>
  )
}
```

Note: `getRegisteredToolNames` needs to be exported from `lib/tools/registry.ts`. Add this function:

```typescript
// In lib/tools/registry.ts, add:
export function getRegisteredToolNames(): string[] {
  return Array.from(definitions.keys()).sort()
}
```

- [ ] **Step 4: Add skill-packs link to admin sidebar**

In `components/admin/admin-sidebar.tsx` (or wherever the navigation is defined), add a new nav item:

```typescript
{ name: 'Skill Packs', href: '/admin/skill-packs', icon: 'puzzle' },
```

Place it after the "Agents" link.

- [ ] **Step 5: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add app/admin/\(protected\)/skill-packs/ components/admin/skill-pack-table.tsx components/admin/skill-pack-editor.tsx components/admin/admin-sidebar.tsx lib/tools/registry.ts
git commit -m "feat: add admin UI for skill pack management"
```

---

### Task 11: Integration Test

**Files:**
- Create: `__tests__/integration/skill-pack-orchestrator.test.ts`

- [ ] **Step 1: Write integration test for skill-pack-aware orchestrator**

```typescript
// __tests__/integration/skill-pack-orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock external dependencies
vi.mock('@/lib/db', () => ({
  prisma: {
    skillPack: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    conversation: {
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/llm/gateway', () => ({
  gateway: {
    call: vi.fn(),
    stream: vi.fn(),
  },
}))

vi.mock('@/lib/llm/agent-config', () => ({
  getAgentConfig: vi.fn(),
}))

import { prisma } from '@/lib/db'
import { gateway } from '@/lib/llm/gateway'
import { getAgentConfig } from '@/lib/llm/agent-config'
import { resolveAgent } from '@/lib/chat/agent-resolver'
import {
  getActiveSkillPacks,
  mergeSkillPackSections,
  computeAllowedTools,
  flushSkillPackCache,
} from '@/lib/skills/skill-pack-loader'
import { executeComplianceCheck } from '@/lib/chat/compliance-checker'

describe('Skill Pack Orchestrator Integration', () => {
  beforeEach(() => {
    flushSkillPackCache()
    vi.clearAllMocks()
  })

  it('resolveAgent returns main-chat for all current modes', () => {
    const modes = ['SALES', 'ONBOARDING', 'SUPPORT', 'CLAIMS', 'RENEWAL']
    for (const mode of modes) {
      expect(resolveAgent(mode)).toBe('main-chat')
    }
  })

  it('skill pack sections merge without overriding constitution', async () => {
    const base = {
      agentIdentity: 'I am Zeno',
      constraints: 'Be helpful',
      capabilityManifest: 'I can help with insurance',
      productContext: 'Generic product',
      coachingBriefing: 'Generic coaching',
    }

    vi.mocked(prisma.skillPack.findMany).mockResolvedValue([
      {
        id: '1',
        slug: 'life-insurance-discovery',
        name: 'Discovery',
        category: 'PRODUCT',
        description: 'test',
        promptSections: {
          productContext: 'Allianz Protect specific info',
          coachingBriefing: 'Discovery phase coaching',
          agentIdentity: 'SHOULD NOT OVERRIDE',
        },
        allowedTools: ['list_products'],
        constraints: 'No pricing in discovery',
        flags: null,
        isActive: true,
        priority: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never)

    const packs = await getActiveSkillPacks(['life-insurance-discovery'])
    const merged = mergeSkillPackSections(base, packs)

    // Constitution preserved
    expect(merged.agentIdentity).toBe('I am Zeno')
    expect(merged.capabilityManifest).toBe('I can help with insurance')

    // Dynamic sections overridden
    expect(merged.productContext).toBe('Allianz Protect specific info')
    expect(merged.coachingBriefing).toBe('Discovery phase coaching')

    // Constraints appended
    expect(merged.constraints).toContain('Be helpful')
    expect(merged.constraints).toContain('No pricing in discovery')
  })

  it('tool scoping intersects workflow tools with pack tools', () => {
    const workflowTools = ['list_products', 'get_product_info', 'start_application', 'initiate_payment']
    const packs = [
      { allowedTools: ['list_products', 'get_product_info'] },
      { allowedTools: ['get_product_info', 'start_application'] },
    ]

    const result = computeAllowedTools(workflowTools, packs)

    expect(result).toContain('list_products')
    expect(result).toContain('get_product_info')
    expect(result).toContain('start_application')
    expect(result).not.toContain('initiate_payment')
  })

  it('compliance checker returns pass on gateway error', async () => {
    vi.mocked(gateway.call).mockRejectedValue(new Error('timeout'))

    const result = await executeComplianceCheck({
      messages: [{ role: 'user', content: 'test' }],
      workflowStepCode: null,
      customerProfile: null,
    })

    expect(result.passed).toBe(true)
    expect(result.gaps).toEqual([])
  })

  it('compliance checker parses valid gap response', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({
        passed: false,
        gaps: ['Needs not identified before recommendation'],
        suggestions: ['Ask about customer needs first'],
      }),
    } as never)

    const result = await executeComplianceCheck({
      messages: [{ role: 'user', content: 'Give me the cheapest plan' }],
      workflowStepCode: 'quote_presentation',
      customerProfile: { age: 35 },
    })

    expect(result.passed).toBe(false)
    expect(result.gaps).toHaveLength(1)
    expect(result.suggestions).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run __tests__/integration/skill-pack-orchestrator.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS (no regressions).

- [ ] **Step 4: Commit**

```bash
git add __tests__/integration/skill-pack-orchestrator.test.ts
git commit -m "test: add integration tests for skill pack orchestrator pipeline"
```

---

### Task 12: Update Reasoning Gate System Prompt

**Files:**
- Modify: `prisma/seeds/seed-agents.ts`

- [ ] **Step 1: Update reasoning gate's system prompt to include skill pack instructions**

In `prisma/seeds/seed-agents.ts`, find the `reasoning-gate` agent's `systemPrompt` and append these instructions:

```
## Skill Pack Selection

Given the customer's message, current workflow step, and conversation context, select which skill packs should be active this turn. Return their slugs in "recommendedSkillPacks".

Available skill packs will be listed in the input under [Available Skill Packs]. Choose based on:
- Always include the relevant PRODUCT pack for the current product context
- Add WORKFLOW_PHASE packs when the conversation is in a specific phase (questionnaire, closing, etc.)
- Add POST_SALE packs when the conversation mode is not SALES

## Mode Detection

If the customer's intent clearly belongs to a different conversation mode, set "modeTransition" to the target mode. Valid modes: SALES, ONBOARDING, SUPPORT, CLAIMS, RENEWAL.

Rules:
- Only recommend transitions with high confidence (you must be > 0.7 confident)
- Never transition during active workflows (questionnaire in progress, payment pending)
- Common signals: returning customer asking about policy → SUPPORT; asking about claim → CLAIMS; policy expiring → RENEWAL

## Compliance Flagging

Set "complianceRelevant" to true when the turn involves:
- Product recommendations or comparisons
- Suitability assessment (matching product to customer needs)
- Health or financial disclosure from customer
- Quote presentation or modification
- Payment initiation
- Policy issuance
Otherwise set it to false.
```

- [ ] **Step 2: Re-run seed**

Run:
```bash
npx prisma db seed
```
Expected: Reasoning gate agent updated with new system prompt.

- [ ] **Step 3: Commit**

```bash
git add prisma/seeds/seed-agents.ts
git commit -m "feat: update reasoning gate system prompt with skill pack and compliance instructions"
```

---

### Task 13: Final Verification

- [ ] **Step 1: Run full test suite**

Run:
```bash
npx vitest run
```
Expected: All tests PASS.

- [ ] **Step 2: Type check**

Run:
```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Build check**

Run:
```bash
npm run build
```
Expected: Build succeeds.

- [ ] **Step 4: Seed verification**

Run:
```bash
npx prisma db seed
```
Expected: 5 agents (including compliance-checker) and 7 skill packs seeded.

- [ ] **Step 5: Final commit (if any remaining changes)**

```bash
git add -A
git commit -m "chore: final verification for agent extensibility sub-project #4"
```
