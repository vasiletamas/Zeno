# Zeno Product-Derived Advance Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Zeno stalling after product-convergence by retiring the redundant `set_conversation_product` tool, making question-group selection product-derived (via a new `QuestionGroup.phase`), repairing DNT signing (off the dead workflow session), and driving the `converge → DNT → sign → application → quote` sequence from the prompt.

**Architecture:** Add `QuestionGroup.phase` + `Conversation.dntSignedAt/dntValidUntil`. A new `lib/engines/question-groups.ts` resolver returns group codes by `(phase, product-or-global)`, replacing the hardcoded `DNT_GROUP_CODES` / `APPLICATION_GROUP_CODES`. DNT and application handlers consume the resolver; `sign_dnt` persists to `Conversation`; `start_application` gates on `Conversation.dntSignedAt`. `set_conversation_product` is removed everywhere; the prompt is rewritten to drive the sequence with one readiness question.

**Tech Stack:** Next.js / TypeScript / Prisma (PostgreSQL, generated client at `lib/generated/prisma`) / Vitest. Spec: `docs/superpowers/specs/2026-05-28-zeno-product-derived-advance-flow-design.md`.

---

## File Structure

**New:**
- `lib/engines/question-groups.ts` — `resolveGroupCodes(productId, phase)` (pure DB read) + `resolveActiveProductId(conversationId, knownProductId?)`. Single source of truth for "which groups for this product/phase".
- `__tests__/lib/engines/question-groups.test.ts` — resolver unit tests.

**Modified:**
- `prisma/schema.prisma` — `QuestionGroup.phase`, `Conversation.dntSignedAt/dntValidUntil`.
- `prisma/seeds/seed-questions.ts` — `seedGroup` accepts `phase`; every group tagged.
- `lib/tools/handlers/dnt-handlers.ts` — resolver-driven groups; `sign_dnt` persists to `Conversation`.
- `lib/tools/handlers/application-handlers.ts` — resolver-driven groups; DNT gate from `Conversation`; drop `isBdStep`.
- `lib/tools/registry.ts`, `lib/tools/handlers/product-handlers.ts`, `lib/chat/default-tools.ts`, `lib/tools/validation.ts`, `lib/tools/pipeline.ts`, `lib/chat/action-adapter.ts` — remove `set_conversation_product`.
- `prisma/seeds/seed-agents.ts` — remove confirm-Protect constraint; add advance-sequence prompt section.
- `prisma/seeds/seed-workflows.ts` — remove dead auto-advance text + tool reference.
- `prisma/seeds/seed-skill-packs.ts` — align closing pack to the readiness-then-drive flow.
- Tests listed per task.

---

### Task 1: Schema — `QuestionGroup.phase` + `Conversation` DNT columns

**Files:**
- Modify: `prisma/schema.prisma:430-442` (QuestionGroup), `prisma/schema.prisma:300-331` (Conversation)
- Create: `prisma/migrations/<timestamp>_add-group-phase-and-dnt-columns/migration.sql`

- [ ] **Step 1.1: Edit `QuestionGroup` — add `phase`**

In `prisma/schema.prisma`, add `phase` after `productId`:

```prisma
model QuestionGroup {
  id          String   @id @default(cuid())
  code        String   @unique
  name        Json
  productId   String?
  phase       String?
  description String?
  orderIndex  Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  product   Product?   @relation(fields: [productId], references: [id])
  questions Question[]
}
```

- [ ] **Step 1.2: Edit `Conversation` — add DNT signing columns**

Add after `candidateSetAt` (line 306):

```prisma
  candidateSetAt      DateTime?
  dntSignedAt         DateTime?
  dntValidUntil       DateTime?
```

- [ ] **Step 1.3: Author the migration with backfill (create-only, then apply)**

Run: `npx prisma migrate dev --create-only --name add-group-phase-and-dnt-columns`

Then open the generated `migration.sql` and append the phase backfill below the `ALTER TABLE` statements:

```sql
-- Backfill phase for existing groups (idempotent; new seed also sets these)
UPDATE "QuestionGroup" SET "phase" = 'dnt' WHERE "code" LIKE 'dnt\_%';
UPDATE "QuestionGroup" SET "phase" = 'application' WHERE "code" IN ('application', 'bd_medical');
```

Then apply: `npx prisma migrate dev --name add-group-phase-and-dnt-columns`
Expected: migration applies, Prisma client regenerates to `lib/generated/prisma`.

(If the dev DB rejects `migrate dev`, use `npx prisma migrate deploy` after the create-only step.)

- [ ] **Step 1.4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (new optional fields flow through generated types).

- [ ] **Step 1.5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add QuestionGroup.phase + Conversation DNT-signed columns"
```

---

### Task 2: Group resolver module

**Files:**
- Create: `lib/engines/question-groups.ts`
- Test: `__tests__/lib/engines/question-groups.test.ts`

- [ ] **Step 2.1: Write the failing test**

```ts
// __tests__/lib/engines/question-groups.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const groupFindManySpy = vi.fn()
const convFindUniqueSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    questionGroup: { findMany: (...a: unknown[]) => groupFindManySpy(...a) },
    conversation: { findUnique: (...a: unknown[]) => convFindUniqueSpy(...a) },
  },
}))

const { resolveGroupCodes, resolveActiveProductId } = await import('@/lib/engines/question-groups')

describe('resolveGroupCodes', () => {
  beforeEach(() => { groupFindManySpy.mockReset(); convFindUniqueSpy.mockReset() })

  it('selects by phase + (product OR global), ordered, returns codes', async () => {
    groupFindManySpy.mockResolvedValueOnce([{ code: 'application' }, { code: 'bd_medical' }])
    const codes = await resolveGroupCodes('p-protect', 'application')
    expect(codes).toEqual(['application', 'bd_medical'])
    expect(groupFindManySpy).toHaveBeenCalledWith({
      where: { phase: 'application', OR: [{ productId: 'p-protect' }, { productId: null }] },
      orderBy: { orderIndex: 'asc' },
      select: { code: true },
    })
  })

  it('returns [] when nothing matches', async () => {
    groupFindManySpy.mockResolvedValueOnce([])
    expect(await resolveGroupCodes('p-x', 'dnt')).toEqual([])
  })

  it('queries global-only when productId is null', async () => {
    groupFindManySpy.mockResolvedValueOnce([{ code: 'dnt_consent' }])
    await resolveGroupCodes(null, 'dnt')
    expect(groupFindManySpy).toHaveBeenCalledWith({
      where: { phase: 'dnt', OR: [{ productId: null }, { productId: null }] },
      orderBy: { orderIndex: 'asc' },
      select: { code: true },
    })
  })
})

describe('resolveActiveProductId', () => {
  beforeEach(() => { groupFindManySpy.mockReset(); convFindUniqueSpy.mockReset() })

  it('returns knownProductId without a DB call', async () => {
    expect(await resolveActiveProductId('conv-1', 'p-known')).toBe('p-known')
    expect(convFindUniqueSpy).not.toHaveBeenCalled()
  })

  it('prefers committed productId over candidate', async () => {
    convFindUniqueSpy.mockResolvedValueOnce({ productId: 'p-committed', candidateProductId: 'p-cand' })
    expect(await resolveActiveProductId('conv-1')).toBe('p-committed')
  })

  it('falls back to candidateProductId when not committed', async () => {
    convFindUniqueSpy.mockResolvedValueOnce({ productId: null, candidateProductId: 'p-cand' })
    expect(await resolveActiveProductId('conv-1')).toBe('p-cand')
  })

  it('returns null when neither is set', async () => {
    convFindUniqueSpy.mockResolvedValueOnce({ productId: null, candidateProductId: null })
    expect(await resolveActiveProductId('conv-1')).toBeNull()
  })
})
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/engines/question-groups.test.ts`
Expected: FAIL — module not found `@/lib/engines/question-groups`.

- [ ] **Step 2.3: Implement `lib/engines/question-groups.ts`**

```ts
import { prisma } from '@/lib/db'

export type QuestionPhase = 'dnt' | 'application'

/**
 * Group codes for a product + phase: the product's own groups plus any
 * global (productId = null) groups, ordered by orderIndex. Replaces the
 * hardcoded DNT_GROUP_CODES / APPLICATION_GROUP_CODES constants.
 */
export async function resolveGroupCodes(
  productId: string | null,
  phase: QuestionPhase,
): Promise<string[]> {
  const groups = await prisma.questionGroup.findMany({
    where: { phase, OR: [{ productId }, { productId: null }] },
    orderBy: { orderIndex: 'asc' },
    select: { code: true },
  })
  return groups.map((g) => g.code)
}

/**
 * The product a conversation is acting on: the committed productId, else the
 * candidate. DNT runs before commit, so the candidate must be honored.
 * Pass a known committed id (e.g. context.product?.id) to skip the query.
 */
export async function resolveActiveProductId(
  conversationId: string,
  knownProductId?: string | null,
): Promise<string | null> {
  if (knownProductId) return knownProductId
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { productId: true, candidateProductId: true },
  })
  return conv?.productId ?? conv?.candidateProductId ?? null
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/engines/question-groups.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 2.5: Commit**

```bash
git add lib/engines/question-groups.ts __tests__/lib/engines/question-groups.test.ts
git commit -m "feat(engines): product-derived question-group resolver"
```

---

### Task 3: Rewire DNT handlers + persist signing to `Conversation`

**Files:**
- Modify: `lib/tools/handlers/dnt-handlers.ts:17-25` (constant), `:31-77` (checkDntStatus), `:83-133` (start), `:139-277` (save), `:283-345` (sign)
- Test: `__tests__/lib/tools/handlers/dnt-signing.test.ts`

- [ ] **Step 3.1: Write the failing test (sign persists to Conversation, no workflow session)**

```ts
// __tests__/lib/tools/handlers/dnt-signing.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const convUpdateSpy = vi.fn()
const calcProgressSpy = vi.fn()
const resolveCodesSpy = vi.fn()
const resolveActiveSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: { conversation: { update: (...a: unknown[]) => convUpdateSpy(...a) } },
}))
vi.mock('@/lib/engines/questionnaire-engine', () => ({
  calculateProgress: (...a: unknown[]) => calcProgressSpy(...a),
  getNextQuestion: vi.fn(),
  validateAnswer: vi.fn(),
}))
vi.mock('@/lib/engines/question-groups', () => ({
  resolveGroupCodes: (...a: unknown[]) => resolveCodesSpy(...a),
  resolveActiveProductId: (...a: unknown[]) => resolveActiveSpy(...a),
}))
vi.mock('@/lib/analytics/events', () => ({ trackDntCompleted: vi.fn() }))

const { signDnt } = await import('@/lib/tools/handlers/dnt-handlers')

const CONTEXT = {
  conversationId: 'conv-1', customerId: 'cust-1', language: 'ro' as const,
} as unknown as Parameters<typeof signDnt>[1]

describe('signDnt', () => {
  beforeEach(() => {
    convUpdateSpy.mockReset(); calcProgressSpy.mockReset()
    resolveCodesSpy.mockReset(); resolveActiveSpy.mockReset()
    resolveActiveSpy.mockResolvedValue('p-protect')
    resolveCodesSpy.mockResolvedValue(['dnt_consent'])
  })

  it('persists dntSignedAt/dntValidUntil to Conversation without a workflow session', async () => {
    calcProgressSpy.mockResolvedValueOnce({ answered: 3, total: 3, percentage: 100 })
    convUpdateSpy.mockResolvedValueOnce({ id: 'conv-1' })

    const result = await signDnt({ confirmSignature: true, gdprConsent: true }, CONTEXT)

    expect(result.success).toBe(true)
    expect(convUpdateSpy).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: expect.objectContaining({
        dntSignedAt: expect.any(Date),
        dntValidUntil: expect.any(Date),
      }),
    })
  })

  it('refuses to sign when DNT is incomplete', async () => {
    calcProgressSpy.mockResolvedValueOnce({ answered: 1, total: 3, percentage: 33 })
    const result = await signDnt({ confirmSignature: true, gdprConsent: true }, CONTEXT)
    expect(result.success).toBe(false)
    expect(convUpdateSpy).not.toHaveBeenCalled()
  })

  it('requires GDPR consent', async () => {
    const result = await signDnt({ confirmSignature: true, gdprConsent: false }, CONTEXT)
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/tools/handlers/dnt-signing.test.ts`
Expected: FAIL — `signDnt` still requires `context.workflowSession` and reads `DNT_GROUP_CODES`.

- [ ] **Step 3.3: Replace the `DNT_GROUP_CODES` constant with resolver imports**

In `lib/tools/handlers/dnt-handlers.ts`, delete the constant at lines 17-25 and add to the imports near the top (after the `questionnaire-engine` import at line 12):

```ts
import { resolveGroupCodes, resolveActiveProductId } from '@/lib/engines/question-groups'
```

Add a small per-call helper just below the imports:

```ts
async function dntGroupCodes(context: { conversationId: string; product?: { id: string } }) {
  const productId = await resolveActiveProductId(context.conversationId, context.product?.id)
  return resolveGroupCodes(productId, 'dnt')
}
```

- [ ] **Step 3.4: Replace each `DNT_GROUP_CODES` usage**

In `checkDntStatus`, `startDntQuestionnaire`, `saveDntAnswer` (both the lookup at ~line 153 and the next-question fetch at ~line 223), and `signDnt`'s progress check (~line 296), replace `DNT_GROUP_CODES` with `await dntGroupCodes(context)`. Example for `startDntQuestionnaire`:

```ts
  const codes = await dntGroupCodes(context)
  const result = await getNextQuestion(codes, context.conversationId)
```

- [ ] **Step 3.5: Rewrite `signDnt` to persist to `Conversation`**

Replace the body of `signDnt` from the progress check through the `workflowSession.update` block (lines ~295-329) with:

```ts
    const codes = await dntGroupCodes(context)
    const progress = await calculateProgress(codes, context.conversationId)
    if (progress.percentage < 100) {
      return {
        success: false,
        error: `Cannot sign: ${progress.total - progress.answered} question(s) still need answers.`,
      }
    }

    const now = new Date()
    const validUntil = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

    await prisma.conversation.update({
      where: { id: context.conversationId },
      data: { dntSignedAt: now, dntValidUntil: validUntil },
    })
```

Keep the `confirmSignature` / `gdprConsent` guards (lines 288-293), the `trackDntCompleted` call, and the success return (update `signedAt`/`validUntil` to use `now`/`validUntil`).

- [ ] **Step 3.6: Update `checkDntStatus` signed-state read**

Replace the `workflowSession`-based signing read (lines 38-55) with a `Conversation` read:

```ts
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { dntSignedAt: true, dntValidUntil: true },
    })
    const isSigned = !!conv?.dntSignedAt && (!conv.dntValidUntil || conv.dntValidUntil > new Date())
    const signedAt = conv?.dntSignedAt?.toISOString() ?? null
    const validUntil = conv?.dntValidUntil?.toISOString() ?? null
```

Add `conversation: { findUnique: ... }` to the test's `@/lib/db` mock if `checkDntStatus` gets its own test later; the signing test above does not exercise this path.

- [ ] **Step 3.7: Run the DNT signing test + full handler suite**

Run: `npx vitest run __tests__/lib/tools/handlers/dnt-signing.test.ts __tests__/lib/tools/`
Expected: PASS. If a pre-existing DNT test mocked `workflowSession.data`, update it to mock `prisma.conversation` instead.

- [ ] **Step 3.8: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/tools/handlers/dnt-handlers.ts __tests__/lib/tools/handlers/dnt-signing.test.ts
git commit -m "feat(dnt): product-derived groups + persist signing to Conversation"
```

---

### Task 4: Rewire application handlers + DNT gate from `Conversation`

**Files:**
- Modify: `lib/tools/handlers/application-handlers.ts:19` (constant), `:25-92` (startApplication gate + groups), `:166-168` (drop isBdStep), `:429,:475` (other usages)
- Test: `__tests__/lib/tools/handlers/application-advance.test.ts`

- [ ] **Step 4.1: Write the failing test (DNT gate + product-derived groups)**

```ts
// __tests__/lib/tools/handlers/application-advance.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const convFindUniqueSpy = vi.fn()
const convUpdateSpy = vi.fn()
const appFindUniqueSpy = vi.fn()
const appCreateSpy = vi.fn()
const calcProgressSpy = vi.fn()
const getNextQuestionSpy = vi.fn()
const resolveCodesSpy = vi.fn()
const resolveActiveSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: {
      findUnique: (...a: unknown[]) => convFindUniqueSpy(...a),
      update: (...a: unknown[]) => convUpdateSpy(...a),
    },
    application: {
      findUnique: (...a: unknown[]) => appFindUniqueSpy(...a),
      create: (...a: unknown[]) => appCreateSpy(...a),
    },
  },
}))
vi.mock('@/lib/engines/questionnaire-engine', () => ({
  calculateProgress: (...a: unknown[]) => calcProgressSpy(...a),
  getNextQuestion: (...a: unknown[]) => getNextQuestionSpy(...a),
  validateAnswer: vi.fn(),
}))
vi.mock('@/lib/engines/question-groups', () => ({
  resolveGroupCodes: (...a: unknown[]) => resolveCodesSpy(...a),
  resolveActiveProductId: (...a: unknown[]) => resolveActiveSpy(...a),
}))

const { startApplication } = await import('@/lib/tools/handlers/application-handlers')

const CONTEXT = {
  conversationId: 'conv-1', customerId: 'cust-1', language: 'ro' as const,
} as unknown as Parameters<typeof startApplication>[1]

describe('startApplication DNT gate', () => {
  beforeEach(() => {
    convFindUniqueSpy.mockReset(); convUpdateSpy.mockReset()
    appFindUniqueSpy.mockReset(); appCreateSpy.mockReset()
    calcProgressSpy.mockReset(); getNextQuestionSpy.mockReset()
    resolveCodesSpy.mockReset(); resolveActiveSpy.mockReset()
    resolveActiveSpy.mockResolvedValue('p-protect')
    resolveCodesSpy.mockResolvedValue(['application', 'bd_medical'])
    appFindUniqueSpy.mockResolvedValue(null) // no existing application
  })

  it('blocks when DNT is not signed', async () => {
    convFindUniqueSpy.mockResolvedValue({ dntSignedAt: null, dntValidUntil: null, candidateProductId: 'p-protect', productId: null })
    const result = await startApplication({}, CONTEXT)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/DNT/i)
    expect(appCreateSpy).not.toHaveBeenCalled()
  })

  it('starts the application (product-derived groups) when DNT is signed', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60)
    convFindUniqueSpy.mockResolvedValue({ dntSignedAt: new Date(), dntValidUntil: future, candidateProductId: 'p-protect', productId: 'p-protect' })
    calcProgressSpy.mockResolvedValueOnce({ answered: 0, total: 11, percentage: 0 })
    appCreateSpy.mockResolvedValueOnce({ id: 'app-1' })
    getNextQuestionSpy.mockResolvedValueOnce({
      question: { id: 'q1', code: 'PACKAGE_CHOICE', text: { ro: 'Ce pachet?', en: 'Which package?' }, helpText: null, type: 'DROPDOWN', options: [] },
      progress: { answered: 0, total: 11, percentage: 0 },
    })

    const result = await startApplication({}, CONTEXT)

    expect(result.success).toBe(true)
    expect(resolveCodesSpy).toHaveBeenCalledWith('p-protect', 'application')
    expect(appCreateSpy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/tools/handlers/application-advance.test.ts`
Expected: FAIL — gate still reads `workflowSession`, groups still `APPLICATION_GROUP_CODES`.

- [ ] **Step 4.3: Swap constant + imports**

In `lib/tools/handlers/application-handlers.ts`, delete `const APPLICATION_GROUP_CODES = ['application']` (line 19) and add after the `questionnaire-engine` import:

```ts
import { resolveGroupCodes, resolveActiveProductId } from '@/lib/engines/question-groups'

async function appGroupCodes(context: { conversationId: string; product?: { id: string } }) {
  const productId = await resolveActiveProductId(context.conversationId, context.product?.id)
  return resolveGroupCodes(productId, 'application')
}
```

- [ ] **Step 4.4: Replace the DNT gate in `startApplication`**

Replace the `workflowSession` DNT check (lines 27-39) with a `Conversation` read:

```ts
    const conv = await prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: { dntSignedAt: true, dntValidUntil: true, productId: true, candidateProductId: true },
    })
    const dntValid = !!conv?.dntSignedAt && (!conv.dntValidUntil || conv.dntValidUntil > new Date())
    if (!dntValid) {
      return { success: false, error: 'DNT must be signed before starting an application.' }
    }
```

- [ ] **Step 4.5: Use the resolver for group codes**

Replace `APPLICATION_GROUP_CODES` at the `calculateProgress` (line 70) and `getNextQuestion` (line 95) calls:

```ts
    const codes = await appGroupCodes(context)
    const progress = await calculateProgress(codes, context.conversationId)
    // ...create application...
    const result = await getNextQuestion(codes, context.conversationId)
```

Also replace the remaining `APPLICATION_GROUP_CODES` usages at lines 429 and 475 with `await appGroupCodes(context)`.

- [ ] **Step 4.6: Drop the `isBdStep` split**

Replace lines 166-168:

```ts
    const isBdStep = context.workflowSession?.currentStepCode?.includes('bd') ?? false
    const activeGroupCodes = isBdStep ? ['bd_medical'] : APPLICATION_GROUP_CODES
    const activeGroupType = isBdStep ? 'bd_medical' : 'application'
```

with:

```ts
    const activeGroupCodes = await appGroupCodes(context)
    const activeGroupType = 'application'
```

(`bd_medical` is now part of the `application` phase, sequenced after `application` by `orderIndex`.)

- [ ] **Step 4.7: Run test + full handler suite**

Run: `npx vitest run __tests__/lib/tools/handlers/application-advance.test.ts __tests__/lib/tools/`
Expected: PASS. For any pre-existing `start_application` test that now fails on the DNT gate (e.g. `application-promotion.test.ts`), add `dntSignedAt: new Date(), dntValidUntil: <future>` to its `conversation.findUnique` mock.

- [ ] **Step 4.8: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/tools/handlers/application-handlers.ts __tests__/lib/tools/handlers/application-advance.test.ts
git commit -m "feat(application): product-derived groups + DNT gate from Conversation"
```

---

### Task 5: Seed — tag every group with `phase`

**Files:**
- Modify: `prisma/seeds/seed-questions.ts:17-54` (seedGroup), and each `seedGroup({...})` call

- [ ] **Step 5.1: Add `phase` to the `seedGroup` signature + upsert**

In `prisma/seeds/seed-questions.ts`, add `phase` to the `groupDef` type (after `productId`, line 23):

```ts
      orderIndex: number
      productId?: string | null
      phase?: 'dnt' | 'application' | null
```

And to both `update` and `create` blocks of the `questionGroup.upsert` (lines 41-53), add:

```ts
        productId: groupDef.productId ?? null,
        phase: groupDef.phase ?? null,
```

- [ ] **Step 5.2: Tag each group**

Add `phase:` to each `seedGroup({...})` group definition:
- `dnt_consent`, `dnt_general`, `dnt_life_type`, `dnt_life_financial`, `dnt_life_investment`, `dnt_sustainability` → `phase: 'dnt'`
- `application` (line 568-576), `bd_medical` (line 649-657) → `phase: 'application'`

Example (`application`):

```ts
    {
      code: 'application',
      name: { en: 'Insurance Application', ro: 'Cerere de Asigurare' },
      description: 'Protect product application questions: health declaration, package choice, level, BD interest, payment',
      orderIndex: 6,
      productId: product.id,
      phase: 'application',
    },
```

- [ ] **Step 5.3: Re-seed and verify**

Run: `npx prisma db seed`
Then verify:

```bash
npx tsx --env-file=.env -e "import('@/lib/db').then(async ({prisma})=>{const g=await prisma.questionGroup.findMany({select:{code:true,phase:true,productId:true},orderBy:{orderIndex:'asc'}});console.log(g);await prisma.\$disconnect()})"
```

Expected: every group has a non-null `phase`; `dnt_*` = `dnt` (productId null), `application`/`bd_medical` = `application` (productId set).

- [ ] **Step 5.4: Commit**

```bash
git add prisma/seeds/seed-questions.ts
git commit -m "feat(seed): tag question groups with phase (dnt/application)"
```

---

### Task 6: Retire `set_conversation_product`

**Files:**
- Modify: `lib/tools/registry.ts:22,377,476-497` (+ rename status constant at `:214-225`,`:493`,`:525`)
- Modify: `lib/tools/handlers/product-handlers.ts:4,113-168`
- Modify: `lib/chat/default-tools.ts:12`, `lib/tools/validation.ts:34-37,170`, `lib/tools/pipeline.ts:249-250`, `lib/chat/action-adapter.ts:100-105`
- Modify: `prisma/seeds/seed-agents.ts:383`, `prisma/seeds/seed-workflows.ts:60,80-81,91`
- Modify tests: `default-tools.test.ts`, `discovery-empty-catalog.test.ts`, `discovery-tool-status.test.ts`, `orchestrator-discovery-tools.test.ts`, `debug-confirmation.test.ts`, `main-chat-constraints.test.ts`

- [ ] **Step 6.1: Rename the shared status constant (avoid breaking `set_candidate_product`)**

In `lib/tools/registry.ts`, rename `STATUS_SET_CONVERSATION_PRODUCT` (lines 214-225) to `STATUS_SET_CANDIDATE_PRODUCT`, and update its only surviving reference at line 525 (`set_candidate_product` registration) to the new name.

- [ ] **Step 6.2: Remove the tool registration + import + allowlist entry**

In `lib/tools/registry.ts`: delete the `set_conversation_product` registration block (lines 476-497), the `'set_conversation_product',` line in `ALWAYS_ALLOWED_SET` (line 377), and remove `setConversationProduct` from the import on line 22 (keep `compareProducts`).

- [ ] **Step 6.3: Delete the handler**

In `lib/tools/handlers/product-handlers.ts`: delete the `setConversationProduct` function (lines ~113-168) and remove `set_conversation_product` from the file header comment (line 4).

- [ ] **Step 6.4: Remove remaining code references**

- `lib/chat/default-tools.ts:12` — delete the `'set_conversation_product',` array entry.
- `lib/tools/validation.ts` — delete `setConversationProductSchema` (lines 34-37) and its registry entry (line 170).
- `lib/tools/pipeline.ts:249-250` — delete the `case 'set_conversation_product':` block.
- `lib/chat/action-adapter.ts:100-105` — delete the `case 'select_product':` block that emits the tool. Grep `select_product` to confirm nothing else emits that action: `grep -rn "select_product" lib/` — if other emitters exist, leave the action type but remove only the tool mapping.

- [ ] **Step 6.5: Remove the prompt references**

- `prisma/seeds/seed-agents.ts:383` — delete the entire confirm-Protect constraint string from the `constraints` array.
- `prisma/seeds/seed-workflows.ts` — delete the `'set_conversation_product',` allowedTools entry (line 60), and the two instruction lines (line 80 "Call set_conversation_product as soon as…" and line 91 "After you call set_conversation_product, a product-specific workflow will activate automatically…").

- [ ] **Step 6.6: Update the affected tests**

- `__tests__/lib/chat/default-tools.test.ts` — remove `'set_conversation_product',` from all four expected arrays; change "six baseline tools" → "five" in the test name/comment.
- `__tests__/lib/chat/discovery-empty-catalog.test.ts` — delete the `toContain('set_conversation_product')` assertion (line 18) and the array entry (line 47); change the `toHaveLength(8)` to `toHaveLength(7)` (line 55).
- `__tests__/lib/tools/discovery-tool-status.test.ts` — delete the whole `it('set_conversation_product has bilingual status messages', …)` test (lines 19-24).
- `__tests__/lib/chat/orchestrator-discovery-tools.test.ts` — delete the `toContain('set_conversation_product')` assertion (line 15).
- `__tests__/lib/chat/debug-confirmation.test.ts` — replace the `name: 'set_conversation_product'` in the debug-event fixture (line 19) with `name: 'list_products'`.
- `__tests__/prisma/seeds/main-chat-constraints.test.ts` — delete the `it('includes the set_conversation_product confirmation rule', …)` test (lines 5-15).

- [ ] **Step 6.7: Add a removal-regression test**

Append to `__tests__/lib/tools/discovery-tool-status.test.ts`:

```ts
  it('set_conversation_product is fully retired', () => {
    expect(getToolDefinition('set_conversation_product')).toBeUndefined()
  })
```

- [ ] **Step 6.8: Run the touched suites + typecheck**

Run: `npx vitest run __tests__/lib/chat/ __tests__/lib/tools/ __tests__/prisma/`
Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6.9: Re-seed (agents + workflows) and commit**

Run: `npx tsx scripts/reseed-agents.ts` (flush a running app via `/api/admin/agents/flush-cache`).

```bash
git add lib/tools/registry.ts lib/tools/handlers/product-handlers.ts lib/chat/default-tools.ts \
        lib/tools/validation.ts lib/tools/pipeline.ts lib/chat/action-adapter.ts \
        prisma/seeds/seed-agents.ts prisma/seeds/seed-workflows.ts __tests__/
git commit -m "refactor(tools): retire set_conversation_product (candidate + start_application cover it)"
```

---

### Task 7: Prompt — drive the advance sequence

**Files:**
- Modify: `prisma/seeds/seed-agents.ts` (MAIN_CHAT_PROMPT, after the `ANSWER FIRST` section ~line 89)
- Modify: `prisma/seeds/seed-skill-packs.ts` (closing pack — align the "Pasul următor concret" text ~line 127)

- [ ] **Step 7.1: Add the advance-sequence section to `MAIN_CHAT_PROMPT`**

Insert after the `ANSWER FIRST — DON'T DEFLECT` section:

```
ADVANCING TO THE OFFER (when the customer converges on a product + package):
- Convergence = the customer picks a concrete variant (e.g. "standard nivel 1") or says "da" to a package/level you offered. Do NOT ask them to "confirm" the product — choosing it IS the confirmation, and binding it is internal plumbing.
- On convergence: affirm the choice in one warm sentence, then ask ONE natural readiness question to proceed — e.g. "Ca să-ți pregătesc oferta exactă, trecem prin câțiva pași scurți. Începem?" Never ask "confirmi că alegi Protect?".
- When the customer agrees, drive the sequence yourself, silently (tool use is invisible): the needs assessment (DNT) first, then its signing, then the application, then the quote. Present each question naturally as it comes back from the tools. NEVER tell the customer the system will "take it from here" — YOU advance it by calling the tools.
- Do not collect quote inputs (age, etc.) as free-floating questions outside this flow; they are gathered by the needs-assessment and application steps.
```

- [ ] **Step 7.2: Align the closing pack**

In `prisma/seeds/seed-skill-packs.ts`, update the "Pasul următor concret" line (~127) so the proposed next step is the readiness question that leads into the DNT/application sequence (not a product confirmation). Replace its example with:

```
- **Pasul următor concret**: După ce clientul alege un pachet/nivel, nu cere o "confirmare a produsului". Afirmă alegerea și propune trecerea la pași: "Ca să-ți pregătesc oferta, trecem prin câteva întrebări scurte. Începem?" La acceptare, pornești evaluarea de nevoi (DNT) și apoi cererea.
```

- [ ] **Step 7.3: Re-seed**

Run: `npx tsx scripts/reseed-agents.ts` and `npx prisma db seed` (skill packs). Flush cache via `/api/admin/agents/flush-cache` if the app is running.

- [ ] **Step 7.4: Commit**

```bash
git add prisma/seeds/seed-agents.ts prisma/seeds/seed-skill-packs.ts
git commit -m "feat(prompt): drive converge->DNT->sign->application->quote, no product-confirm ceremony"
```

---

### Task 8: Full suite + manual runtime verification

**Files:** none (verification only).

- [ ] **Step 8.1: Full test suite + typecheck**

Run: `npx vitest run` and `npx tsc --noEmit`
Expected: all green.

- [ ] **Step 8.2: Reproduce the original failure path**

Start the app (`npm run dev`). In a fresh conversation, mirror `cmpp27t1c002ciw0ygr0627xa`:
1. "as vrea o asigurare de viata" → Protect presented (differentiator-first).
2. Converge: "standard nivel 1".
3. **Verify:** Zeno affirms + asks ONE readiness question ("…trecem prin câțiva pași scurți. Începem?"). It does NOT ask "confirmi că alegi Protect?" and does NOT ask a free-floating "câți ani ai?".
4. Reply "da". **Verify:** Zeno begins the DNT needs assessment (first DNT question appears) rather than stalling.
5. Use `npx tsx --env-file=.env scripts/inspect-state.ts <newConvId>` to confirm progression: after DNT completes + signs, `dntSignedAt` is set on the conversation; `start_application` then succeeds and `application` is non-null.

PASS criteria: no "confirm Protect" turn, no stall; the conversation advances product → DNT → sign → application. FAIL → revisit Task 7 (prompt) and Task 3/4 (handler wiring).

- [ ] **Step 8.3: Negative gate check**

In a conversation where DNT is not signed, confirm `start_application` is refused with the DNT error (the agent should route back into the needs assessment, not fabricate a quote).

---

## Self-Review

**Spec coverage:**
- `QuestionGroup.phase` + `Conversation` DNT columns → Task 1.
- Resolver (`resolveGroupCodes`, `resolveActiveProductId`) → Task 2.
- DNT handlers product-derived + signing relocated to `Conversation` → Task 3.
- Application handlers product-derived + enforceable DNT gate + drop `isBdStep` → Task 4.
- Seed `phase` tagging (product-scoped via existing `productId`) → Task 5.
- Retire `set_conversation_product` (code + prompt + tests) → Task 6.
- Prompt drives readiness-then-sequence; closing pack aligned → Task 7.
- Manual runtime reproduction of `cmpp27t1c…` + negative gate → Task 8.
- Out-of-scope items (insuranceType line-scoping, full WorkflowSession retirement, cross-conversation DNT reuse) are intentionally absent.

**Placeholder scan:** No TBD/TODO; every code step has concrete code; commands and expected outputs are explicit. The two "if a pre-existing test breaks" notes (Tasks 3.7, 4.7) give the exact mock to add.

**Type consistency:** `resolveGroupCodes(productId: string|null, phase: 'dnt'|'application')` and `resolveActiveProductId(conversationId, knownProductId?)` are used identically in Tasks 3–4. `dntSignedAt`/`dntValidUntil` are `DateTime?` in the schema (Task 1), written as `Date` and read as `Date` in handlers (Tasks 3–4). `phase` values (`'dnt'|'application'`) match between schema backfill (Task 1), seed (Task 5), and resolver (Task 2).

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-05-28-zeno-product-derived-advance-flow.md`.
