# Self-Improvement Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daily batch pipeline that scores conversation outcomes, identifies patterns, proposes improvements to knowledge and skill packs, and tracks adopted changes for regressions — with admin approval via a UI queue.

**Architecture:** Four sequential pipeline agents (Scorer → Analyzer → Proposer → Tracker) run as a daily batch job. A new `ImprovementProposal` model stores proposed changes for admin review. A/B testing is integrated via an `ABTestVariant` model with random assignment at orchestrator Step 3. Three new admin pages provide visibility and control.

**Tech Stack:** Next.js 15 (App Router), Prisma (PostgreSQL), Vitest, Tailwind CSS, LLM gateway (existing), Event bus (existing)

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `lib/self-improvement/scorer.ts` | Score unscored conversations with weighted signals |
| `lib/self-improvement/analyzer.ts` | Aggregate scores, update AgentKnowledge successRates, detect patterns |
| `lib/self-improvement/proposer.ts` | Generate improvement proposals via LLM |
| `lib/self-improvement/tracker.ts` | Monitor adopted proposals for regressions |
| `lib/self-improvement/batch-runner.ts` | Orchestrate the 4-agent pipeline sequentially |
| `lib/self-improvement/types.ts` | Shared types and interfaces for the pipeline |
| `app/admin/(protected)/proposals/page.tsx` | Proposals queue admin page (server component) |
| `components/admin/proposal-table.tsx` | Proposals list client component |
| `components/admin/proposal-detail.tsx` | Proposal detail + approve/reject client component |
| `app/admin/(protected)/ab-tests/page.tsx` | A/B tests admin page (server component) |
| `components/admin/ab-test-table.tsx` | A/B tests list + create client component |
| `app/admin/(protected)/self-improvement/page.tsx` | Dashboard admin page (server component) |
| `components/admin/self-improvement-dashboard.tsx` | Dashboard stats client component |
| `app/api/admin/proposals/route.ts` | GET list proposals |
| `app/api/admin/proposals/[id]/route.ts` | GET detail |
| `app/api/admin/proposals/[id]/approve/route.ts` | POST approve + apply |
| `app/api/admin/proposals/[id]/reject/route.ts` | POST reject |
| `app/api/admin/ab-tests/route.ts` | GET list, POST create |
| `app/api/admin/ab-tests/[id]/end/route.ts` | POST end test |
| `app/api/admin/ab-tests/[id]/results/route.ts` | GET results |
| `app/api/admin/self-improvement/route.ts` | GET dashboard stats, POST trigger batch |
| `__tests__/lib/self-improvement/scorer.test.ts` | Scorer unit tests |
| `__tests__/lib/self-improvement/analyzer.test.ts` | Analyzer unit tests |
| `__tests__/lib/self-improvement/proposer.test.ts` | Proposer unit tests |
| `__tests__/lib/self-improvement/tracker.test.ts` | Tracker unit tests |
| `__tests__/lib/self-improvement/batch-runner.test.ts` | Batch runner integration test |
| `__tests__/integration/ab-test-assignment.test.ts` | A/B test assignment integration test |

### Modified files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add ConversationScore, ImprovementProposal, ABTestVariant models + ProposalType, ProposalStatus enums |
| `lib/chat/orchestrator.ts` | A/B test variant assignment after Step 3 reasoning gate |
| `components/admin/admin-sidebar.tsx` | Add nav items for Proposals, A/B Tests, Self-Improvement |

---

## Task 1: Prisma Schema — New Models and Enums

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add ProposalType and ProposalStatus enums**

Add after the `KnowledgeCategory` enum (around line 85) in `prisma/schema.prisma`:

```prisma
enum ProposalType {
  KNOWLEDGE_CREATE
  KNOWLEDGE_UPDATE
  SKILLPACK_UPDATE
  INSIGHT
}

enum ProposalStatus {
  PENDING
  APPROVED
  REJECTED
}
```

- [ ] **Step 2: Add ConversationScore model**

Add after the `AgentKnowledge` model (after line 700) in `prisma/schema.prisma`:

```prisma
// ==========================================
// DOMAIN: SELF-IMPROVEMENT
// ==========================================

model ConversationScore {
  id                   String   @id @default(cuid())
  conversationId       String   @unique
  quoteGenerated       Boolean
  applicationSubmitted Boolean
  policyPurchased      Boolean
  score                Float
  messageCount         Int
  totalCost            Float
  totalLatencyMs       Int
  anomalyCount         Int
  mode                 String
  skillPackSlugs       String[]
  scoredAt             DateTime @default(now())
  createdAt            DateTime @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id])

  @@index([scoredAt])
  @@index([score])
}
```

- [ ] **Step 3: Add ImprovementProposal model**

Add after the `ConversationScore` model:

```prisma
model ImprovementProposal {
  id              String         @id @default(cuid())
  type            ProposalType
  title           String
  description     String         @db.Text
  diff            Json
  evidence        Json
  status          ProposalStatus @default(PENDING)
  adminNotes      String?        @db.Text
  appliedAt       DateTime?
  baselineMetrics Json?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([status, createdAt])
}
```

- [ ] **Step 4: Add ABTestVariant model**

Add after the `ImprovementProposal` model:

```prisma
model ABTestVariant {
  id             String    @id @default(cuid())
  name           String
  skillPackSlugA String
  skillPackSlugB String
  splitRatio     Float
  isActive       Boolean   @default(true)
  startedAt      DateTime  @default(now())
  endedAt        DateTime?
  conversationsA Int       @default(0)
  conversationsB Int       @default(0)
  createdAt      DateTime  @default(now())

  @@index([isActive])
}
```

- [ ] **Step 5: Add ConversationScore relation to Conversation model**

In the `Conversation` model (around line 304), add after `turnTraces TurnTrace[]`:

```prisma
  score           ConversationScore?
```

- [ ] **Step 6: Run prisma generate and verify**

Run: `npx prisma generate`
Expected: Prisma client generated successfully with new models.

Run: `npx prisma db push`
Expected: Database schema updated with new tables.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add ConversationScore, ImprovementProposal, ABTestVariant models"
```

---

## Task 2: Shared Types

**Files:**
- Create: `lib/self-improvement/types.ts`

- [ ] **Step 1: Create types file**

Create `lib/self-improvement/types.ts`:

```typescript
/**
 * Shared types for the self-improvement pipeline.
 */

export interface ScoredConversation {
  conversationId: string
  quoteGenerated: boolean
  applicationSubmitted: boolean
  policyPurchased: boolean
  score: number
  messageCount: number
  totalCost: number
  totalLatencyMs: number
  anomalyCount: number
  mode: string
  skillPackSlugs: string[]
}

export interface AnalysisResult {
  /** Average score per skill pack slug combination (JSON key = sorted slugs joined by +) */
  skillPackPerformance: Record<string, { avgScore: number; count: number }>
  /** Patterns detected as free-text observations */
  patterns: string[]
  /** A/B test results keyed by test ID */
  abTestResults: Record<string, { avgScoreA: number; avgScoreB: number; countA: number; countB: number }>
  /** Top and bottom conversation IDs for proposer */
  topConversationIds: string[]
  bottomConversationIds: string[]
}

export interface ProposalDiff {
  /** For KNOWLEDGE_CREATE */
  create?: {
    category: string
    trigger: string
    content: string
    productId?: string
    workflowStepCode?: string
  }
  /** For KNOWLEDGE_UPDATE */
  update?: {
    knowledgeId: string
    before: Record<string, unknown>
    after: Record<string, unknown>
  }
  /** For SKILLPACK_UPDATE */
  skillPackUpdate?: {
    skillPackSlug: string
    sectionKey: string
    before: string
    after: string
  }
  /** For INSIGHT */
  insight?: {
    observation: string
  }
}

export interface ProposalEvidence {
  conversationIds: string[]
  sampleSize: number
  confidence: number
}

export interface BatchResult {
  startedAt: Date
  completedAt: Date
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
  scored: number
  analysisComplete: boolean
  proposalsGenerated: number
  regressionsDetected: number
  error?: string
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/self-improvement/types.ts
git commit -m "feat(self-improvement): add shared pipeline types"
```

---

## Task 3: Scorer Agent

**Files:**
- Create: `__tests__/lib/self-improvement/scorer.test.ts`
- Create: `lib/self-improvement/scorer.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/self-improvement/scorer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma
const mockFindMany = vi.fn()
const mockCreate = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: { findMany: (...args: unknown[]) => mockFindMany(...args) },
    conversationScore: { create: (...args: unknown[]) => mockCreate(...args) },
  },
}))

const { scoreConversations } = await import('@/lib/self-improvement/scorer')

describe('scoreConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scores a conversation with quote + application + purchase as 1.0', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'conv-1',
        messageCount: 12,
        mode: 'SALES',
        activeSkillPacks: ['life-insurance-discovery'],
        application: {
          id: 'app-1',
          quote: {
            id: 'quote-1',
            policy: {
              id: 'policy-1',
              payments: [{ status: 'COMPLETED' }],
            },
          },
        },
        turnTraces: [
          { cost: 0.05, latencyMs: 2000, anomalies: [] },
          { cost: 0.03, latencyMs: 1500, anomalies: [{ type: 'latency' }] },
        ],
      },
    ])
    mockCreate.mockResolvedValue({ id: 'score-1' })

    const result = await scoreConversations()

    expect(result).toBe(1)
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conv-1',
        quoteGenerated: true,
        applicationSubmitted: true,
        policyPurchased: true,
        score: 1.0, // (0.3 + 0.6 + 1.0) / 1.9 = 1.0
        messageCount: 12,
        totalCost: 0.08,
        totalLatencyMs: 3500,
        anomalyCount: 1,
        mode: 'SALES',
        skillPackSlugs: ['life-insurance-discovery'],
      }),
    })
  })

  it('scores a conversation with only quote as ~0.158', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'conv-2',
        messageCount: 8,
        mode: 'SALES',
        activeSkillPacks: [],
        application: {
          id: 'app-2',
          quote: { id: 'quote-2', policy: null },
        },
        turnTraces: [{ cost: 0.02, latencyMs: 1000, anomalies: [] }],
      },
    ])
    mockCreate.mockResolvedValue({ id: 'score-2' })

    const result = await scoreConversations()

    expect(result).toBe(1)
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conv-2',
        quoteGenerated: true,
        applicationSubmitted: true,
        policyPurchased: false,
        score: expect.closeTo(0.4737, 3), // (0.3 + 0.6) / 1.9
      }),
    })
  })

  it('scores an abandoned conversation with no progress as 0', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'conv-3',
        messageCount: 3,
        mode: 'SALES',
        activeSkillPacks: [],
        application: null,
        turnTraces: [{ cost: 0.01, latencyMs: 500, anomalies: [] }],
      },
    ])
    mockCreate.mockResolvedValue({ id: 'score-3' })

    const result = await scoreConversations()

    expect(result).toBe(1)
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        quoteGenerated: false,
        applicationSubmitted: false,
        policyPurchased: false,
        score: 0,
      }),
    })
  })

  it('returns 0 when no unscored conversations exist', async () => {
    mockFindMany.mockResolvedValue([])

    const result = await scoreConversations()

    expect(result).toBe(0)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/self-improvement/scorer.test.ts`
Expected: FAIL — module `@/lib/self-improvement/scorer` not found.

- [ ] **Step 3: Implement the scorer**

Create `lib/self-improvement/scorer.ts`:

```typescript
/**
 * Scorer Agent — scores unscored completed/abandoned conversations.
 *
 * Weighted signals:
 *   quote generated    = 0.3
 *   application submitted = 0.6
 *   policy purchased   = 1.0
 * Normalized to 0–1 by dividing by 1.9.
 */

import { prisma } from '@/lib/db'

const MAX_SCORE = 0.3 + 0.6 + 1.0 // 1.9

interface ConversationWithRelations {
  id: string
  messageCount: number
  mode: string
  activeSkillPacks: string[]
  application: {
    id: string
    quote: {
      id: string
      policy: {
        id: string
        payments: { status: string }[]
      } | null
    } | null
  } | null
  turnTraces: {
    cost: number | null
    latencyMs: number | null
    anomalies: unknown
  }[]
}

export async function scoreConversations(): Promise<number> {
  const conversations = await prisma.conversation.findMany({
    where: {
      status: { in: ['COMPLETED', 'ABANDONED'] },
      score: null, // no ConversationScore yet
    },
    include: {
      application: {
        include: {
          quote: {
            include: {
              policy: {
                include: {
                  payments: { where: { status: 'COMPLETED' }, take: 1 },
                },
              },
            },
          },
        },
      },
      turnTraces: {
        select: { cost: true, latencyMs: true, anomalies: true },
      },
    },
  }) as ConversationWithRelations[]

  let scored = 0

  for (const conv of conversations) {
    const applicationSubmitted = conv.application !== null
    const quoteGenerated = applicationSubmitted && conv.application!.quote !== null
    const policyPurchased =
      quoteGenerated &&
      conv.application!.quote!.policy !== null &&
      (conv.application!.quote!.policy!.payments?.length ?? 0) > 0

    const rawScore =
      (quoteGenerated ? 0.3 : 0) +
      (applicationSubmitted ? 0.6 : 0) +
      (policyPurchased ? 1.0 : 0)
    const normalizedScore = rawScore / MAX_SCORE

    const totalCost = conv.turnTraces.reduce((sum, t) => sum + (t.cost ?? 0), 0)
    const totalLatencyMs = conv.turnTraces.reduce((sum, t) => sum + (t.latencyMs ?? 0), 0)
    const anomalyCount = conv.turnTraces.reduce((sum, t) => {
      const anomalies = t.anomalies as unknown[] | null
      return sum + (Array.isArray(anomalies) ? anomalies.length : 0)
    }, 0)

    await prisma.conversationScore.create({
      data: {
        conversationId: conv.id,
        quoteGenerated,
        applicationSubmitted,
        policyPurchased,
        score: normalizedScore,
        messageCount: conv.messageCount,
        totalCost,
        totalLatencyMs,
        anomalyCount,
        mode: conv.mode,
        skillPackSlugs: conv.activeSkillPacks,
      },
    })

    scored++
  }

  return scored
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/self-improvement/scorer.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/self-improvement/scorer.ts __tests__/lib/self-improvement/scorer.test.ts
git commit -m "feat(self-improvement): add scorer agent with weighted conversation scoring"
```

---

## Task 4: Analyzer Agent

**Files:**
- Create: `__tests__/lib/self-improvement/analyzer.test.ts`
- Create: `lib/self-improvement/analyzer.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/self-improvement/analyzer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockScoreFindMany = vi.fn()
const mockKnowledgeFindMany = vi.fn()
const mockKnowledgeUpdate = vi.fn()
const mockAbTestFindMany = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    conversationScore: { findMany: (...args: unknown[]) => mockScoreFindMany(...args) },
    agentKnowledge: {
      findMany: (...args: unknown[]) => mockKnowledgeFindMany(...args),
      update: (...args: unknown[]) => mockKnowledgeUpdate(...args),
    },
    aBTestVariant: { findMany: (...args: unknown[]) => mockAbTestFindMany(...args) },
    conversation: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

const { analyzeScores } = await import('@/lib/self-improvement/analyzer')

describe('analyzeScores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAbTestFindMany.mockResolvedValue([])
  })

  it('groups scores by skill pack combination', async () => {
    mockScoreFindMany.mockResolvedValue([
      { id: 's1', conversationId: 'c1', score: 0.8, skillPackSlugs: ['discovery', 'closing'], mode: 'SALES' },
      { id: 's2', conversationId: 'c2', score: 0.6, skillPackSlugs: ['discovery', 'closing'], mode: 'SALES' },
      { id: 's3', conversationId: 'c3', score: 0.2, skillPackSlugs: ['discovery'], mode: 'SALES' },
    ])
    mockKnowledgeFindMany.mockResolvedValue([])

    const result = await analyzeScores()

    expect(result.skillPackPerformance['closing+discovery']).toEqual({
      avgScore: 0.7,
      count: 2,
    })
    expect(result.skillPackPerformance['discovery']).toEqual({
      avgScore: 0.2,
      count: 1,
    })
  })

  it('identifies top and bottom conversations', async () => {
    const scores = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`,
      conversationId: `c${i}`,
      score: i * 0.09,
      skillPackSlugs: [],
      mode: 'SALES',
    }))
    mockScoreFindMany.mockResolvedValue(scores)
    mockKnowledgeFindMany.mockResolvedValue([])

    const result = await analyzeScores()

    // Bottom 5 = c0..c4 (lowest scores), top 5 = c11..c7 (highest scores)
    expect(result.bottomConversationIds).toHaveLength(5)
    expect(result.topConversationIds).toHaveLength(5)
    expect(result.topConversationIds[0]).toBe('c11')
    expect(result.bottomConversationIds[0]).toBe('c0')
  })

  it('updates AgentKnowledge successRate with weighted moving average', async () => {
    mockScoreFindMany.mockResolvedValue([
      { id: 's1', conversationId: 'c1', score: 0.9, skillPackSlugs: [], mode: 'SALES' },
      { id: 's2', conversationId: 'c2', score: 0.7, skillPackSlugs: [], mode: 'SALES' },
    ])
    mockKnowledgeFindMany.mockResolvedValue([
      {
        id: 'k1',
        category: 'OBJECTION_RESPONSE',
        productId: null,
        workflowStepCode: null,
        successRate: 0.5,
        sampleSize: 10,
      },
    ])
    mockKnowledgeUpdate.mockResolvedValue({})

    await analyzeScores()

    expect(mockKnowledgeUpdate).toHaveBeenCalledWith({
      where: { id: 'k1' },
      data: {
        successRate: expect.any(Number),
        sampleSize: 12, // 10 + 2 new
      },
    })

    // Weighted moving average: (0.5 * 10 + 0.8 * 2) / 12 = 6.6 / 12 = 0.55
    const updateCall = mockKnowledgeUpdate.mock.calls[0][0]
    expect(updateCall.data.successRate).toBeCloseTo(0.55, 2)
  })

  it('returns empty analysis when no scores exist', async () => {
    mockScoreFindMany.mockResolvedValue([])
    mockKnowledgeFindMany.mockResolvedValue([])

    const result = await analyzeScores()

    expect(result.skillPackPerformance).toEqual({})
    expect(result.topConversationIds).toEqual([])
    expect(result.bottomConversationIds).toEqual([])
    expect(result.patterns).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/self-improvement/analyzer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the analyzer**

Create `lib/self-improvement/analyzer.ts`:

```typescript
/**
 * Analyzer Agent — aggregates conversation scores, updates knowledge
 * effectiveness, detects patterns, and computes A/B test results.
 */

import { prisma } from '@/lib/db'
import type { AnalysisResult } from './types'

const TOP_N = 5
const BOTTOM_N = 5

export async function analyzeScores(): Promise<AnalysisResult> {
  // Fetch scores from the last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const scores = await prisma.conversationScore.findMany({
    where: { scoredAt: { gte: since } },
    orderBy: { score: 'desc' },
  })

  if (scores.length === 0) {
    return {
      skillPackPerformance: {},
      patterns: [],
      abTestResults: {},
      topConversationIds: [],
      bottomConversationIds: [],
    }
  }

  // 1. Skill pack performance — group by sorted slug combination
  const skillPackPerformance: Record<string, { avgScore: number; count: number }> = {}
  for (const s of scores) {
    const key = [...s.skillPackSlugs].sort().join('+') || '(none)'
    const entry = skillPackPerformance[key] ?? { avgScore: 0, count: 0 }
    entry.avgScore = (entry.avgScore * entry.count + s.score) / (entry.count + 1)
    entry.count++
    skillPackPerformance[key] = entry
  }

  // 2. Top and bottom conversations
  const topConversationIds = scores.slice(0, TOP_N).map((s) => s.conversationId)
  const bottomConversationIds = scores
    .slice(-BOTTOM_N)
    .reverse()
    .map((s) => s.conversationId)

  // 3. Update AgentKnowledge successRates
  const knowledgeEntries = await prisma.agentKnowledge.findMany({
    where: { isActive: true },
  })

  for (const knowledge of knowledgeEntries) {
    // Match scores by product/mode context
    const matchingScores = scores.filter((s) => {
      if (knowledge.productId && knowledge.workflowStepCode) {
        return s.mode === 'SALES' // broad match for product-specific knowledge
      }
      return true // general knowledge matches all
    })

    if (matchingScores.length === 0) continue

    const newAvgScore =
      matchingScores.reduce((sum, s) => sum + s.score, 0) / matchingScores.length
    const newSampleSize = knowledge.sampleSize + matchingScores.length

    // Weighted moving average
    const weightedRate =
      (knowledge.successRate * knowledge.sampleSize + newAvgScore * matchingScores.length) /
      newSampleSize

    await prisma.agentKnowledge.update({
      where: { id: knowledge.id },
      data: {
        successRate: weightedRate,
        sampleSize: newSampleSize,
      },
    })
  }

  // 4. Pattern detection
  const patterns: string[] = []
  const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length
  const avgMessages = scores.reduce((sum, s) => sum + s.messageCount, 0) / scores.length

  // Check if shorter conversations perform better
  const shortConvs = scores.filter((s) => s.messageCount <= avgMessages)
  const longConvs = scores.filter((s) => s.messageCount > avgMessages)
  if (shortConvs.length > 0 && longConvs.length > 0) {
    const shortAvg = shortConvs.reduce((sum, s) => sum + s.score, 0) / shortConvs.length
    const longAvg = longConvs.reduce((sum, s) => sum + s.score, 0) / longConvs.length
    if (shortAvg > longAvg * 1.2) {
      patterns.push(
        `Shorter conversations (≤${Math.round(avgMessages)} messages) score ${Math.round((shortAvg / longAvg - 1) * 100)}% higher than longer ones.`,
      )
    }
  }

  // 5. A/B test results
  const abTestResults: Record<string, { avgScoreA: number; avgScoreB: number; countA: number; countB: number }> = {}
  const activeTests = await prisma.aBTestVariant.findMany({
    where: { isActive: true },
  })

  for (const test of activeTests) {
    const variantAScores = scores.filter((s) =>
      s.skillPackSlugs.includes(test.skillPackSlugA) && !s.skillPackSlugs.includes(test.skillPackSlugB),
    )
    const variantBScores = scores.filter((s) =>
      s.skillPackSlugs.includes(test.skillPackSlugB),
    )

    abTestResults[test.id] = {
      avgScoreA: variantAScores.length > 0
        ? variantAScores.reduce((sum, s) => sum + s.score, 0) / variantAScores.length
        : 0,
      avgScoreB: variantBScores.length > 0
        ? variantBScores.reduce((sum, s) => sum + s.score, 0) / variantBScores.length
        : 0,
      countA: variantAScores.length,
      countB: variantBScores.length,
    }
  }

  return {
    skillPackPerformance,
    patterns,
    abTestResults,
    topConversationIds,
    bottomConversationIds,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/self-improvement/analyzer.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/self-improvement/analyzer.ts __tests__/lib/self-improvement/analyzer.test.ts
git commit -m "feat(self-improvement): add analyzer agent with pattern detection and knowledge updates"
```

---

## Task 5: Proposer Agent

**Files:**
- Create: `__tests__/lib/self-improvement/proposer.test.ts`
- Create: `lib/self-improvement/proposer.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/self-improvement/proposer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AnalysisResult } from '@/lib/self-improvement/types'

const mockGatewayCall = vi.fn()
const mockMessageFindMany = vi.fn()
const mockProposalCreate = vi.fn()
const mockKnowledgeFindMany = vi.fn()
const mockSkillPackFindMany = vi.fn()

vi.mock('@/lib/llm/gateway', () => ({
  gateway: { call: (...args: unknown[]) => mockGatewayCall(...args) },
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    message: { findMany: (...args: unknown[]) => mockMessageFindMany(...args) },
    improvementProposal: { create: (...args: unknown[]) => mockProposalCreate(...args) },
    agentKnowledge: { findMany: (...args: unknown[]) => mockKnowledgeFindMany(...args) },
    skillPack: { findMany: (...args: unknown[]) => mockSkillPackFindMany(...args) },
  },
}))

const { generateProposals } = await import('@/lib/self-improvement/proposer')

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    skillPackPerformance: { discovery: { avgScore: 0.6, count: 10 } },
    patterns: ['Short conversations convert better'],
    abTestResults: {},
    topConversationIds: ['c1', 'c2'],
    bottomConversationIds: ['c3', 'c4'],
    ...overrides,
  }
}

describe('generateProposals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockKnowledgeFindMany.mockResolvedValue([])
    mockSkillPackFindMany.mockResolvedValue([])
    mockMessageFindMany.mockResolvedValue([
      { role: 'user', content: 'Hello', conversationId: 'c1' },
      { role: 'assistant', content: 'Hi there', conversationId: 'c1' },
    ])
  })

  it('creates proposals from valid LLM response', async () => {
    const llmResponse = {
      content: JSON.stringify({
        proposals: [
          {
            type: 'KNOWLEDGE_CREATE',
            title: 'New objection response for price concern',
            description: 'Customers respond well to daily cost comparison',
            diff: { create: { category: 'OBJECTION_RESPONSE', trigger: 'too expensive', content: 'Compare to daily coffee cost' } },
            confidence: 0.8,
          },
        ],
      }),
      usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
    }
    mockGatewayCall.mockResolvedValue(llmResponse)
    mockProposalCreate.mockResolvedValue({ id: 'p1' })

    const result = await generateProposals(makeAnalysis())

    expect(result).toBe(1)
    expect(mockProposalCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'KNOWLEDGE_CREATE',
        title: 'New objection response for price concern',
        status: 'PENDING',
      }),
    })
  })

  it('creates zero proposals when LLM returns malformed JSON', async () => {
    mockGatewayCall.mockResolvedValue({
      content: 'This is not valid JSON at all',
      usage: { promptTokens: 500, completionTokens: 50, totalTokens: 550 },
    })

    const result = await generateProposals(makeAnalysis())

    expect(result).toBe(0)
    expect(mockProposalCreate).not.toHaveBeenCalled()
  })

  it('skips proposals with missing required fields', async () => {
    const llmResponse = {
      content: JSON.stringify({
        proposals: [
          { type: 'KNOWLEDGE_CREATE', title: 'Good proposal', description: 'Valid', diff: { create: { category: 'OBJECTION_RESPONSE', trigger: 'x', content: 'y' } }, confidence: 0.8 },
          { type: 'INSIGHT', description: 'Missing title field', diff: {}, confidence: 0.5 },
        ],
      }),
      usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
    }
    mockGatewayCall.mockResolvedValue(llmResponse)
    mockProposalCreate.mockResolvedValue({ id: 'p1' })

    const result = await generateProposals(makeAnalysis())

    expect(result).toBe(1) // only the valid one
  })

  it('skips entirely when no conversations to analyze', async () => {
    const analysis = makeAnalysis({ topConversationIds: [], bottomConversationIds: [] })

    const result = await generateProposals(analysis)

    expect(result).toBe(0)
    expect(mockGatewayCall).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/self-improvement/proposer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the proposer**

Create `lib/self-improvement/proposer.ts`:

```typescript
/**
 * Proposer Agent — generates improvement proposals by analyzing
 * top/bottom conversation transcripts via the LLM.
 */

import { prisma } from '@/lib/db'
import { gateway } from '@/lib/llm/gateway'
import { logError, logInfo } from '@/lib/errors/logger'
import type { AnalysisResult, ProposalDiff } from './types'

const PROPOSER_AGENT_SLUG = 'main-chat' // Uses the same LLM provider as sales agent

interface LLMProposal {
  type: string
  title: string
  description: string
  diff: ProposalDiff
  confidence: number
}

interface LLMProposalResponse {
  proposals: LLMProposal[]
}

const VALID_TYPES = new Set(['KNOWLEDGE_CREATE', 'KNOWLEDGE_UPDATE', 'SKILLPACK_UPDATE', 'INSIGHT'])

function isValidProposal(p: unknown): p is LLMProposal {
  if (typeof p !== 'object' || p === null) return false
  const obj = p as Record<string, unknown>
  return (
    typeof obj.type === 'string' &&
    VALID_TYPES.has(obj.type) &&
    typeof obj.title === 'string' &&
    obj.title.length > 0 &&
    typeof obj.description === 'string' &&
    typeof obj.diff === 'object' &&
    obj.diff !== null &&
    typeof obj.confidence === 'number'
  )
}

export async function generateProposals(analysis: AnalysisResult): Promise<number> {
  const allConvIds = [...analysis.topConversationIds, ...analysis.bottomConversationIds]
  if (allConvIds.length === 0) return 0

  // Load conversation transcripts
  const messages = await prisma.message.findMany({
    where: { conversationId: { in: allConvIds } },
    orderBy: { createdAt: 'asc' },
    select: { conversationId: true, role: true, content: true },
  })

  // Group messages by conversation
  const transcripts: Record<string, { role: string; content: string }[]> = {}
  for (const m of messages) {
    ;(transcripts[m.conversationId] ??= []).push({ role: m.role, content: m.content })
  }

  // Load current knowledge and skill packs for context
  const currentKnowledge = await prisma.agentKnowledge.findMany({
    where: { isActive: true },
    select: { category: true, trigger: true, content: true, successRate: true, sampleSize: true },
  })

  const currentSkillPacks = await prisma.skillPack.findMany({
    where: { isActive: true },
    select: { slug: true, name: true, promptSections: true, constraints: true },
  })

  // Build prompt
  const topTranscripts = analysis.topConversationIds
    .map((id) => `### Conversation ${id} (HIGH SCORE)\n${formatTranscript(transcripts[id] ?? [])}`)
    .join('\n\n')

  const bottomTranscripts = analysis.bottomConversationIds
    .map((id) => `### Conversation ${id} (LOW SCORE)\n${formatTranscript(transcripts[id] ?? [])}`)
    .join('\n\n')

  const prompt = `You are an AI sales coach analyzing conversation performance for a life insurance sales agent (Zeno).

## Analysis Summary
- Skill pack performance: ${JSON.stringify(analysis.skillPackPerformance)}
- Patterns detected: ${analysis.patterns.join('; ') || 'None'}

## Top Performing Conversations
${topTranscripts}

## Bottom Performing Conversations
${bottomTranscripts}

## Current Agent Knowledge (${currentKnowledge.length} entries)
${JSON.stringify(currentKnowledge.slice(0, 20), null, 2)}

## Current Skill Packs (${currentSkillPacks.length} active)
${currentSkillPacks.map((sp) => `- ${sp.slug}: ${sp.name}`).join('\n')}

## Your Task
Analyze the differences between high and low performing conversations. Generate specific, actionable improvement proposals.

Respond with ONLY valid JSON in this exact format:
{
  "proposals": [
    {
      "type": "KNOWLEDGE_CREATE | KNOWLEDGE_UPDATE | SKILLPACK_UPDATE | INSIGHT",
      "title": "Short description",
      "description": "Detailed explanation with evidence from the conversations",
      "diff": {
        "create": { "category": "OBJECTION_RESPONSE", "trigger": "pattern", "content": "response text" }
      },
      "confidence": 0.0-1.0
    }
  ]
}

For KNOWLEDGE_CREATE: diff.create = { category, trigger, content, productId?, workflowStepCode? }
For KNOWLEDGE_UPDATE: diff.update = { knowledgeId, before: {}, after: {} }
For SKILLPACK_UPDATE: diff.skillPackUpdate = { skillPackSlug, sectionKey, before, after }
For INSIGHT: diff.insight = { observation }

Generate 1-5 proposals. Only propose changes you are confident about (>0.6).`

  // Call LLM
  let response
  try {
    response = await gateway.call(PROPOSER_AGENT_SLUG, {
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      maxTokens: 4000,
    })
  } catch (err) {
    logError({
      layer: 'self-improvement',
      category: 'proposer',
      message: 'LLM call failed',
      error: err,
    })
    return 0
  }

  // Parse response
  const content = typeof response.content === 'string' ? response.content : ''
  let parsed: LLMProposalResponse
  try {
    // Handle potential markdown code blocks
    const jsonStr = content.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim()
    parsed = JSON.parse(jsonStr) as LLMProposalResponse
  } catch {
    logError({
      layer: 'self-improvement',
      category: 'proposer',
      message: 'Failed to parse LLM response as JSON',
      context: { responseLength: content.length },
    })
    return 0
  }

  if (!Array.isArray(parsed.proposals)) return 0

  // Create valid proposals
  let created = 0
  for (const proposal of parsed.proposals) {
    if (!isValidProposal(proposal)) continue

    await prisma.improvementProposal.create({
      data: {
        type: proposal.type as 'KNOWLEDGE_CREATE' | 'KNOWLEDGE_UPDATE' | 'SKILLPACK_UPDATE' | 'INSIGHT',
        title: proposal.title,
        description: proposal.description,
        diff: proposal.diff as Record<string, unknown>,
        evidence: {
          conversationIds: allConvIds,
          sampleSize: allConvIds.length,
          confidence: proposal.confidence,
        },
        status: 'PENDING',
      },
    })
    created++
  }

  logInfo({
    layer: 'self-improvement',
    category: 'proposer',
    message: `Generated ${created} proposals from ${allConvIds.length} conversations`,
  })

  return created
}

function formatTranscript(messages: { role: string; content: string }[]): string {
  return messages
    .map((m) => `**${m.role}:** ${m.content.slice(0, 500)}`)
    .join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/self-improvement/proposer.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/self-improvement/proposer.ts __tests__/lib/self-improvement/proposer.test.ts
git commit -m "feat(self-improvement): add proposer agent with LLM-powered proposal generation"
```

---

## Task 6: Tracker Agent

**Files:**
- Create: `__tests__/lib/self-improvement/tracker.test.ts`
- Create: `lib/self-improvement/tracker.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/self-improvement/tracker.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockProposalFindMany = vi.fn()
const mockProposalCreate = vi.fn()
const mockScoreAggregate = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    improvementProposal: {
      findMany: (...args: unknown[]) => mockProposalFindMany(...args),
      create: (...args: unknown[]) => mockProposalCreate(...args),
    },
    conversationScore: {
      aggregate: (...args: unknown[]) => mockScoreAggregate(...args),
      count: vi.fn().mockResolvedValue(50),
    },
  },
}))

const { trackAdoptedProposals } = await import('@/lib/self-improvement/tracker')

describe('trackAdoptedProposals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects regression when score drops >10%', async () => {
    mockProposalFindMany.mockResolvedValue([
      {
        id: 'p1',
        type: 'KNOWLEDGE_UPDATE',
        title: 'Updated objection response',
        appliedAt: new Date('2026-04-01'),
        baselineMetrics: { avgScore: 0.7, sampleSize: 20 },
        diff: { update: { knowledgeId: 'k1' } },
      },
    ])
    // Post-adoption average is 0.5 — a >10% drop from 0.7
    mockScoreAggregate.mockResolvedValue({ _avg: { score: 0.5 }, _count: { score: 40 } })
    mockProposalCreate.mockResolvedValue({ id: 'p-regression' })

    const result = await trackAdoptedProposals()

    expect(result).toBe(1)
    expect(mockProposalCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'INSIGHT',
        title: expect.stringContaining('Regression'),
        status: 'PENDING',
      }),
    })
  })

  it('skips proposals with insufficient post-adoption data', async () => {
    mockProposalFindMany.mockResolvedValue([
      {
        id: 'p2',
        type: 'SKILLPACK_UPDATE',
        title: 'Updated discovery pack',
        appliedAt: new Date(),
        baselineMetrics: { avgScore: 0.6, sampleSize: 15 },
        diff: { skillPackUpdate: { skillPackSlug: 'discovery' } },
      },
    ])
    // Only 10 conversations since adoption — below 30 threshold
    mockScoreAggregate.mockResolvedValue({ _avg: { score: 0.3 }, _count: { score: 10 } })

    const result = await trackAdoptedProposals()

    expect(result).toBe(0)
    expect(mockProposalCreate).not.toHaveBeenCalled()
  })

  it('does not flag when score is stable', async () => {
    mockProposalFindMany.mockResolvedValue([
      {
        id: 'p3',
        type: 'KNOWLEDGE_CREATE',
        title: 'New pattern',
        appliedAt: new Date('2026-04-01'),
        baselineMetrics: { avgScore: 0.6, sampleSize: 20 },
        diff: { create: { category: 'OBJECTION_RESPONSE', trigger: 'x', content: 'y' } },
      },
    ])
    // Score is 0.58 — only ~3% drop, within 10% threshold
    mockScoreAggregate.mockResolvedValue({ _avg: { score: 0.58 }, _count: { score: 35 } })

    const result = await trackAdoptedProposals()

    expect(result).toBe(0)
    expect(mockProposalCreate).not.toHaveBeenCalled()
  })

  it('returns 0 when no approved proposals exist', async () => {
    mockProposalFindMany.mockResolvedValue([])

    const result = await trackAdoptedProposals()

    expect(result).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/self-improvement/tracker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tracker**

Create `lib/self-improvement/tracker.ts`:

```typescript
/**
 * Tracker Agent — monitors adopted proposals for performance regressions.
 *
 * For each approved + applied proposal, compares post-adoption average score
 * against baseline. Flags regressions (>10% drop) as INSIGHT proposals.
 */

import { prisma } from '@/lib/db'
import { logInfo } from '@/lib/errors/logger'

const MIN_POST_ADOPTION_CONVERSATIONS = 30
const REGRESSION_THRESHOLD = 0.10 // 10% drop

export async function trackAdoptedProposals(): Promise<number> {
  const adoptedProposals = await prisma.improvementProposal.findMany({
    where: {
      status: 'APPROVED',
      appliedAt: { not: null },
      baselineMetrics: { not: null },
    },
  })

  if (adoptedProposals.length === 0) return 0

  let regressions = 0

  for (const proposal of adoptedProposals) {
    const baseline = proposal.baselineMetrics as {
      avgScore: number
      sampleSize: number
    }
    if (!baseline?.avgScore) continue

    // Get post-adoption score aggregate
    const postAdoption = await prisma.conversationScore.aggregate({
      where: {
        scoredAt: { gte: proposal.appliedAt! },
      },
      _avg: { score: true },
      _count: { score: true },
    })

    const postCount = postAdoption._count.score
    const postAvg = postAdoption._avg.score

    // Skip if insufficient data
    if (postCount < MIN_POST_ADOPTION_CONVERSATIONS) continue
    if (postAvg === null) continue

    // Check for regression
    const dropPct = (baseline.avgScore - postAvg) / baseline.avgScore
    if (dropPct > REGRESSION_THRESHOLD) {
      await prisma.improvementProposal.create({
        data: {
          type: 'INSIGHT',
          title: `Regression detected: "${proposal.title}"`,
          description:
            `Score dropped ${Math.round(dropPct * 100)}% after adopting "${proposal.title}" ` +
            `(baseline: ${baseline.avgScore.toFixed(3)}, current: ${postAvg.toFixed(3)}, ` +
            `sample: ${postCount} conversations). Consider reverting this change.`,
          diff: { insight: { observation: `Regression from proposal ${proposal.id}` } },
          evidence: {
            conversationIds: [],
            sampleSize: postCount,
            confidence: Math.min(postCount / 100, 1.0),
          },
          status: 'PENDING',
        },
      })
      regressions++
    }
  }

  logInfo({
    layer: 'self-improvement',
    category: 'tracker',
    message: `Tracked ${adoptedProposals.length} proposals, found ${regressions} regressions`,
  })

  return regressions
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/self-improvement/tracker.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/self-improvement/tracker.ts __tests__/lib/self-improvement/tracker.test.ts
git commit -m "feat(self-improvement): add tracker agent with regression detection"
```

---

## Task 7: Batch Runner

**Files:**
- Create: `__tests__/lib/self-improvement/batch-runner.test.ts`
- Create: `lib/self-improvement/batch-runner.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/self-improvement/batch-runner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockScoreConversations = vi.fn()
const mockAnalyzeScores = vi.fn()
const mockGenerateProposals = vi.fn()
const mockTrackAdoptedProposals = vi.fn()

vi.mock('@/lib/self-improvement/scorer', () => ({
  scoreConversations: (...args: unknown[]) => mockScoreConversations(...args),
}))
vi.mock('@/lib/self-improvement/analyzer', () => ({
  analyzeScores: (...args: unknown[]) => mockAnalyzeScores(...args),
}))
vi.mock('@/lib/self-improvement/proposer', () => ({
  generateProposals: (...args: unknown[]) => mockGenerateProposals(...args),
}))
vi.mock('@/lib/self-improvement/tracker', () => ({
  trackAdoptedProposals: (...args: unknown[]) => mockTrackAdoptedProposals(...args),
}))

const { runDailyBatch } = await import('@/lib/self-improvement/batch-runner')

describe('runDailyBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs all 4 agents sequentially and returns SUCCESS', async () => {
    const analysis = { skillPackPerformance: {}, patterns: [], abTestResults: {}, topConversationIds: ['c1'], bottomConversationIds: ['c2'] }
    mockScoreConversations.mockResolvedValue(5)
    mockAnalyzeScores.mockResolvedValue(analysis)
    mockGenerateProposals.mockResolvedValue(2)
    mockTrackAdoptedProposals.mockResolvedValue(0)

    const result = await runDailyBatch()

    expect(result.status).toBe('SUCCESS')
    expect(result.scored).toBe(5)
    expect(result.analysisComplete).toBe(true)
    expect(result.proposalsGenerated).toBe(2)
    expect(result.regressionsDetected).toBe(0)
    expect(mockScoreConversations).toHaveBeenCalledBefore(mockAnalyzeScores)
    expect(mockAnalyzeScores).toHaveBeenCalledBefore(mockGenerateProposals)
    expect(mockGenerateProposals).toHaveBeenCalledBefore(mockTrackAdoptedProposals)
  })

  it('returns PARTIAL when analyzer fails but scorer succeeds', async () => {
    mockScoreConversations.mockResolvedValue(3)
    mockAnalyzeScores.mockRejectedValue(new Error('DB connection lost'))

    const result = await runDailyBatch()

    expect(result.status).toBe('PARTIAL')
    expect(result.scored).toBe(3)
    expect(result.analysisComplete).toBe(false)
    expect(result.proposalsGenerated).toBe(0)
    expect(result.error).toContain('DB connection lost')
    expect(mockGenerateProposals).not.toHaveBeenCalled()
  })

  it('returns FAILED when scorer fails', async () => {
    mockScoreConversations.mockRejectedValue(new Error('Scorer crashed'))

    const result = await runDailyBatch()

    expect(result.status).toBe('FAILED')
    expect(result.scored).toBe(0)
    expect(result.error).toContain('Scorer crashed')
    expect(mockAnalyzeScores).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/self-improvement/batch-runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the batch runner**

Create `lib/self-improvement/batch-runner.ts`:

```typescript
/**
 * Batch Runner — orchestrates the 4-agent self-improvement pipeline.
 *
 * Scorer → Analyzer → Proposer → Tracker
 *
 * Each agent is wrapped in try/catch. If an agent fails,
 * subsequent agents do not run, but prior results are preserved.
 */

import { logError, logInfo } from '@/lib/errors/logger'
import { scoreConversations } from './scorer'
import { analyzeScores } from './analyzer'
import { generateProposals } from './proposer'
import { trackAdoptedProposals } from './tracker'
import type { BatchResult } from './types'

let isRunning = false

export async function runDailyBatch(): Promise<BatchResult> {
  if (isRunning) {
    return {
      startedAt: new Date(),
      completedAt: new Date(),
      status: 'FAILED',
      scored: 0,
      analysisComplete: false,
      proposalsGenerated: 0,
      regressionsDetected: 0,
      error: 'Batch is already running',
    }
  }

  isRunning = true
  const startedAt = new Date()
  const result: BatchResult = {
    startedAt,
    completedAt: startedAt,
    status: 'SUCCESS',
    scored: 0,
    analysisComplete: false,
    proposalsGenerated: 0,
    regressionsDetected: 0,
  }

  try {
    // 1. Scorer
    logInfo({ layer: 'self-improvement', category: 'batch', message: 'Starting scorer...' })
    result.scored = await scoreConversations()

    // 2. Analyzer
    logInfo({ layer: 'self-improvement', category: 'batch', message: 'Starting analyzer...' })
    const analysis = await analyzeScores()
    result.analysisComplete = true

    // 3. Proposer
    logInfo({ layer: 'self-improvement', category: 'batch', message: 'Starting proposer...' })
    result.proposalsGenerated = await generateProposals(analysis)

    // 4. Tracker
    logInfo({ layer: 'self-improvement', category: 'batch', message: 'Starting tracker...' })
    result.regressionsDetected = await trackAdoptedProposals()

    result.status = 'SUCCESS'
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    result.error = errorMsg
    result.status = result.scored > 0 ? 'PARTIAL' : 'FAILED'

    logError({
      layer: 'self-improvement',
      category: 'batch',
      message: `Batch ${result.status}: ${errorMsg}`,
      error: err,
    })
  } finally {
    result.completedAt = new Date()
    isRunning = false

    logInfo({
      layer: 'self-improvement',
      category: 'batch',
      message: `Batch completed: ${result.status} — scored=${result.scored}, proposals=${result.proposalsGenerated}, regressions=${result.regressionsDetected}`,
    })
  }

  return result
}

export function isBatchRunning(): boolean {
  return isRunning
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/self-improvement/batch-runner.test.ts`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/self-improvement/batch-runner.ts __tests__/lib/self-improvement/batch-runner.test.ts
git commit -m "feat(self-improvement): add batch runner orchestrating scorer→analyzer→proposer→tracker"
```

---

## Task 8: Proposals API Routes

**Files:**
- Create: `app/api/admin/proposals/route.ts`
- Create: `app/api/admin/proposals/[id]/route.ts`
- Create: `app/api/admin/proposals/[id]/approve/route.ts`
- Create: `app/api/admin/proposals/[id]/reject/route.ts`

- [ ] **Step 1: Create proposals list route**

Create `app/api/admin/proposals/route.ts`:

```typescript
/**
 * GET /api/admin/proposals
 *
 * List improvement proposals, filterable by status.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    const proposals = await prisma.improvementProposal.findMany({
      where: status ? { status: status as 'PENDING' | 'APPROVED' | 'REJECTED' } : undefined,
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(proposals)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Create proposal detail route**

Create `app/api/admin/proposals/[id]/route.ts`:

```typescript
/**
 * GET /api/admin/proposals/:id
 *
 * Get proposal detail.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const proposal = await prisma.improvementProposal.findUnique({ where: { id } })
    if (!proposal) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json(proposal)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Create approve route with apply logic**

Create `app/api/admin/proposals/[id]/approve/route.ts`:

```typescript
/**
 * POST /api/admin/proposals/:id/approve
 *
 * Approve a proposal and apply the underlying change.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { flushSkillPackCache } from '@/lib/skills/skill-pack-loader'
import type { ProposalDiff } from '@/lib/self-improvement/types'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const proposal = await prisma.improvementProposal.findUnique({ where: { id } })
    if (!proposal) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (proposal.status !== 'PENDING') {
      return NextResponse.json({ error: 'Proposal is not pending' }, { status: 400 })
    }

    const diff = proposal.diff as ProposalDiff

    // Compute baseline metrics before applying
    let baselineMetrics: Record<string, unknown> = {}

    // Apply the change based on type
    switch (proposal.type) {
      case 'KNOWLEDGE_CREATE': {
        if (!diff.create) {
          return NextResponse.json({ error: 'Invalid diff for KNOWLEDGE_CREATE' }, { status: 400 })
        }
        // Baseline: average score for matching context
        const avgResult = await prisma.conversationScore.aggregate({
          _avg: { score: true },
          _count: { score: true },
        })
        baselineMetrics = {
          avgScore: avgResult._avg.score ?? 0,
          sampleSize: avgResult._count.score,
        }

        await prisma.agentKnowledge.create({
          data: {
            category: diff.create.category as 'OBJECTION_RESPONSE' | 'TOOL_SEQUENCE' | 'CONVERSATION_PATTERN' | 'PROMPT_FRAGMENT',
            trigger: diff.create.trigger,
            content: diff.create.content,
            productId: diff.create.productId ?? null,
            workflowStepCode: diff.create.workflowStepCode ?? null,
            successRate: 0,
            sampleSize: 0,
            isActive: true,
          },
        })
        break
      }

      case 'KNOWLEDGE_UPDATE': {
        if (!diff.update) {
          return NextResponse.json({ error: 'Invalid diff for KNOWLEDGE_UPDATE' }, { status: 400 })
        }
        const existing = await prisma.agentKnowledge.findUnique({
          where: { id: diff.update.knowledgeId },
        })
        if (!existing) {
          return NextResponse.json({ error: 'Knowledge entry not found' }, { status: 404 })
        }
        baselineMetrics = {
          avgScore: existing.successRate,
          sampleSize: existing.sampleSize,
        }

        await prisma.agentKnowledge.update({
          where: { id: diff.update.knowledgeId },
          data: diff.update.after as Record<string, unknown>,
        })
        break
      }

      case 'SKILLPACK_UPDATE': {
        if (!diff.skillPackUpdate) {
          return NextResponse.json({ error: 'Invalid diff for SKILLPACK_UPDATE' }, { status: 400 })
        }
        const pack = await prisma.skillPack.findUnique({
          where: { slug: diff.skillPackUpdate.skillPackSlug },
        })
        if (!pack) {
          return NextResponse.json({ error: 'Skill pack not found' }, { status: 404 })
        }

        // Baseline: average score for conversations using this skill pack
        const packScores = await prisma.conversationScore.aggregate({
          where: { skillPackSlugs: { has: pack.slug } },
          _avg: { score: true },
          _count: { score: true },
        })
        baselineMetrics = {
          avgScore: packScores._avg.score ?? 0,
          sampleSize: packScores._count.score,
        }

        const sections = pack.promptSections as Record<string, string>
        sections[diff.skillPackUpdate.sectionKey] = diff.skillPackUpdate.after

        await prisma.skillPack.update({
          where: { slug: diff.skillPackUpdate.skillPackSlug },
          data: { promptSections: sections },
        })
        flushSkillPackCache()
        break
      }

      case 'INSIGHT':
        // Insights have no apply action — just mark as approved
        break
    }

    // Mark proposal as approved
    await prisma.improvementProposal.update({
      where: { id },
      data: {
        status: 'APPROVED',
        appliedAt: new Date(),
        baselineMetrics,
      },
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Create reject route**

Create `app/api/admin/proposals/[id]/reject/route.ts`:

```typescript
/**
 * POST /api/admin/proposals/:id/reject
 *
 * Reject a proposal with optional notes.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const proposal = await prisma.improvementProposal.findUnique({ where: { id } })
    if (!proposal) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (proposal.status !== 'PENDING') {
      return NextResponse.json({ error: 'Proposal is not pending' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const { notes } = body as { notes?: string }

    await prisma.improvementProposal.update({
      where: { id },
      data: {
        status: 'REJECTED',
        adminNotes: notes ?? null,
      },
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/proposals/
git commit -m "feat(api): add proposals CRUD with approve/reject and apply logic"
```

---

## Task 9: A/B Tests API Routes

**Files:**
- Create: `app/api/admin/ab-tests/route.ts`
- Create: `app/api/admin/ab-tests/[id]/end/route.ts`
- Create: `app/api/admin/ab-tests/[id]/results/route.ts`

- [ ] **Step 1: Create A/B tests list + create route**

Create `app/api/admin/ab-tests/route.ts`:

```typescript
/**
 * GET /api/admin/ab-tests — list all tests
 * POST /api/admin/ab-tests — create a new test
 *
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const tests = await prisma.aBTestVariant.findMany({
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(tests)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { name, skillPackSlugA, skillPackSlugB, splitRatio } = body as {
      name?: string
      skillPackSlugA?: string
      skillPackSlugB?: string
      splitRatio?: number
    }

    if (!name || !skillPackSlugA || !skillPackSlugB || splitRatio === undefined) {
      return NextResponse.json({ error: 'name, skillPackSlugA, skillPackSlugB, and splitRatio are required' }, { status: 400 })
    }

    if (splitRatio < 0 || splitRatio > 1) {
      return NextResponse.json({ error: 'splitRatio must be between 0 and 1' }, { status: 400 })
    }

    // Verify both skill packs exist
    const [packA, packB] = await Promise.all([
      prisma.skillPack.findUnique({ where: { slug: skillPackSlugA } }),
      prisma.skillPack.findUnique({ where: { slug: skillPackSlugB } }),
    ])

    if (!packA) return NextResponse.json({ error: `Skill pack "${skillPackSlugA}" not found` }, { status: 404 })
    if (!packB) return NextResponse.json({ error: `Skill pack "${skillPackSlugB}" not found` }, { status: 404 })

    const test = await prisma.aBTestVariant.create({
      data: { name, skillPackSlugA, skillPackSlugB, splitRatio, isActive: true },
    })

    return NextResponse.json(test, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Create end test route**

Create `app/api/admin/ab-tests/[id]/end/route.ts`:

```typescript
/**
 * POST /api/admin/ab-tests/:id/end
 *
 * End an active A/B test.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const test = await prisma.aBTestVariant.findUnique({ where: { id } })
    if (!test) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!test.isActive) return NextResponse.json({ error: 'Test is already ended' }, { status: 400 })

    await prisma.aBTestVariant.update({
      where: { id },
      data: { isActive: false, endedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Create results route**

Create `app/api/admin/ab-tests/[id]/results/route.ts`:

```typescript
/**
 * GET /api/admin/ab-tests/:id/results
 *
 * Get A/B test results with score comparison.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const test = await prisma.aBTestVariant.findUnique({ where: { id } })
    if (!test) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Get scores for each variant
    const [variantA, variantB] = await Promise.all([
      prisma.conversationScore.aggregate({
        where: {
          skillPackSlugs: { has: test.skillPackSlugA },
          scoredAt: { gte: test.startedAt },
        },
        _avg: { score: true },
        _count: { score: true },
      }),
      prisma.conversationScore.aggregate({
        where: {
          skillPackSlugs: { has: test.skillPackSlugB },
          scoredAt: { gte: test.startedAt },
        },
        _avg: { score: true },
        _count: { score: true },
      }),
    ])

    const minSample = 30
    const hasEnoughData = variantA._count.score >= minSample && variantB._count.score >= minSample

    return NextResponse.json({
      test,
      results: {
        variantA: {
          slug: test.skillPackSlugA,
          avgScore: variantA._avg.score ?? 0,
          count: variantA._count.score,
        },
        variantB: {
          slug: test.skillPackSlugB,
          avgScore: variantB._avg.score ?? 0,
          count: variantB._count.score,
        },
        hasEnoughData,
        winner: hasEnoughData
          ? (variantA._avg.score ?? 0) >= (variantB._avg.score ?? 0)
            ? 'A'
            : 'B'
          : null,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/ab-tests/
git commit -m "feat(api): add A/B test CRUD with results comparison"
```

---

## Task 10: Self-Improvement Dashboard API + Batch Trigger

**Files:**
- Create: `app/api/admin/self-improvement/route.ts`

- [ ] **Step 1: Create dashboard + batch trigger route**

Create `app/api/admin/self-improvement/route.ts`:

```typescript
/**
 * GET /api/admin/self-improvement — dashboard stats
 * POST /api/admin/self-improvement — trigger batch run
 *
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { runDailyBatch, isBatchRunning } from '@/lib/self-improvement/batch-runner'

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [
      totalScored,
      recentScores,
      proposalCounts,
      topSkillPacks,
      lowKnowledge,
      activeRegressions,
    ] = await Promise.all([
      // Total scored conversations
      prisma.conversationScore.count(),

      // 7-day rolling scores for trend
      prisma.conversationScore.findMany({
        where: { scoredAt: { gte: sevenDaysAgo } },
        select: { score: true, scoredAt: true },
        orderBy: { scoredAt: 'asc' },
      }),

      // Proposal counts by status
      prisma.improvementProposal.groupBy({
        by: ['status'],
        _count: { id: true },
      }),

      // Top skill packs by average score
      prisma.conversationScore.groupBy({
        by: ['skillPackSlugs'],
        _avg: { score: true },
        _count: { _all: true },
        orderBy: { _avg: { score: 'desc' } },
        take: 5,
      }),

      // Low performing knowledge entries
      prisma.agentKnowledge.findMany({
        where: { isActive: true, sampleSize: { gte: 10 } },
        orderBy: { successRate: 'asc' },
        take: 5,
        select: { id: true, category: true, trigger: true, successRate: true, sampleSize: true },
      }),

      // Active regression warnings
      prisma.improvementProposal.findMany({
        where: {
          type: 'INSIGHT',
          status: 'PENDING',
          title: { startsWith: 'Regression' },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ])

    // Compute 7-day average
    const avgScore7d = recentScores.length > 0
      ? recentScores.reduce((sum, s) => sum + s.score, 0) / recentScores.length
      : 0

    // Format proposal counts
    const proposals = { pending: 0, approved: 0, rejected: 0 }
    for (const g of proposalCounts) {
      proposals[g.status.toLowerCase() as 'pending' | 'approved' | 'rejected'] = g._count.id
    }

    return NextResponse.json({
      totalScored,
      avgScore7d,
      scoreCount7d: recentScores.length,
      proposals,
      topSkillPacks,
      lowKnowledge,
      activeRegressions,
      batchRunning: isBatchRunning(),
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (isBatchRunning()) {
      return NextResponse.json({ error: 'Batch is already running' }, { status: 409 })
    }

    // Run in background — don't block the response
    const batchPromise = runDailyBatch()

    // Return immediately, batch runs in background
    batchPromise.catch(() => {
      // Error already logged by batch runner
    })

    return NextResponse.json({ message: 'Batch started' }, { status: 202 })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/self-improvement/
git commit -m "feat(api): add self-improvement dashboard stats and batch trigger"
```

---

## Task 11: Proposals Admin Page

**Files:**
- Create: `app/admin/(protected)/proposals/page.tsx`
- Create: `components/admin/proposal-table.tsx`
- Create: `components/admin/proposal-detail.tsx`

- [ ] **Step 1: Create the proposal table client component**

Create `components/admin/proposal-table.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface ProposalData {
  id: string
  type: string
  title: string
  status: string
  evidence: { sampleSize: number; confidence: number }
  createdAt: string
}

interface ProposalTableProps {
  proposals: ProposalData[]
}

type StatusFilter = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'

const STATUS_TABS: StatusFilter[] = ['ALL', 'PENDING', 'APPROVED', 'REJECTED']

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-sage/10 text-forest',
  REJECTED: 'bg-red-100 text-red-700',
}

const TYPE_BADGE: Record<string, string> = {
  KNOWLEDGE_CREATE: 'bg-zeno-500/10 text-zeno-600',
  KNOWLEDGE_UPDATE: 'bg-blue-100 text-blue-700',
  SKILLPACK_UPDATE: 'bg-purple-100 text-purple-700',
  INSIGHT: 'bg-cloud-100 text-night',
}

export default function ProposalTable({ proposals }: ProposalTableProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<StatusFilter>('ALL')

  const visible =
    filter === 'ALL' ? proposals : proposals.filter((p) => p.status === filter)

  return (
    <div>
      {/* Status filter tabs */}
      <div className="mb-4 flex gap-1 rounded-lg border border-warm-border bg-cloud-50 p-1 w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === tab
                ? 'bg-white text-night shadow-sm'
                : 'text-muted hover:text-night'
            }`}
          >
            {tab === 'ALL' ? `All (${proposals.length})` : `${tab} (${proposals.filter((p) => p.status === tab).length})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-warm-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-warm-border bg-cloud-50">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Title</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Evidence</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Created</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-warm-border">
            {visible.map((p) => (
              <tr key={p.id} className="hover:bg-cloud-50 transition-colors">
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[p.type] ?? 'bg-cloud-100 text-night'}`}>
                    {p.type.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-night font-medium max-w-xs truncate">{p.title}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[p.status] ?? ''}`}>
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted text-xs">
                  {p.evidence.sampleSize} convs, {Math.round(p.evidence.confidence * 100)}%
                </td>
                <td className="px-4 py-3 text-muted text-xs">
                  {new Date(p.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => router.push(`/admin/proposals?detail=${p.id}`)}
                    className="rounded-md border border-warm-border px-3 py-1 text-xs font-medium text-night hover:bg-linen transition-colors"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
                  No proposals found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the proposal detail client component**

Create `components/admin/proposal-detail.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface ProposalFullData {
  id: string
  type: string
  title: string
  description: string
  diff: Record<string, unknown>
  evidence: { conversationIds: string[]; sampleSize: number; confidence: number }
  status: string
  adminNotes: string | null
  createdAt: string
}

interface ProposalDetailProps {
  proposal: ProposalFullData
}

export default function ProposalDetail({ proposal }: ProposalDetailProps) {
  const router = useRouter()
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleApprove() {
    setLoading(true)
    try {
      await fetch(`/api/admin/proposals/${proposal.id}/approve`, { method: 'POST' })
      router.push('/admin/proposals')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  async function handleReject() {
    setLoading(true)
    try {
      await fetch(`/api/admin/proposals/${proposal.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      router.push('/admin/proposals')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.push('/admin/proposals')}
        className="text-sm text-muted hover:text-night transition-colors"
      >
        &larr; Back to proposals
      </button>

      <div className="rounded-lg border border-warm-border bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-night">{proposal.title}</h3>
          <span className="rounded-full bg-cloud-100 px-2 py-0.5 text-xs font-medium text-night">
            {proposal.type.replace('_', ' ')}
          </span>
        </div>

        <p className="text-sm text-night whitespace-pre-wrap">{proposal.description}</p>

        {/* Evidence */}
        <div className="rounded-md bg-cloud-50 p-4">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted mb-2">Evidence</h4>
          <p className="text-sm text-night">
            Sample size: {proposal.evidence.sampleSize} conversations
            &mdash; Confidence: {Math.round(proposal.evidence.confidence * 100)}%
          </p>
        </div>

        {/* Diff */}
        <div className="rounded-md bg-cloud-50 p-4">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted mb-2">Proposed Change</h4>
          <pre className="text-xs text-night overflow-x-auto whitespace-pre-wrap font-mono">
            {JSON.stringify(proposal.diff, null, 2)}
          </pre>
        </div>

        {/* Actions (only for pending) */}
        {proposal.status === 'PENDING' && (
          <div className="space-y-3 border-t border-warm-border pt-4">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes (shown on rejection)..."
              className="w-full rounded-md border border-warm-border px-3 py-2 text-sm focus:border-zeno-500 focus:outline-none"
              rows={2}
            />
            <div className="flex gap-3">
              <button
                onClick={handleApprove}
                disabled={loading}
                className="rounded-md bg-forest px-4 py-2 text-sm font-medium text-soft-white hover:bg-forest/90 transition-colors disabled:opacity-50"
              >
                Approve &amp; Apply
              </button>
              <button
                onClick={handleReject}
                disabled={loading}
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        )}

        {/* Rejection notes */}
        {proposal.status === 'REJECTED' && proposal.adminNotes && (
          <div className="rounded-md bg-red-50 p-4">
            <h4 className="text-xs font-medium uppercase tracking-wide text-red-700 mb-1">Rejection Notes</h4>
            <p className="text-sm text-red-700">{proposal.adminNotes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create the proposals server page**

Create `app/admin/(protected)/proposals/page.tsx`:

```typescript
/**
 * Improvement Proposals Admin Page — ADMIN only
 *
 * Server component. Lists proposals or shows detail when ?detail=<id>.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import ProposalTable from '@/components/admin/proposal-table'
import ProposalDetail from '@/components/admin/proposal-detail'
import type { ProposalData } from '@/components/admin/proposal-table'
import type { ProposalFullData } from '@/components/admin/proposal-detail'

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ detail?: string }>
}) {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) redirect('/admin/login')
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') redirect('/admin')

  const { detail } = await searchParams

  // Detail mode
  if (detail) {
    const proposal = await prisma.improvementProposal.findUnique({ where: { id: detail } })
    if (!proposal) redirect('/admin/proposals')

    const proposalData: ProposalFullData = {
      id: proposal.id,
      type: proposal.type,
      title: proposal.title,
      description: proposal.description,
      diff: proposal.diff as Record<string, unknown>,
      evidence: proposal.evidence as { conversationIds: string[]; sampleSize: number; confidence: number },
      status: proposal.status,
      adminNotes: proposal.adminNotes,
      createdAt: proposal.createdAt.toISOString(),
    }

    return (
      <div>
        <h2 className="mb-6 text-xl font-medium text-night">Proposal Detail</h2>
        <ProposalDetail proposal={proposalData} />
      </div>
    )
  }

  // List mode
  const proposals = await prisma.improvementProposal.findMany({
    orderBy: { createdAt: 'desc' },
  })

  const proposalList: ProposalData[] = proposals.map((p) => ({
    id: p.id,
    type: p.type,
    title: p.title,
    status: p.status,
    evidence: p.evidence as { sampleSize: number; confidence: number },
    createdAt: p.createdAt.toISOString(),
  }))

  return (
    <div>
      <h2 className="mb-6 text-xl font-medium text-night">Improvement Proposals</h2>
      <ProposalTable proposals={proposalList} />
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add app/admin/(protected)/proposals/ components/admin/proposal-table.tsx components/admin/proposal-detail.tsx
git commit -m "feat(admin): add proposals queue page with table, detail, approve/reject UI"
```

---

## Task 12: A/B Tests Admin Page

**Files:**
- Create: `app/admin/(protected)/ab-tests/page.tsx`
- Create: `components/admin/ab-test-table.tsx`

- [ ] **Step 1: Create the A/B test table client component**

Create `components/admin/ab-test-table.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface ABTestData {
  id: string
  name: string
  skillPackSlugA: string
  skillPackSlugB: string
  splitRatio: number
  isActive: boolean
  conversationsA: number
  conversationsB: number
  startedAt: string
  endedAt: string | null
}

interface ABTestTableProps {
  tests: ABTestData[]
  skillPackSlugs: string[]
}

export default function ABTestTable({ tests, skillPackSlugs }: ABTestTableProps) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [ending, setEnding] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', skillPackSlugA: '', skillPackSlugB: '', splitRatio: '0.5' })

  async function handleCreate() {
    setCreating(true)
    try {
      await fetch('/api/admin/ab-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          splitRatio: parseFloat(form.splitRatio),
        }),
      })
      setForm({ name: '', skillPackSlugA: '', skillPackSlugB: '', splitRatio: '0.5' })
      router.refresh()
    } finally {
      setCreating(false)
    }
  }

  async function handleEnd(id: string) {
    setEnding(id)
    try {
      await fetch(`/api/admin/ab-tests/${id}/end`, { method: 'POST' })
      router.refresh()
    } finally {
      setEnding(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Create form */}
      <div className="rounded-lg border border-warm-border bg-white p-4 space-y-3">
        <h3 className="text-sm font-medium text-night">Create A/B Test</h3>
        <div className="grid grid-cols-2 gap-3">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Test name"
            className="rounded-md border border-warm-border px-3 py-2 text-sm focus:border-zeno-500 focus:outline-none"
          />
          <input
            value={form.splitRatio}
            onChange={(e) => setForm({ ...form, splitRatio: e.target.value })}
            placeholder="Split ratio (0-1)"
            type="number"
            min="0"
            max="1"
            step="0.1"
            className="rounded-md border border-warm-border px-3 py-2 text-sm focus:border-zeno-500 focus:outline-none"
          />
          <select
            value={form.skillPackSlugA}
            onChange={(e) => setForm({ ...form, skillPackSlugA: e.target.value })}
            className="rounded-md border border-warm-border px-3 py-2 text-sm focus:border-zeno-500 focus:outline-none"
          >
            <option value="">Control (A)</option>
            {skillPackSlugs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={form.skillPackSlugB}
            onChange={(e) => setForm({ ...form, skillPackSlugB: e.target.value })}
            className="rounded-md border border-warm-border px-3 py-2 text-sm focus:border-zeno-500 focus:outline-none"
          >
            <option value="">Variant (B)</option>
            {skillPackSlugs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating || !form.name || !form.skillPackSlugA || !form.skillPackSlugB}
          className="rounded-md bg-forest px-4 py-2 text-sm font-medium text-soft-white hover:bg-forest/90 transition-colors disabled:opacity-50"
        >
          Create Test
        </button>
      </div>

      {/* Tests table */}
      <div className="overflow-hidden rounded-lg border border-warm-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-warm-border bg-cloud-50">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">A vs B</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Split</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Conversations</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-warm-border">
            {tests.map((t) => (
              <tr key={t.id} className="hover:bg-cloud-50 transition-colors">
                <td className="px-4 py-3 text-night font-medium">{t.name}</td>
                <td className="px-4 py-3 text-xs">
                  <code className="rounded bg-cloud-100 px-1.5 py-0.5 font-mono">{t.skillPackSlugA}</code>
                  {' vs '}
                  <code className="rounded bg-cloud-100 px-1.5 py-0.5 font-mono">{t.skillPackSlugB}</code>
                </td>
                <td className="px-4 py-3 text-night">{Math.round(t.splitRatio * 100)}% B</td>
                <td className="px-4 py-3 text-muted text-xs">A: {t.conversationsA} / B: {t.conversationsB}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${t.isActive ? 'bg-sage/10 text-forest' : 'bg-cloud-100 text-muted'}`}>
                    {t.isActive ? 'Active' : 'Ended'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {t.isActive && (
                    <button
                      onClick={() => handleEnd(t.id)}
                      disabled={ending === t.id}
                      className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      End
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {tests.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
                  No A/B tests yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the A/B tests server page**

Create `app/admin/(protected)/ab-tests/page.tsx`:

```typescript
/**
 * A/B Tests Admin Page — ADMIN only
 *
 * Server component. Lists and creates A/B tests.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import ABTestTable from '@/components/admin/ab-test-table'
import type { ABTestData } from '@/components/admin/ab-test-table'

export default async function ABTestsPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) redirect('/admin/login')
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') redirect('/admin')

  const [tests, skillPacks] = await Promise.all([
    prisma.aBTestVariant.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.skillPack.findMany({ where: { isActive: true }, select: { slug: true }, orderBy: { slug: 'asc' } }),
  ])

  const testData: ABTestData[] = tests.map((t) => ({
    id: t.id,
    name: t.name,
    skillPackSlugA: t.skillPackSlugA,
    skillPackSlugB: t.skillPackSlugB,
    splitRatio: t.splitRatio,
    isActive: t.isActive,
    conversationsA: t.conversationsA,
    conversationsB: t.conversationsB,
    startedAt: t.startedAt.toISOString(),
    endedAt: t.endedAt?.toISOString() ?? null,
  }))

  return (
    <div>
      <h2 className="mb-6 text-xl font-medium text-night">A/B Tests</h2>
      <ABTestTable tests={testData} skillPackSlugs={skillPacks.map((p) => p.slug)} />
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/(protected)/ab-tests/ components/admin/ab-test-table.tsx
git commit -m "feat(admin): add A/B tests page with create, list, and end controls"
```

---

## Task 13: Self-Improvement Dashboard Page

**Files:**
- Create: `app/admin/(protected)/self-improvement/page.tsx`
- Create: `components/admin/self-improvement-dashboard.tsx`

- [ ] **Step 1: Create the dashboard client component**

Create `components/admin/self-improvement-dashboard.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface DashboardData {
  totalScored: number
  avgScore7d: number
  scoreCount7d: number
  proposals: { pending: number; approved: number; rejected: number }
  topSkillPacks: { skillPackSlugs: string[]; _avg: { score: number }; _count: { _all: number } }[]
  lowKnowledge: { id: string; category: string; trigger: string; successRate: number; sampleSize: number }[]
  activeRegressions: { id: string; title: string; description: string; createdAt: string }[]
  batchRunning: boolean
}

interface SelfImprovementDashboardProps {
  data: DashboardData
}

export default function SelfImprovementDashboard({ data }: SelfImprovementDashboardProps) {
  const router = useRouter()
  const [running, setRunning] = useState(data.batchRunning)

  async function handleRunBatch() {
    setRunning(true)
    try {
      await fetch('/api/admin/self-improvement', { method: 'POST' })
      // Poll for completion
      setTimeout(() => {
        router.refresh()
        setRunning(false)
      }, 5000)
    } catch {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Overview cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Scored" value={String(data.totalScored)} />
        <StatCard label="7-Day Avg Score" value={`${(data.avgScore7d * 100).toFixed(1)}%`} sub={`${data.scoreCount7d} conversations`} />
        <StatCard label="Pending Proposals" value={String(data.proposals.pending)} />
        <StatCard
          label="Batch Status"
          value={running ? 'Running...' : 'Idle'}
          action={
            <button
              onClick={handleRunBatch}
              disabled={running}
              className="mt-2 rounded-md bg-forest px-3 py-1 text-xs font-medium text-soft-white hover:bg-forest/90 transition-colors disabled:opacity-50"
            >
              Run Now
            </button>
          }
        />
      </div>

      {/* Proposals summary */}
      <div className="rounded-lg border border-warm-border bg-white p-4">
        <h3 className="text-sm font-medium text-night mb-3">Proposals Summary</h3>
        <div className="flex gap-6 text-sm">
          <span className="text-amber-700">Pending: {data.proposals.pending}</span>
          <span className="text-forest">Approved: {data.proposals.approved}</span>
          <span className="text-red-700">Rejected: {data.proposals.rejected}</span>
        </div>
      </div>

      {/* Top skill packs */}
      <div className="rounded-lg border border-warm-border bg-white p-4">
        <h3 className="text-sm font-medium text-night mb-3">Top Performing Skill Packs</h3>
        {data.topSkillPacks.length > 0 ? (
          <div className="space-y-2">
            {data.topSkillPacks.map((sp, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <code className="rounded bg-cloud-100 px-1.5 py-0.5 font-mono text-xs">
                  {sp.skillPackSlugs.join(' + ') || '(none)'}
                </code>
                <span className="text-night">
                  {((sp._avg.score ?? 0) * 100).toFixed(1)}% avg ({sp._count._all} convs)
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No data yet.</p>
        )}
      </div>

      {/* Low knowledge */}
      <div className="rounded-lg border border-warm-border bg-white p-4">
        <h3 className="text-sm font-medium text-night mb-3">Lowest Performing Knowledge</h3>
        {data.lowKnowledge.length > 0 ? (
          <div className="space-y-2">
            {data.lowKnowledge.map((k) => (
              <div key={k.id} className="flex items-center justify-between text-sm">
                <span className="text-night">{k.category}: {k.trigger}</span>
                <span className="text-red-700">
                  {(k.successRate * 100).toFixed(1)}% ({k.sampleSize} samples)
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No data yet.</p>
        )}
      </div>

      {/* Regressions */}
      {data.activeRegressions.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h3 className="text-sm font-medium text-red-700 mb-3">Active Regressions</h3>
          <div className="space-y-2">
            {data.activeRegressions.map((r) => (
              <div key={r.id} className="text-sm text-red-700">
                <strong>{r.title}</strong>
                <p className="text-xs">{r.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, sub, action }: { label: string; value: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-warm-border bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-medium text-night">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
      {action}
    </div>
  )
}
```

- [ ] **Step 2: Create the dashboard server page**

Create `app/admin/(protected)/self-improvement/page.tsx`:

```typescript
/**
 * Self-Improvement Dashboard — ADMIN only
 *
 * Server component. Shows pipeline stats and controls.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { isBatchRunning } from '@/lib/self-improvement/batch-runner'
import SelfImprovementDashboard from '@/components/admin/self-improvement-dashboard'

export default async function SelfImprovementPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) redirect('/admin/login')
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') redirect('/admin')

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [
    totalScored,
    recentScores,
    proposalCounts,
    topSkillPacks,
    lowKnowledge,
    activeRegressions,
  ] = await Promise.all([
    prisma.conversationScore.count(),
    prisma.conversationScore.findMany({
      where: { scoredAt: { gte: sevenDaysAgo } },
      select: { score: true },
    }),
    prisma.improvementProposal.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    prisma.conversationScore.groupBy({
      by: ['skillPackSlugs'],
      _avg: { score: true },
      _count: { _all: true },
      orderBy: { _avg: { score: 'desc' } },
      take: 5,
    }),
    prisma.agentKnowledge.findMany({
      where: { isActive: true, sampleSize: { gte: 10 } },
      orderBy: { successRate: 'asc' },
      take: 5,
      select: { id: true, category: true, trigger: true, successRate: true, sampleSize: true },
    }),
    prisma.improvementProposal.findMany({
      where: { type: 'INSIGHT', status: 'PENDING', title: { startsWith: 'Regression' } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ])

  const avgScore7d = recentScores.length > 0
    ? recentScores.reduce((sum, s) => sum + s.score, 0) / recentScores.length
    : 0

  const proposals = { pending: 0, approved: 0, rejected: 0 }
  for (const g of proposalCounts) {
    proposals[g.status.toLowerCase() as 'pending' | 'approved' | 'rejected'] = g._count.id
  }

  return (
    <div>
      <h2 className="mb-6 text-xl font-medium text-night">Self-Improvement</h2>
      <SelfImprovementDashboard
        data={{
          totalScored,
          avgScore7d,
          scoreCount7d: recentScores.length,
          proposals,
          topSkillPacks,
          lowKnowledge,
          activeRegressions: activeRegressions.map((r) => ({
            id: r.id,
            title: r.title,
            description: r.description,
            createdAt: r.createdAt.toISOString(),
          })),
          batchRunning: isBatchRunning(),
        }}
      />
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/(protected)/self-improvement/ components/admin/self-improvement-dashboard.tsx
git commit -m "feat(admin): add self-improvement dashboard with stats, top/bottom performers, regressions"
```

---

## Task 14: Admin Sidebar Navigation Update

**Files:**
- Modify: `components/admin/admin-sidebar.tsx`

- [ ] **Step 1: Add nav items for new pages**

In `components/admin/admin-sidebar.tsx`, add three new imports and nav items.

Add to the lucide-react import (line 5):

```typescript
import {
  LayoutDashboard,
  FileText,
  Shield,
  MessageCircle,
  Settings,
  Users,
  Layers,
  Menu,
  X,
  Lightbulb,
  FlaskConical,
  TrendingUp,
} from 'lucide-react'
```

Add three new entries to `NAV_ITEMS` array after the `skill-packs` entry (after line 28):

```typescript
  { href: '/admin/proposals', label: 'Proposals', icon: Lightbulb, adminOnly: true },
  { href: '/admin/ab-tests', label: 'A/B Tests', icon: FlaskConical, adminOnly: true },
  { href: '/admin/self-improvement', label: 'Self-Improve', icon: TrendingUp, adminOnly: true },
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/admin-sidebar.tsx
git commit -m "feat(admin): add Proposals, A/B Tests, Self-Improvement nav items to sidebar"
```

---

## Task 15: A/B Test Assignment in Orchestrator

**Files:**
- Create: `__tests__/integration/ab-test-assignment.test.ts`
- Modify: `lib/chat/orchestrator.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/integration/ab-test-assignment.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAbTestFindMany = vi.fn()
const mockAbTestUpdate = vi.fn()
const mockConversationUpdate = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    aBTestVariant: {
      findMany: (...args: unknown[]) => mockAbTestFindMany(...args),
      update: (...args: unknown[]) => mockAbTestUpdate(...args),
    },
    conversation: {
      update: (...args: unknown[]) => mockConversationUpdate(...args),
    },
  },
}))

const { applyABTestVariant } = await import('@/lib/self-improvement/ab-test-assigner')

describe('applyABTestVariant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('swaps skill pack slug when assigned to variant B', async () => {
    mockAbTestFindMany.mockResolvedValue([
      {
        id: 'test-1',
        skillPackSlugA: 'discovery-v1',
        skillPackSlugB: 'discovery-v2',
        splitRatio: 1.0, // 100% go to B
        isActive: true,
      },
    ])
    mockAbTestUpdate.mockResolvedValue({})
    mockConversationUpdate.mockResolvedValue({})

    const slugs = ['discovery-v1', 'closing']
    const result = await applyABTestVariant(slugs, 'conv-1')

    expect(result).toContain('discovery-v2')
    expect(result).toContain('closing')
    expect(result).not.toContain('discovery-v1')
  })

  it('keeps original slug when assigned to variant A', async () => {
    mockAbTestFindMany.mockResolvedValue([
      {
        id: 'test-2',
        skillPackSlugA: 'discovery-v1',
        skillPackSlugB: 'discovery-v2',
        splitRatio: 0.0, // 0% go to B — all stay on A
        isActive: true,
      },
    ])
    mockAbTestUpdate.mockResolvedValue({})

    const slugs = ['discovery-v1']
    const result = await applyABTestVariant(slugs, 'conv-2')

    expect(result).toContain('discovery-v1')
    expect(result).not.toContain('discovery-v2')
  })

  it('returns original slugs when no active tests exist', async () => {
    mockAbTestFindMany.mockResolvedValue([])

    const slugs = ['discovery-v1', 'closing']
    const result = await applyABTestVariant(slugs, 'conv-3')

    expect(result).toEqual(['discovery-v1', 'closing'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/integration/ab-test-assignment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create A/B test assigner module**

Create `lib/self-improvement/ab-test-assigner.ts`:

```typescript
/**
 * A/B Test Assigner — checks active tests and randomly assigns
 * conversations to variant A or B based on split ratio.
 */

import { prisma } from '@/lib/db'

export async function applyABTestVariant(
  skillPackSlugs: string[],
  conversationId: string,
): Promise<string[]> {
  const activeTests = await prisma.aBTestVariant.findMany({
    where: { isActive: true },
  })

  if (activeTests.length === 0) return skillPackSlugs

  const result = [...skillPackSlugs]

  for (const test of activeTests) {
    const indexA = result.indexOf(test.skillPackSlugA)
    if (indexA === -1) continue

    const assignToB = Math.random() < test.splitRatio

    if (assignToB) {
      result[indexA] = test.skillPackSlugB

      await prisma.aBTestVariant.update({
        where: { id: test.id },
        data: { conversationsB: { increment: 1 } },
      })

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          metadata: {
            abTest: { testId: test.id, variant: 'B' },
          },
        },
      })
    } else {
      await prisma.aBTestVariant.update({
        where: { id: test.id },
        data: { conversationsA: { increment: 1 } },
      })
    }
  }

  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/integration/ab-test-assignment.test.ts`
Expected: All 3 tests PASS.

- [ ] **Step 5: Integrate into orchestrator Step 3**

In `lib/chat/orchestrator.ts`, add the import at the top:

```typescript
import { applyABTestVariant } from '@/lib/self-improvement/ab-test-assigner'
```

After the reasoning gate resolves skill packs (after `gateOutput = await executeReasoningGate(gateInput)` and skill pack activation logic), add A/B test assignment. Find the section where `state.activeSkillPacks` is set after mode transition handling and add:

```typescript
      // A/B test variant assignment
      if (state.activeSkillPacks.length > 0) {
        state.activeSkillPacks = await applyABTestVariant(
          state.activeSkillPacks,
          state.conversationId,
        )
      }
```

- [ ] **Step 6: Commit**

```bash
git add lib/self-improvement/ab-test-assigner.ts __tests__/integration/ab-test-assignment.test.ts lib/chat/orchestrator.ts
git commit -m "feat(self-improvement): add A/B test variant assignment in orchestrator Step 3"
```

---

## Task 16: Run Full Test Suite and Verify Build

- [ ] **Step 1: Run all self-improvement tests**

Run: `npx vitest run __tests__/lib/self-improvement/ __tests__/integration/ab-test-assignment.test.ts`
Expected: All tests PASS (scorer: 4, analyzer: 4, proposer: 4, tracker: 4, batch-runner: 3, ab-test: 3 = 22 tests).

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: All existing tests still PASS, plus the 22 new tests.

- [ ] **Step 3: Verify build compiles**

Run: `npx next build`
Expected: Build completes without TypeScript errors. New admin pages compile correctly.

- [ ] **Step 4: Fix any issues found**

If tests fail or build errors occur, fix them and re-run until everything passes.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve test/build issues from self-improvement integration"
```

---

## Task 17: Update Master Plan

**Files:**
- Modify: `docs/MASTER-TRANSFORMATION-PLAN.md`

- [ ] **Step 1: Update Sub-Project #7 section**

Replace the Sub-Project #7 section in `docs/MASTER-TRANSFORMATION-PLAN.md` with the completed details including spec/plan paths, commit range, and delivered features.

- [ ] **Step 2: Update Progress Summary table**

Change Sub-Project #7 status from `NEXT` to `COMPLETE` with commit count and dates.

- [ ] **Step 3: Commit**

```bash
git add docs/MASTER-TRANSFORMATION-PLAN.md
git commit -m "docs: update master plan — sub-project #7 complete"
```
