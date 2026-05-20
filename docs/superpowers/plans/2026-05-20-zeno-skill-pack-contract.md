# Zeno Skill Pack Contract Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Lock skill packs to a tiny, well-defined contribution surface (constraints append, `domainGuidance` prose, tool whitelist) and rewire `loadCoachingBriefing` so playbook content is workflow-step scoped — preventing the un-grounded playbook injection that drove the fake home-insurance questionnaire.

**Architecture:** `PACK_WRITABLE_KEYS` becomes the inversion of the old constitution-keys set — packs can ONLY write `domainGuidance` into prompt sections. Constraints append behavior preserved. Tool merge is union (already done in subsystem D). A new `WorkflowStep.salesPlaybook` field becomes the primary source for coaching content; `Product.defaultPlaybook` remains as a fallback so existing data keeps working. The reasoning gate input drops self-feedback of `[Active Skill Packs]` and gains a current-message-overrides-stored-profile rule.

**Tech Stack:** TypeScript, Next.js 16, Prisma 7, Vitest. Spec: `docs/superpowers/specs/2026-05-20-zeno-skill-pack-contract-design.md`.

---

## File Structure

**Create:**
- `prisma/migrations/<timestamp>_add-workflowstep-sales-playbook/migration.sql` — adds `salesPlaybook` to `WorkflowStep`.
- `__tests__/lib/skills/pack-contract.test.ts` — unit tests for `mergeSkillPackSections` rejection behavior and `validatePackPromptSections`.

**Modify:**
- `prisma/schema.prisma:373-393` — add `salesPlaybook` to `WorkflowStep`.
- `lib/skills/skill-pack-loader.ts` — replace `CONSTITUTION_KEYS` with `PACK_WRITABLE_KEYS`, invert the check, export `validatePackPromptSections`.
- `lib/chat/context-loaders.ts:302-316` — extend `loadCoachingBriefing` signature to accept `workflowStepCode`; prefer `WorkflowStep.salesPlaybook` over `Product.defaultPlaybook`.
- `lib/chat/context-loaders.ts:840` — pass `workflowStepCode` to `loadCoachingBriefing` in `loadAllSections`.
- `lib/chat/prompt-builder.ts` — add `domainGuidance: string | null` to `PromptSections`, add SECTION_REGISTRY entry at priority 6.
- `__tests__/lib/chat/prompt-builder.test.ts` — extend `makeSections` with `domainGuidance: null`.
- `lib/chat/reasoning-gate.ts:160-162` — remove the `[Active Skill Packs]` block from gate input.
- `lib/chat/reasoning-gate.ts` — locate the gate system prompt template and append the current-message-overrides-stored-profile rule.
- `__tests__/lib/skills/skill-pack-loader.test.ts` — adjust merge tests for the new contract; existing constitution-keys test becomes a packwritable-keys test.

**Run after merging:**
- `npx tsx scripts/reseed-agents.ts` (if the reasoning-gate agent's system prompt is changed via seeds — verify in Task 7).

---

## Task 1: Schema — add salesPlaybook to WorkflowStep

**Files:**
- Modify: `prisma/schema.prisma:373-393`
- Create: `prisma/migrations/20260520000001_add-workflowstep-sales-playbook/migration.sql`

- [x] **Step 1: Edit schema**

In `prisma/schema.prisma`, find `model WorkflowStep` (line 373). Add the new field after `agentInstructions`:

```prisma
model WorkflowStep {
  id                String   @id @default(cuid())
  workflowId        String
  code              String
  name              String
  type              String
  orderIndex        Int
  autoTool          String?
  allowedTools      String[]
  agentInstructions String?  @db.Text
  salesPlaybook     String?  @db.Text
  uiAction          String?
  // ... rest unchanged
}
```

- [x] **Step 2: Create the migration file**

Run: `mkdir -p prisma/migrations/20260520000001_add-workflowstep-sales-playbook`

Create `prisma/migrations/20260520000001_add-workflowstep-sales-playbook/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "WorkflowStep" ADD COLUMN "salesPlaybook" TEXT;
```

- [x] **Step 3: Apply the migration via direct SQL (shadow DB workaround)**

Create `scripts/apply-workflowstep-playbook-migration.ts`:

```ts
import { config } from 'dotenv'
config()
import { PrismaClient } from '../lib/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  const prisma = new PrismaClient({ adapter })
  try {
    const existing = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'WorkflowStep' AND column_name = 'salesPlaybook'`,
    )
    if (existing.length === 0) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "WorkflowStep" ADD COLUMN "salesPlaybook" TEXT`)
      console.log('added WorkflowStep.salesPlaybook')
    } else {
      console.log('salesPlaybook already exists')
    }

    const existingMigration = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = '20260520000001_add-workflowstep-sales-playbook'`,
    )
    if (existingMigration.length === 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (gen_random_uuid()::text, '', NOW(), '20260520000001_add-workflowstep-sales-playbook', NULL, NULL, NOW(), 1)`,
      )
      console.log('recorded migration')
    } else {
      console.log('migration already recorded')
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
```

Run: `npx tsx scripts/apply-workflowstep-playbook-migration.ts`
Expected: `added WorkflowStep.salesPlaybook` then `recorded migration`.

- [x] **Step 4: Regenerate Prisma client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`.

- [x] **Step 5: Clean up the one-off script**

Run: `rm scripts/apply-workflowstep-playbook-migration.ts`

- [x] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260520000001_add-workflowstep-sales-playbook/
git commit -m "feat(schema): add WorkflowStep.salesPlaybook field

Step-scoped coaching content for use by loadCoachingBriefing. Takes
precedence over the existing product-level defaultPlaybook fallback
so playbook content is tied to active workflow state."
```

---

## Task 2: Rewire loadCoachingBriefing to prefer WorkflowStep.salesPlaybook

**Files:**
- Modify: `lib/chat/context-loaders.ts:302-316, 840`
- Modify: `__tests__/lib/chat/context-loaders.test.ts` (find existing `loadCoachingBriefing` tests if any) or create a new test file

- [x] **Step 1: Write the failing test**

Create `__tests__/lib/chat/coaching-briefing.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    workflowStep: { findFirst: vi.fn() },
    product: { findUnique: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { loadCoachingBriefing, flushCoachingBriefingCache } from '@/lib/chat/context-loaders'

describe('loadCoachingBriefing (subsystem B)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flushCoachingBriefingCache()
  })

  it('returns WorkflowStep.salesPlaybook when workflowStepCode is provided and step has playbook', async () => {
    vi.mocked(prisma.workflowStep.findFirst).mockResolvedValue({ salesPlaybook: 'Step playbook content' } as never)

    const result = await loadCoachingBriefing('prod-1', 'dnt_questionnaire')

    expect(result).toBe('Step playbook content')
    expect(prisma.workflowStep.findFirst).toHaveBeenCalled()
    expect(prisma.product.findUnique).not.toHaveBeenCalled()
  })

  it('falls back to Product.defaultPlaybook when workflowStepCode is null', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ defaultPlaybook: 'Product playbook' } as never)

    const result = await loadCoachingBriefing('prod-1', null)

    expect(result).toBe('Product playbook')
    expect(prisma.product.findUnique).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      select: { defaultPlaybook: true },
    })
  })

  it('falls back to Product.defaultPlaybook when WorkflowStep has no salesPlaybook', async () => {
    vi.mocked(prisma.workflowStep.findFirst).mockResolvedValue({ salesPlaybook: null } as never)
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ defaultPlaybook: 'Product fallback' } as never)

    const result = await loadCoachingBriefing('prod-1', 'dnt_questionnaire')

    expect(result).toBe('Product fallback')
  })

  it('returns null when neither WorkflowStep nor Product has playbook', async () => {
    vi.mocked(prisma.workflowStep.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ defaultPlaybook: null } as never)

    const result = await loadCoachingBriefing('prod-1', 'dnt_questionnaire')

    expect(result).toBeNull()
  })

  it('returns null when productId is null and workflowStepCode is null', async () => {
    const result = await loadCoachingBriefing(null, null)
    expect(result).toBeNull()
    expect(prisma.workflowStep.findFirst).not.toHaveBeenCalled()
    expect(prisma.product.findUnique).not.toHaveBeenCalled()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/lib/chat/coaching-briefing.test.ts`
Expected: FAIL — `flushCoachingBriefingCache` not exported / signature mismatch.

- [x] **Step 3: Rewrite loadCoachingBriefing**

In `lib/chat/context-loaders.ts`, find the existing `loadCoachingBriefing` declaration (line 302). Locate the matching cache constant (search for `coachingBriefingCache`) and verify it exists. Replace the function:

```ts
/**
 * Load coaching briefing section.
 *
 * Prefers WorkflowStep.salesPlaybook when a workflow step is active (subsystem
 * B). Falls back to Product.defaultPlaybook when no workflow is active OR when
 * the active step has no playbook. Returns null when neither source provides
 * content — including the case where productId is null.
 *
 * Cache key includes both inputs because the same product can be hit with
 * different workflow steps in the same conversation.
 */
export async function loadCoachingBriefing(
  productId: string | null,
  workflowStepCode: string | null,
): Promise<string | null> {
  const cacheKey = `${productId ?? 'null'}:${workflowStepCode ?? 'null'}`
  const cached = coachingBriefingCache.get(cacheKey)
  if (cached !== undefined) return cached

  // Prefer WorkflowStep.salesPlaybook
  if (workflowStepCode) {
    const step = await prisma.workflowStep.findFirst({
      where: { code: workflowStepCode },
      select: { salesPlaybook: true },
    })
    if (step?.salesPlaybook) {
      coachingBriefingCache.set(cacheKey, step.salesPlaybook)
      return step.salesPlaybook
    }
  }

  // Fallback: Product.defaultPlaybook
  if (productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { defaultPlaybook: true },
    })
    const result = product?.defaultPlaybook ?? null
    coachingBriefingCache.set(cacheKey, result)
    return result
  }

  coachingBriefingCache.set(cacheKey, null)
  return null
}

/**
 * Test-only: flush the cache so unit tests don't bleed between specs.
 */
export function flushCoachingBriefingCache(): void {
  coachingBriefingCache.clear()
}
```

The existing `coachingBriefingCache` is declared near the top of the file (look for `coachingBriefingCache`). It is an LRUCache. If the cache's existing key is `productId` only (string keys), the new composite cache key (`productId:workflowStepCode`) is fully compatible — no migration of the cache structure needed.

- [x] **Step 4: Update loadAllSections to pass workflowStepCode**

In `lib/chat/context-loaders.ts:840`, change the call site:

```ts
    productId || workflowStepCode ? loadCoachingBriefing(productId, workflowStepCode) : null,
```

The `||` guard ensures we don't make an unnecessary call when neither input is present.

- [x] **Step 5: Run the test to verify it passes**

Run: `npm test -- __tests__/lib/chat/coaching-briefing.test.ts`
Expected: PASS — 5 tests pass.

- [x] **Step 6: Run the broader context-loaders tests**

Run: `npm test -- __tests__/lib/chat/context-loaders`
Expected: PASS — all context-loaders tests still pass.

- [x] **Step 7: Commit**

```bash
git add lib/chat/context-loaders.ts __tests__/lib/chat/coaching-briefing.test.ts
git commit -m "feat(chat): loadCoachingBriefing prefers WorkflowStep.salesPlaybook

Coaching content is now sourced from the active workflow step first;
Product.defaultPlaybook is the fallback when no step is active or the
step has no playbook. Aligns with subsystem B's 'playbook tied to
workflow state' design."
```

---

## Task 3: PACK_WRITABLE_KEYS + invert mergeSkillPackSections

**Files:**
- Modify: `lib/skills/skill-pack-loader.ts:24-120`
- Modify: `__tests__/lib/skills/skill-pack-loader.test.ts` (find merge tests)
- Modify: `__tests__/integration/skill-pack-orchestrator.test.ts:75-120`

- [x] **Step 1: Replace CONSTITUTION_KEYS with PACK_WRITABLE_KEYS**

In `lib/skills/skill-pack-loader.ts`, find the `CONSTITUTION_KEYS` declaration (line 28). Replace with:

```ts
// ============================================================
// PACK_WRITABLE_KEYS — packs may ONLY write keys in this set
// ============================================================
// Inverted from the old CONSTITUTION_KEYS approach: instead of listing
// what packs cannot write, list what they CAN. Anything else is reserved
// for system loaders backed by real DB state. See
// docs/superpowers/specs/2026-05-20-zeno-skill-pack-contract-design.md.
export const PACK_WRITABLE_KEYS = new Set(['domainGuidance'])
```

- [x] **Step 2: Add an import for logWarn at the top of the file**

```ts
import { logWarn } from '@/lib/errors/logger'
```

(if not already imported)

- [x] **Step 3: Rewrite mergeSkillPackSections to invert the check**

Replace the existing `mergeSkillPackSections` function (lines 83-120) with:

```ts
// ============================================================
// mergeSkillPackSections
// ============================================================

/**
 * Merge skill pack contributions into the base prompt sections.
 *
 * Packs can ONLY write keys listed in PACK_WRITABLE_KEYS. Any other key
 * appearing in a pack's promptSections is logged as a warning and
 * ignored (defense-in-depth: pack rows from before the contract change
 * are stripped at load time instead of leaking into the prompt).
 *
 * Pack constraints are appended to the base constraints (preserved
 * behavior). Higher-priority packs claim a writable key first.
 */
export function mergeSkillPackSections(
  baseSections: Record<string, string | null>,
  packs: SkillPack[],
): Record<string, string | null> {
  if (packs.length === 0) return baseSections

  const merged: Record<string, string | null> = { ...baseSections }
  const claimed = new Set<string>()
  const packConstraints: string[] = []

  for (const pack of packs) {
    for (const [key, value] of Object.entries(pack.promptSections ?? {})) {
      if (!PACK_WRITABLE_KEYS.has(key)) {
        logWarn({
          layer: 'orchestrator',
          category: 'skillpack_section_rejected',
          message: `skill pack '${pack.slug}' attempted to write reserved key '${key}' — ignored`,
          context: { packSlug: pack.slug, key },
        })
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

- [x] **Step 4: Add validatePackPromptSections export**

Append to `lib/skills/skill-pack-loader.ts`:

```ts
// ============================================================
// validatePackPromptSections — for save-time validation
// ============================================================

/**
 * Returns { valid, invalidKeys } for a candidate pack's promptSections.
 * Used by the admin endpoint that creates/updates pack rows.
 */
export function validatePackPromptSections(
  sections: Record<string, unknown>,
): { valid: boolean; invalidKeys: string[] } {
  const invalidKeys = Object.keys(sections).filter((k) => !PACK_WRITABLE_KEYS.has(k))
  return { valid: invalidKeys.length === 0, invalidKeys }
}
```

- [x] **Step 5: Write tests for the new contract**

Create `__tests__/lib/skills/pack-contract.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/errors/logger', () => ({
  logWarn: vi.fn(),
}))

import {
  PACK_WRITABLE_KEYS,
  mergeSkillPackSections,
  validatePackPromptSections,
} from '@/lib/skills/skill-pack-loader'
import { logWarn } from '@/lib/errors/logger'

function pack(overrides: any = {}) {
  return {
    id: 'p',
    slug: 'pack-x',
    name: 'X',
    category: 'PRODUCT',
    description: '',
    promptSections: {},
    allowedTools: [],
    constraints: null,
    flags: null,
    isActive: true,
    priority: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('PACK_WRITABLE_KEYS', () => {
  it('contains only domainGuidance', () => {
    expect(Array.from(PACK_WRITABLE_KEYS)).toEqual(['domainGuidance'])
  })
})

describe('mergeSkillPackSections (new contract)', () => {
  beforeEach: vi.clearAllMocks

  it('accepts and merges domainGuidance from a pack', () => {
    const base = { domainGuidance: null } as Record<string, string | null>
    const result = mergeSkillPackSections(base, [pack({ promptSections: { domainGuidance: 'Be warm.' } })] as any)
    expect(result.domainGuidance).toBe('Be warm.')
  })

  it('rejects coachingBriefing injection by a pack', () => {
    const base = { coachingBriefing: 'base coaching' } as Record<string, string | null>
    const result = mergeSkillPackSections(base, [pack({ promptSections: { coachingBriefing: 'INJECTED' } })] as any)
    expect(result.coachingBriefing).toBe('base coaching')
    expect(logWarn).toHaveBeenCalledWith(expect.objectContaining({
      category: 'skillpack_section_rejected',
    }))
  })

  it('rejects workflowInstructions injection by a pack', () => {
    const base = { workflowInstructions: null } as Record<string, string | null>
    const result = mergeSkillPackSections(base, [pack({ promptSections: { workflowInstructions: 'FAKE WORKFLOW' } })] as any)
    expect(result.workflowInstructions).toBeNull()
    expect(logWarn).toHaveBeenCalled()
  })

  it('rejects productContext injection by a pack', () => {
    const base = { productContext: null } as Record<string, string | null>
    const result = mergeSkillPackSections(base, [pack({ promptSections: { productContext: 'FAKE PRODUCT' } })] as any)
    expect(result.productContext).toBeNull()
    expect(logWarn).toHaveBeenCalled()
  })

  it('appends pack constraints to base constraints', () => {
    const base = { constraints: 'base rule' } as Record<string, string | null>
    const result = mergeSkillPackSections(base, [pack({ constraints: 'pack rule' })] as any)
    expect(result.constraints).toBe('base rule\npack rule')
  })

  it('first-pack-wins on conflicting domainGuidance', () => {
    const base = { domainGuidance: null } as Record<string, string | null>
    const result = mergeSkillPackSections(base, [
      pack({ slug: 'a', priority: 20, promptSections: { domainGuidance: 'A wins' } }),
      pack({ slug: 'b', priority: 10, promptSections: { domainGuidance: 'B loses' } }),
    ] as any)
    expect(result.domainGuidance).toBe('A wins')
  })
})

describe('validatePackPromptSections', () => {
  it('valid when only domainGuidance is present', () => {
    expect(validatePackPromptSections({ domainGuidance: 'x' })).toEqual({ valid: true, invalidKeys: [] })
  })

  it('invalid when reserved keys are present', () => {
    const result = validatePackPromptSections({ coachingBriefing: 'x', productContext: 'y' })
    expect(result.valid).toBe(false)
    expect(result.invalidKeys).toEqual(expect.arrayContaining(['coachingBriefing', 'productContext']))
  })

  it('valid when sections is empty', () => {
    expect(validatePackPromptSections({})).toEqual({ valid: true, invalidKeys: [] })
  })
})
```

Note: the `beforeEach: vi.clearAllMocks` shorthand above is intentional — Vitest accepts `beforeEach(vi.clearAllMocks)` as a hook. Adjust to `beforeEach(() => vi.clearAllMocks())` if the linter complains.

- [x] **Step 6: Run the new test file**

Run: `npm test -- __tests__/lib/skills/pack-contract.test.ts`
Expected: PASS — all tests pass.

- [x] **Step 7: Update existing skill-pack-loader tests for the new contract**

In `__tests__/lib/skills/skill-pack-loader.test.ts`, find any tests that assert pack-injected coachingBriefing or productContext succeed. Those expectations are now inverted — the pack write is rejected with a warning. Adapt those tests. In particular, the existing `makeSkillPack` helper at the top of the file has a fixture `promptSections: { productContext: 'Protect Standard I content', coachingBriefing: 'Focus on value' }`. Change to `promptSections: { domainGuidance: 'Focus on value' }` to keep fixtures consistent with the new contract.

Run: `npm test -- __tests__/lib/skills/skill-pack-loader.test.ts`
Iterate until PASS.

- [x] **Step 8: Update integration test for the new contract**

In `__tests__/integration/skill-pack-orchestrator.test.ts`, find the `describe('mergeSkillPackSections — constitution keys are never overridden', ...)` block (around line 75). Update its body and title to reflect the new "pack-writable keys" semantic:

- Title: `'mergeSkillPackSections — only PACK_WRITABLE_KEYS allowed'`
- The test that asserted constitution keys survive injection now asserts the same for ALL reserved keys (productContext, coachingBriefing, etc.), AND that the pack-writable key (domainGuidance) merges normally.

Run: `npm test -- __tests__/integration/skill-pack-orchestrator.test.ts`
Iterate until PASS.

- [x] **Step 9: Commit**

```bash
git add lib/skills/skill-pack-loader.ts __tests__/lib/skills/skill-pack-loader.test.ts __tests__/lib/skills/pack-contract.test.ts __tests__/integration/skill-pack-orchestrator.test.ts
git commit -m "feat(skills): invert pack contract — PACK_WRITABLE_KEYS = {domainGuidance}

Skill packs can no longer overwrite state-bearing prompt sections.
Packs may only contribute: appended constraints, allowed tools,
and a single 'domainGuidance' prose section. Reserved-key writes
are logged as warnings and ignored. validatePackPromptSections
exported for save-time validation."
```

---

## Task 4: domainGuidance section in PromptSections + registry

**Files:**
- Modify: `lib/chat/prompt-builder.ts:24-37, 67-83`
- Modify: `__tests__/lib/chat/prompt-builder.test.ts:14-32`

- [x] **Step 1: Write the failing test**

Append to `__tests__/lib/chat/prompt-builder.test.ts`:

```ts
describe('domainGuidance section (subsystem B)', () => {
  it('renders the section when populated', () => {
    const sections = makeSections({
      domainGuidance: 'Prefer warmth in life-insurance conversations.',
    })
    const result = buildPrompt(sections, NO_GATE)

    expect(result.prompt).toContain('=== DOMAIN GUIDANCE ===')
    expect(result.prompt).toContain('Prefer warmth in life-insurance conversations.')
  })

  it('appears after coachingBriefing in the stable layer', () => {
    const sections = makeSections({
      coachingBriefing: 'COACH BLOCK',
      domainGuidance: 'DOMAIN BLOCK',
    })
    const result = buildPrompt(sections, NO_GATE)

    expect(result.prompt.indexOf('COACH BLOCK')).toBeLessThan(result.prompt.indexOf('DOMAIN BLOCK'))
  })
})
```

- [x] **Step 2: Update makeSections to include domainGuidance**

In `__tests__/lib/chat/prompt-builder.test.ts`, find `makeSections` and add `domainGuidance: null` after `coachingBriefing: ...`:

```ts
    coachingBriefing: 'Focus on value, not price.',
    domainGuidance: null,
```

- [x] **Step 3: Run test — expect fail (PromptSections type doesn't include domainGuidance)**

Run: `npm test -- __tests__/lib/chat/prompt-builder.test.ts -t "domainGuidance"`
Expected: FAIL — type error / missing section.

- [x] **Step 4: Extend PromptSections**

In `lib/chat/prompt-builder.ts`, add `domainGuidance` after `coachingBriefing` in the interface:

```ts
export interface PromptSections {
  agentIdentity: string | null
  capabilityManifest: string | null
  constraints: string | null
  stateGrounding: string | null
  complianceGuidance: string | null
  situationalBriefing: string | null
  customerMemory: string | null
  agentKnowledge: string | null
  customerContext: string | null
  coachingBriefing: string | null
  domainGuidance: string | null
  workflowInstructions: string | null
  questionnaireContext: string | null
  productContext: string | null
}
```

- [x] **Step 5: Add SECTION_REGISTRY entry**

In `lib/chat/prompt-builder.ts`, find `SECTION_REGISTRY` (line 67). Insert the new entry after `coachingBriefing` (priority 5):

```ts
const SECTION_REGISTRY: SectionConfig[] = [
  // ... constitution layer entries unchanged ...
  { key: 'coachingBriefing',    priority: 5,  layer: 'stable',      alwaysInclude: false, prefix: '=== PRODUCT SALES PLAYBOOK ===' },
  { key: 'domainGuidance',      priority: 6,  layer: 'stable',      alwaysInclude: false, prefix: '=== DOMAIN GUIDANCE ===' },
  // ... dynamic suffix unchanged ...
]
```

- [x] **Step 6: Update loadAllSections to include domainGuidance in return**

In `lib/chat/context-loaders.ts`, find the return object in `loadAllSections` and add `domainGuidance: null,` — packs supply this via merge after the fact:

```ts
  return {
    agentIdentity,
    capabilityManifest,
    constraints,
    stateGrounding,
    complianceGuidance: null,
    situationalBriefing,
    customerMemory,
    agentKnowledge,
    customerContext,
    coachingBriefing,
    domainGuidance: null,
    workflowInstructions,
    questionnaireContext,
    productContext,
  }
```

Also update the minimal fallback object in `orchestrator.ts` (the same place we added `stateGrounding: loadStateGrounding(...)`):

```ts
      sections = {
        agentIdentity: agentConfig.systemPrompt,
        capabilityManifest: null,
        constraints: agentConfig.constraints,
        stateGrounding: loadStateGrounding(fallbackStateGroundingInput),
        complianceGuidance: null,
        situationalBriefing: null,
        customerMemory: null,
        agentKnowledge: null,
        customerContext: null,
        coachingBriefing: null,
        domainGuidance: null,
        workflowInstructions: null,
        questionnaireContext: null,
        productContext: null,
      }
```

- [x] **Step 7: Run prompt-builder + context-loaders tests**

Run: `npm test -- __tests__/lib/chat/prompt-builder.test.ts`
Expected: PASS — all tests including the new domainGuidance ones.

Run: `npm test -- __tests__/lib/chat/`
Expected: PASS — no regressions.

- [x] **Step 8: Commit**

```bash
git add lib/chat/prompt-builder.ts lib/chat/context-loaders.ts lib/chat/orchestrator.ts __tests__/lib/chat/prompt-builder.test.ts
git commit -m "feat(prompt): add domainGuidance section at priority 6

domainGuidance is the single prose section that skill packs are allowed
to contribute (per the new pack contract). Renders below coachingBriefing
in the stable layer."
```

---

## Task 5: Reasoning gate — remove [Active Skill Packs] self-feedback

**Files:**
- Modify: `lib/chat/reasoning-gate.ts:155-170`
- Modify: `__tests__/lib/chat/reasoning-gate.test.ts` (find the test that exercises buildGateContextMessage)

- [x] **Step 1: Write the failing test**

Open `__tests__/lib/chat/reasoning-gate.test.ts`. Find the existing test that asserts the gate input includes `[Active Skill Packs]` (if any). Add a new test:

```ts
describe('buildGateContextMessage — subsystem B (no active-pack self-feedback)', () => {
  it('does NOT include the [Active Skill Packs] line in the context message', () => {
    const input = {
      lastUserMessage: 'vreau o asigurare pentru locuinta',
      last3Messages: [],
      hasActiveQuestionnaire: false,
      currentQuestionText: null,
      workflowStepCode: null,
      availableTools: ['list_products'],
      customerProfile: { name: null, age: null, family: null, occupation: null, isReturningCustomer: false },
      businessState: { selectedProduct: null, dntProgress: null, applicationProgress: null, hasQuote: false, quoteValue: null, hasPolicy: false },
      currentMode: 'SALES',
      availableSkillPacks: [{ slug: 'life-insurance-discovery', description: 'Life insurance' }],
      activeSkillPacks: ['life-insurance-discovery'],
    } as any

    const message = buildGateContextMessage(input)

    expect(message).not.toContain('[Active Skill Packs]')
    expect(message).not.toContain('life-insurance-discovery,')
    // [Available Skill Packs] is still expected (gate needs to know what it can recommend)
    expect(message).toContain('[Available Skill Packs]')
  })
})
```

(`buildGateContextMessage` may already be exported; if not, export it.)

- [x] **Step 2: Run test — expect fail**

Run: `npm test -- __tests__/lib/chat/reasoning-gate.test.ts -t "no active-pack self-feedback"`
Expected: FAIL — current implementation includes `[Active Skill Packs]`.

- [x] **Step 3: Remove the active-packs block from gate input**

In `lib/chat/reasoning-gate.ts:160-162`, delete the three lines:

```ts
  if (input.activeSkillPacks && input.activeSkillPacks.length > 0) {
    parts.push(`[Active Skill Packs] ${input.activeSkillPacks.join(', ')}`)
  }
```

The `availableSkillPacks` block (lines 164-170) stays intact — the gate still needs to know what packs it can recommend.

- [x] **Step 4: Run the test**

Run: `npm test -- __tests__/lib/chat/reasoning-gate.test.ts -t "no active-pack self-feedback"`
Expected: PASS.

- [x] **Step 5: Run the full reasoning-gate test file**

Run: `npm test -- __tests__/lib/chat/reasoning-gate.test.ts`
Expected: PASS — adjust any pre-existing assertions that required the `[Active Skill Packs]` line until all pass.

- [x] **Step 6: Commit**

```bash
git add lib/chat/reasoning-gate.ts __tests__/lib/chat/reasoning-gate.test.ts
git commit -m "fix(gate): remove [Active Skill Packs] self-feedback from gate input

Gate no longer receives its own previous recommendations, eliminating
the self-reinforcement loop that kept life-insurance-discovery active
across an explicit product-category pivot. [Available Skill Packs]
listing remains so the gate still knows what it can recommend."
```

---

## Task 6: Reasoning gate prompt — current-message-overrides-stored-profile rule

**Files:**
- Modify: `prisma/seeds/seed-agents.ts` — locate the `reasoning-gate` agent's `systemPrompt` value (search for `REASONING_GATE_PROMPT`)

- [x] **Step 1: Find where REASONING_GATE_PROMPT is defined**

Run: `grep -n "REASONING_GATE_PROMPT" prisma/seeds/seed-agents.ts`
Expected: at least one location where the constant is declared (a multi-line string at the top of the file). Read that block.

- [x] **Step 2: Append the weighting rule to the prompt**

Edit the `REASONING_GATE_PROMPT` constant in `prisma/seeds/seed-agents.ts`. At the end of the prompt body (just before the closing backtick), append:

```
\n\nIMPORTANT — current-message priority:
When the customer's current message names a product category different from their stored \`extractedProfile.interests\`, the current message overrides the stored interests. Never recommend a skill pack for a product category the customer is not currently asking about.
```

(The exact text should be added as the LAST paragraph of the prompt so it has recency priority.)

- [x] **Step 3: Write a test asserting the rule is present**

Add to `__tests__/prisma/seeds/main-chat-constraints.test.ts` (or create a new `reasoning-gate-prompt.test.ts` if preferred):

```ts
it('reasoning-gate system prompt contains the current-message-priority rule', () => {
  const gate = AGENTS.find((a) => a.slug === 'reasoning-gate')
  expect(gate).toBeDefined()
  expect(gate?.systemPrompt).toMatch(/current message overrides the stored interests/i)
})
```

- [x] **Step 4: Run the test**

Run: `npm test -- __tests__/prisma/seeds/main-chat-constraints.test.ts`
Expected: PASS — all tests pass.

- [x] **Step 5: Reseed the DB**

Run: `npx tsx scripts/reseed-agents.ts`
Expected: console output confirming reasoning-gate agent upserted.

- [x] **Step 6: Commit**

```bash
git add prisma/seeds/seed-agents.ts __tests__/prisma/seeds/main-chat-constraints.test.ts
git commit -m "feat(gate): current-message priority rule in reasoning-gate prompt

Gate is now instructed that the customer's current message overrides
stored extractedProfile.interests when they name different product
categories. Closes the profile-bias half of subsystem B's gate fixes."
```

---

## Task 7: Full test sweep + mark plan complete

- [x] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — full suite passes with no regressions from this plan.

- [x] **Step 2: Mark all checkboxes in this file as completed**

Replace every `- [x]` with `- [x]` in this file.

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-05-20-zeno-skill-pack-contract.md
git commit -m "docs(plans): mark subsystem B plan complete"
```
