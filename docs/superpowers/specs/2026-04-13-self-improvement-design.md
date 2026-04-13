# Sub-Project #7: Self-Improvement Engine — Design Spec

**Date:** 2026-04-13
**Branch:** `feat/agent-extensibility`
**Depends on:** Sub-projects #1 (AgentKnowledge, CustomerInsight, LRU cache), #3 (tool system), #4 (skill pack system), #5 (event bus, lifecycle events)

---

## Overview

A daily batch pipeline that analyzes conversation outcomes, identifies what's working and what isn't, and proposes concrete improvements to the agent's knowledge base and skill packs. An admin reviews and approves proposals through a queue in the admin UI. Adopted changes are tracked for regressions.

---

## Success Metric

Weighted multi-signal score per conversation, normalized to 0–1:

| Signal | Weight | Source |
|--------|--------|--------|
| Quote generated | 0.3 | Customer reached quote stage in WorkflowSession |
| Application submitted | 0.6 | Application record exists for conversation |
| Policy purchased | 1.0 | Payment completed successfully |

Formula: `score = (quoteGenerated ? 0.3 : 0) + (applicationSubmitted ? 0.6 : 0) + (policyPurchased ? 1.0 : 0)`, then divided by 1.9 to normalize to 0–1 range.

---

## Architecture: Pipeline of Discrete Agents

Four agents run sequentially in a daily batch job. Each reads from the database, performs its work, and writes results back. Partial failures preserve prior agent outputs.

```
Scorer → Analyzer → Proposer → Tracker
```

---

## Data Models

### ConversationScore

Persists the weighted outcome score per conversation.

| Field | Type | Purpose |
|-------|------|---------|
| id | String @id @default(cuid()) | Primary key |
| conversationId | String @unique | FK to Conversation |
| quoteGenerated | Boolean | Customer reached quote stage |
| applicationSubmitted | Boolean | Application record exists |
| policyPurchased | Boolean | Payment completed |
| score | Float | Normalized weighted score (0–1) |
| messageCount | Int | Total conversation turns |
| totalCost | Float | Sum of TurnTrace.cost |
| totalLatencyMs | Int | Sum of TurnTrace.latencyMs |
| anomalyCount | Int | Total anomalies across all turns |
| mode | String | Final conversation mode |
| skillPackSlugs | String[] | Skill packs used during conversation |
| scoredAt | DateTime @default(now()) | When scorer ran |
| createdAt | DateTime @default(now()) | |

Relations: belongs to Conversation.
Index: `@@index([scoredAt])` for time-windowed queries, `@@index([score])` for ranking.

### ImprovementProposal

The admin review queue. Each row is one proposed change.

| Field | Type | Purpose |
|-------|------|---------|
| id | String @id @default(cuid()) | Primary key |
| type | ProposalType | Category of change |
| title | String | Short summary for admin |
| description | String @db.Text | Detailed explanation with evidence |
| diff | Json | Before/after payload (structure depends on type) |
| evidence | Json | { conversationIds: string[], sampleSize: number, confidence: number } |
| status | ProposalStatus @default(PENDING) | Review state |
| adminNotes | String? @db.Text | Optional reason for rejection |
| appliedAt | DateTime? | When the change was applied |
| baselineMetrics | Json? | Metrics snapshot at adoption for regression tracking |
| createdAt | DateTime @default(now()) | |
| updatedAt | DateTime @updatedAt | |

Index: `@@index([status, createdAt])` for the admin queue view.

### ABTestVariant

Tracks skill pack A/B test configurations.

| Field | Type | Purpose |
|-------|------|---------|
| id | String @id @default(cuid()) | Primary key |
| name | String | Test name (e.g., "discovery-v2-vs-v3") |
| skillPackSlugA | String | Control variant slug |
| skillPackSlugB | String | Test variant slug |
| splitRatio | Float | Fraction of traffic to variant B (0.0–1.0) |
| isActive | Boolean @default(true) | Currently running |
| startedAt | DateTime @default(now()) | |
| endedAt | DateTime? | |
| conversationsA | Int @default(0) | Count assigned to A |
| conversationsB | Int @default(0) | Count assigned to B |
| createdAt | DateTime @default(now()) | |

Index: `@@index([isActive])` for active test lookups.

### Enums

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

---

## Pipeline Agents

### Agent 1: Scorer (`lib/self-improvement/scorer.ts`)

**Input:** Conversations with `status = COMPLETED | ABANDONED` that have no `ConversationScore` record.

**Process:**
1. Query unscored conversations with their related data: TurnTrace records, WorkflowSession, Application, Payment/Policy.
2. For each conversation:
   - Determine `quoteGenerated`: customer reached quote step in WorkflowSession.
   - Determine `applicationSubmitted`: Application record exists for this conversation.
   - Determine `policyPurchased`: Payment with successful status exists.
   - Aggregate TurnTrace data: sum cost, sum latencyMs, count anomalies.
   - Compute weighted score, normalized to 0–1.
3. Write `ConversationScore` record.

**Idempotency:** Skips conversations that already have a ConversationScore (unique constraint on conversationId).

### Agent 2: Analyzer (`lib/self-improvement/analyzer.ts`)

**Input:** ConversationScore records from the last 24 hours + historical data.

**Process:**
1. **Skill pack performance:** Group scores by `skillPackSlugs`. Compute average score per skill pack combination. Compare against historical averages (all-time).
2. **Knowledge effectiveness:** For each active `AgentKnowledge` entry, find scored conversations that share the same `productId` and `mode` (or `workflowStepCode` if set). This is a contextual match — if a knowledge entry is for product X in SALES mode, all scored conversations for product X in SALES mode count toward its effectiveness. Update `successRate` = weighted moving average of matched conversation scores, increment `sampleSize`.
3. **Pattern detection:** Identify correlations:
   - Message count vs. score (optimal conversation length).
   - Mode transitions that correlate with abandonment.
   - Anomaly patterns that predict low scores.
   - Time-of-day or language patterns.
4. **A/B test results:** For active `ABTestVariant` records, compute average scores for conversations tagged with variant A vs B.

**Output:** Structured analysis object passed to Proposer. Side effect: AgentKnowledge.successRate and sampleSize updated in DB.

### Agent 3: Proposer (`lib/self-improvement/proposer.ts`)

**Input:** Analysis object from Analyzer + conversation transcripts of top/bottom performers.

**Process:**
1. Select the 5 highest-scoring and 5 lowest-scoring conversations from today's batch.
2. Load their full message transcripts from the DB.
3. Call the LLM (via existing gateway, same provider as sales agent) with a structured prompt:
   - Provide the analysis summary (patterns, skill pack rankings, knowledge effectiveness).
   - Include top/bottom conversation transcripts.
   - Include current skill pack prompt sections and knowledge entries.
   - Ask for specific, actionable improvement proposals.
4. Parse LLM response as structured JSON. Each proposal must have: type, title, description, diff, evidence.
5. Write each proposal as an `ImprovementProposal` with status `PENDING`.
6. For 20-100 conversations/day: chunk into batches of ~20 transcripts per LLM call (2-5 calls total).

**Error handling:** If LLM returns malformed JSON, log error and skip proposal creation for that batch. Never create proposals with missing required fields.

### Agent 4: Tracker (`lib/self-improvement/tracker.ts`)

**Input:** `ImprovementProposal` records with status `APPROVED` and `appliedAt` set.

**Process:**
1. For each approved proposal, check if enough conversations have occurred since adoption (minimum 30 conversations in the affected context).
2. If threshold met:
   - Compute post-adoption average score for conversations matching the affected skill packs / knowledge entries.
   - Compare against `baselineMetrics` snapshot.
   - If score dropped >10% from baseline → create a new `ImprovementProposal` of type `INSIGHT` warning the admin of the regression.
3. Skip proposals with insufficient post-adoption data.

**Idempotency:** Safe to re-run. Only creates regression warnings when thresholds are newly crossed.

---

## A/B Testing Integration

### At conversation time (Orchestrator Step 3)

When the reasoning gate recommends skill packs:

1. Query active `ABTestVariant` records.
2. For each recommended skill pack slug, check if it matches `skillPackSlugA` of any active test.
3. If match found: generate random number, compare against `splitRatio`.
   - Below ratio → keep original (variant A), increment `conversationsA`.
   - Above ratio → swap to `skillPackSlugB` (variant B), increment `conversationsB`.
4. Store assignment in `Conversation.metadata`: `{ "abTest": { "testId": "...", "variant": "A" | "B" } }`.

### Admin workflow

1. Admin duplicates a skill pack and modifies the copy (creating the variant).
2. Admin creates an A/B test in the UI: picks control slug (A) and variant slug (B), sets split ratio.
3. System randomly assigns conversations per the ratio.
4. Results page shows average score per variant and conversation counts.
5. Admin ends the test and optionally promotes the winner.

### Scope limits

- No automated variant generation from proposals.
- No statistical significance testing beyond minimum sample size (30 per variant).
- No auto-promotion of winners — admin decides.

---

## Batch Orchestration

### Entry point: `lib/self-improvement/batch-runner.ts`

Single function `runDailyBatch()`:

```typescript
export async function runDailyBatch(): Promise<BatchResult> {
  // 1. Acquire lock (prevent concurrent runs)
  // 2. Run Scorer → count scored
  // 3. Run Analyzer → get analysis
  // 4. Run Proposer(analysis) → count proposals
  // 5. Run Tracker → count regressions
  // 6. Release lock, return BatchResult
}
```

### Triggering

- **Manual:** `POST /api/admin/self-improvement/run` — admin clicks "Run Now".
- **Scheduled:** External cron (Vercel Cron, system cron, etc.) hits the same endpoint daily.
- **Concurrency guard:** Simple DB-based lock. If a batch is already running, the endpoint returns 409.

### Error handling

- Each agent is wrapped in try/catch.
- If an agent fails, subsequent agents do not run, but prior results are preserved.
- Batch status recorded: startedAt, completedAt, status (SUCCESS | PARTIAL | FAILED), counts per stage, error messages.
- Structured logger captures errors with full context.
- Next run picks up where the failed run left off (Scorer skips scored conversations, etc.).

---

## Proposal Apply Logic

When admin clicks "Approve":

### KNOWLEDGE_CREATE
- Creates new `AgentKnowledge` record with proposed category, trigger, content, productId, workflowStepCode.
- Sets `successRate: 0.0`, `sampleSize: 0`, `isActive: true`.
- Baseline: records current average score for conversations matching same product/workflow context.

### KNOWLEDGE_UPDATE
- Updates existing `AgentKnowledge` record. `diff` contains `{ before: { field: oldValue }, after: { field: newValue } }`.
- Typically updates `content` or `trigger`.
- Baseline: records current successRate and sampleSize of the entry.

### SKILLPACK_UPDATE
- Updates `SkillPack.promptSections` or `SkillPack.constraints`.
- `diff` contains `{ sectionKey: string, before: string, after: string }`.
- Flushes skill pack LRU cache after applying (`flushSkillPackCache()`).
- Baseline: records average score for conversations that used this skill pack.

### INSIGHT
- No automated apply. Insights are informational.
- Approve acknowledges, reject dismisses.
- Examples: pattern observations, regression warnings from Tracker.

---

## Admin UI & API

### Pages

**1. Proposals Queue (`/admin/proposals`)**
- Filterable table: Type, Title, Status, Evidence (sample size + confidence), Created.
- Detail view: full description, evidence with linked conversation IDs, diff view (before/after), Approve/Reject buttons with optional notes.

**2. A/B Tests (`/admin/ab-tests`)**
- List active and completed tests.
- Create: pick two skill pack slugs, set split ratio.
- Per test: conversation counts per variant, average score per variant, bar chart comparison.
- End test button.

**3. Self-Improvement Dashboard (`/admin/self-improvement`)**
- Overview: total conversations scored, average score trend (7-day rolling), proposals generated/approved/rejected.
- Top performing skill packs by average score.
- Bottom performing knowledge entries (low successRate, decent sampleSize).
- Active regression warnings.
- Last batch run timestamp + status.
- "Run Now" button.

### API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/admin/proposals` | List proposals, filterable by status |
| GET | `/api/admin/proposals/[id]` | Proposal detail with evidence |
| POST | `/api/admin/proposals/[id]/approve` | Apply change, snapshot baseline |
| POST | `/api/admin/proposals/[id]/reject` | Reject with optional notes |
| GET | `/api/admin/ab-tests` | List tests |
| POST | `/api/admin/ab-tests` | Create test |
| POST | `/api/admin/ab-tests/[id]/end` | End test |
| GET | `/api/admin/ab-tests/[id]/results` | Score comparison |
| GET | `/api/admin/self-improvement/dashboard` | Dashboard stats |
| POST | `/api/admin/self-improvement/run` | Trigger batch manually |

All admin routes require authenticated admin session (existing RBAC middleware).

---

## Testing Strategy

### Unit tests

- **Scorer:** Given conversation with known quote/application/payment state → correct weighted score. Edge: no turns, all signals true, no signals true.
- **Analyzer:** Given ConversationScores → correct successRate updates on AgentKnowledge, correct skill pack grouping. Edge: empty time window.
- **Proposer:** Mock LLM gateway → proposals created with correct type and valid diff. Edge: malformed LLM JSON → no proposals, error logged.
- **Tracker:** Given approved proposal with baselineMetrics + enough post-adoption conversations → regression detected when score drops >10%. Edge: insufficient conversations → skip.

### Integration tests

- **Full pipeline:** Seed conversations + turn traces + applications → `runDailyBatch()` → ConversationScores created, AgentKnowledge updated, proposals generated.
- **Approve flow:** Create PENDING proposal → approve endpoint → underlying record (AgentKnowledge or SkillPack) changed, baselineMetrics captured.
- **A/B assignment:** Create active ABTestVariant → run orchestrator → conversations split according to ratio.

### Not tested

- LLM output quality (admin's job during review).
- Statistical significance of A/B results.

---

## Files Summary

### New files (~12)

| File | Purpose |
|------|---------|
| `lib/self-improvement/scorer.ts` | Conversation scoring agent |
| `lib/self-improvement/analyzer.ts` | Pattern analysis agent |
| `lib/self-improvement/proposer.ts` | LLM-powered proposal generation |
| `lib/self-improvement/tracker.ts` | Regression tracking agent |
| `lib/self-improvement/batch-runner.ts` | Sequential pipeline orchestration |
| `app/admin/proposals/page.tsx` | Proposals queue UI |
| `app/admin/ab-tests/page.tsx` | A/B tests management UI |
| `app/admin/self-improvement/page.tsx` | Dashboard UI |
| `app/api/admin/proposals/route.ts` | Proposals list API |
| `app/api/admin/proposals/[id]/route.ts` | Proposal detail + approve/reject API |
| `app/api/admin/ab-tests/route.ts` | A/B tests CRUD API |
| `app/api/admin/self-improvement/route.ts` | Dashboard + batch trigger API |

### Modified files (~3)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add ConversationScore, ImprovementProposal, ABTestVariant models + enums |
| `lib/chat/orchestrator.ts` | A/B test assignment in Step 3 |
| `prisma/seed.ts` | Seed initial data if needed |
