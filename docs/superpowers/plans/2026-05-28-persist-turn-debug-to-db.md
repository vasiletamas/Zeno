# Persist Per-Turn Debug Data to the DB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the full rich per-turn debug record (the `DebugTurn` the dev panel renders) to a new `TurnDebug` table for every turn, keyed per conversation, and let the debug panel reload a conversation's prior turns from the DB.

**Architecture:** A new `TurnDebug` table stores one row per turn with the full `DebugTurn` as a JSON `payload`. The orchestrator accumulates every `debug:*` event into `state.debugEvents` **unconditionally** (decoupled from the dev/`x-zeno-debug` SSE gate, which still controls only the live stream), then at turn-end reduces the events with the existing `reduceDebugEvent` and fire-and-forget upserts the row. A dev-only `GET /api/conversations/[id]/debug` endpoint returns the stored turns, and `DebugProvider` gains a `hydrate` action so `ChatPage` can replay them on load.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 (`pg` adapter, client generated to `lib/generated/prisma/client`), Vitest (node env, `prisma` mocked via `vi.mock('@/lib/db')`), React 19.

---

## File Structure

- **Create:** `lib/chat/turn-debug-persistence.ts` — pure-ish write unit (`persistTurnDebug`); reduces events and upserts the row. Swallows errors.
- **Create:** `app/api/conversations/[id]/debug/route.ts` — dev-only `GET` returning `{ turns: DebugTurn[] }` for a conversation.
- **Modify:** `prisma/schema.prisma` — add `TurnDebug` model + `Conversation.turnDebugs` back-relation.
- **Modify:** `lib/debug/reducer.ts` — add `buildTurnDebugPayload`, `DebugAction`, and `debugReducer` (CLEAR + HYDRATE + event passthrough).
- **Modify:** `lib/chat/debug.ts` — add `recordDebugEvent`.
- **Modify:** `lib/chat/orchestrator.ts` — add `state.debugEvents`, a local `recordAndYield` wrapper, always-build the identity event, call `persistTurnDebug` at turn-end.
- **Modify:** `components/debug/debug-provider.tsx` — use `debugReducer`, expose `hydrate`.
- **Modify:** `components/chat/chat-page.tsx` — fetch + hydrate on conversation load when debug is enabled.
- **Create (tests):** `__tests__/lib/chat/debug-record.test.ts`, `__tests__/lib/chat/turn-debug-persistence.test.ts`, `__tests__/app/api/conversations/conversation-debug-route.test.ts`; **extend** `__tests__/lib/debug/reducer.test.ts`.

---

### Task 1: Add the `TurnDebug` table

**Files:**
- Modify: `prisma/schema.prisma` (Conversation relations block ~line 328; append new model after `TurnTrace` ~line 655)

- [ ] **Step 1: Add the back-relation to `Conversation`**

In `model Conversation`, directly below the existing `turnTraces TurnTrace[]` line, add:

```prisma
  turnTraces       TurnTrace[]
  turnDebugs       TurnDebug[]
```

- [ ] **Step 2: Add the `TurnDebug` model**

Immediately after the closing brace of `model TurnTrace { ... }`, add:

```prisma
model TurnDebug {
  id             String   @id @default(cuid())
  conversationId String
  messageIndex   Int
  traceId        String   @unique
  payload        Json
  createdAt      DateTime @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id])

  @@index([conversationId, messageIndex])
}
```

- [ ] **Step 3: Validate the schema**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Regenerate the client and create the migration**

Run: `npx prisma generate`
Then (requires `DATABASE_URL` pointing at a dev DB): `npx prisma migrate dev --name add_turn_debug`
Expected: a new folder under `prisma/migrations/<timestamp>_add_turn_debug/` and `prisma.turnDebug` now available on the generated client.

> If no dev DB is reachable in this environment, run `npx prisma generate` (gives the TS types so later tasks compile) plus `npx prisma migrate dev --name add_turn_debug --create-only` to author the SQL, and apply it when a DB is available. Do not hand-edit generated client files.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add TurnDebug table for per-turn debug persistence"
```

---

### Task 2: `buildTurnDebugPayload` — reduce events into one `DebugTurn`

**Files:**
- Modify: `lib/debug/reducer.ts`
- Test: `__tests__/lib/debug/reducer.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/debug/reducer.test.ts`:

```ts
import { buildTurnDebugPayload } from '@/lib/debug/reducer'

describe('buildTurnDebugPayload', () => {
  it('reduces a full event sequence into one DebugTurn with tool args + results', () => {
    const events: DebugEvent[] = [
      start('t1', 3),
      {
        event: 'debug:tool_call',
        data: { traceId: 't1', round: 0, toolCallId: 'tc1', name: 'list_products', args: { insuranceType: 'life' }, partition: 'readOnly' },
      },
      {
        event: 'debug:tool_result',
        data: { traceId: 't1', toolCallId: 'tc1', success: true, durationMs: 5, cached: false, data: { items: 2 } },
      },
      end('t1'),
    ]
    const turn = buildTurnDebugPayload(events)
    expect(turn?.traceId).toBe('t1')
    expect(turn?.toolCalls[0].args).toEqual({ insuranceType: 'life' })
    expect(turn?.toolCalls[0].result?.data).toEqual({ items: 2 })
    expect(turn?.totals?.totalInputTokens).toBe(1)
  })

  it('returns null when there are no events', () => {
    expect(buildTurnDebugPayload([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/debug/reducer.test.ts`
Expected: FAIL — `buildTurnDebugPayload is not a function` (or import error).

- [ ] **Step 3: Implement**

In `lib/debug/reducer.ts`, after `reduceDebugEvent`, add:

```ts
/**
 * Reduce a full turn's worth of debug events into the single DebugTurn that
 * the panel renders. Used server-side to build the DB payload, so the stored
 * shape and the live UI shape stay identical. Returns null for an empty list.
 */
export function buildTurnDebugPayload(events: DebugEvent[]): DebugTurn | null {
  let state: DebugState = EMPTY_STATE
  for (const event of events) {
    state = reduceDebugEvent(state, event)
  }
  return state.turns[0] ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/debug/reducer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/debug/reducer.ts __tests__/lib/debug/reducer.test.ts
git commit -m "feat(debug): buildTurnDebugPayload reduces events into a DebugTurn"
```

---

### Task 3: `debugReducer` + `DebugAction` (CLEAR / HYDRATE / event)

**Files:**
- Modify: `lib/debug/reducer.ts`
- Test: `__tests__/lib/debug/reducer.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/debug/reducer.test.ts`:

```ts
import { debugReducer } from '@/lib/debug/reducer'
import type { DebugTurn } from '@/lib/debug/reducer'

describe('debugReducer', () => {
  it('CLEAR resets to an empty state', () => {
    let s = debugReducer(EMPTY_STATE, start('t1', 0))
    s = debugReducer(s, { type: 'CLEAR' })
    expect(s.turns).toEqual([])
  })

  it('HYDRATE replaces turns (newest-first, capped at 50)', () => {
    const seed: DebugTurn[] = Array.from({ length: 55 }, (_, i) => ({
      traceId: `h${i}`, conversationId: 'c1', messageIndex: i, userMessage: 'x', language: 'en', startedAt: 0, toolCalls: [],
    }))
    const s = debugReducer(EMPTY_STATE, { type: 'HYDRATE', turns: seed })
    expect(s.turns).toHaveLength(50)
    expect(s.turns[0].traceId).toBe('h0')
  })

  it('passes debug events through to reduceDebugEvent', () => {
    const s = debugReducer(EMPTY_STATE, start('t1', 0))
    expect(s.turns[0].traceId).toBe('t1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/debug/reducer.test.ts`
Expected: FAIL — `debugReducer is not a function`.

- [ ] **Step 3: Implement**

In `lib/debug/reducer.ts`, after `buildTurnDebugPayload`, add:

```ts
export type DebugAction =
  | DebugEvent
  | { type: 'CLEAR' }
  | { type: 'HYDRATE'; turns: DebugTurn[] }

/**
 * Reducer used by DebugProvider. Handles the two control actions (CLEAR,
 * HYDRATE) and delegates every debug:* event to reduceDebugEvent. DebugEvent
 * has an `event` field and no `type` field, so `'type' in action` cleanly
 * distinguishes control actions from events.
 */
export function debugReducer(state: DebugState, action: DebugAction): DebugState {
  if ('type' in action) {
    switch (action.type) {
      case 'CLEAR':
        return EMPTY_STATE
      case 'HYDRATE':
        return { turns: action.turns.slice(0, MAX_TURNS) }
    }
  }
  return reduceDebugEvent(state, action)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/debug/reducer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/debug/reducer.ts __tests__/lib/debug/reducer.test.ts
git commit -m "feat(debug): debugReducer with CLEAR + HYDRATE actions"
```

---

### Task 4: `recordDebugEvent` — always-on accumulator

**Files:**
- Modify: `lib/chat/debug.ts`
- Test: `__tests__/lib/chat/debug-record.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/chat/debug-record.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { recordDebugEvent, type DebugEvent } from '@/lib/chat/debug'

const ev: DebugEvent = {
  event: 'debug:gate',
  data: { traceId: 't1', skipped: true, reason: 'fast_path', durationMs: 0 },
}

describe('recordDebugEvent', () => {
  it('appends the event to the sink (no debug gate involved)', () => {
    const sink = { debugEvents: [] as DebugEvent[] }
    recordDebugEvent(sink, ev)
    recordDebugEvent(sink, ev)
    expect(sink.debugEvents).toHaveLength(2)
    expect(sink.debugEvents[0]).toBe(ev)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/chat/debug-record.test.ts`
Expected: FAIL — `recordDebugEvent is not a function`.

- [ ] **Step 3: Implement**

In `lib/chat/debug.ts`, after the `debugYield` function, add:

```ts
/**
 * Append a debug event to a sink's accumulator, UNCONDITIONALLY. This is the
 * always-on counterpart to debugYield: debugYield gates the live SSE stream
 * (dev + x-zeno-debug), while recordDebugEvent always captures the event so
 * the full turn can be persisted to the DB regardless of the debug gate.
 */
export function recordDebugEvent(
  sink: { debugEvents: DebugEvent[] },
  event: DebugEvent,
): void {
  sink.debugEvents.push(event)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/chat/debug-record.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/chat/debug.ts __tests__/lib/chat/debug-record.test.ts
git commit -m "feat(debug): recordDebugEvent always-on accumulator"
```

---

### Task 5: `persistTurnDebug` — reduce + upsert (the write unit)

**Files:**
- Create: `lib/chat/turn-debug-persistence.ts`
- Test: `__tests__/lib/chat/turn-debug-persistence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/chat/turn-debug-persistence.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DebugEvent } from '@/lib/chat/debug'

const upsertSpy = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: { turnDebug: { upsert: (...a: unknown[]) => upsertSpy(...a) } },
}))
vi.mock('@/lib/errors/logger', () => ({ logError: vi.fn() }))

const { persistTurnDebug } = await import('@/lib/chat/turn-debug-persistence')

function events(traceId: string): DebugEvent[] {
  return [
    { event: 'debug:turn_start', data: { traceId, conversationId: 'c1', messageIndex: 0, userMessage: 'hi', language: 'en' } },
    { event: 'debug:tool_call', data: { traceId, round: 0, toolCallId: 'tc1', name: 'list_products', args: { insuranceType: 'life' }, partition: 'readOnly' } },
    { event: 'debug:tool_result', data: { traceId, toolCallId: 'tc1', success: true, durationMs: 5, cached: false, data: { items: 2 } } },
    { event: 'debug:turn_end', data: { traceId, phases: {}, totalInputTokens: 10, totalOutputTokens: 20, cost: 0.01, latencyMs: 100, anomalies: [] } },
  ]
}

describe('persistTurnDebug', () => {
  beforeEach(() => upsertSpy.mockReset())

  it('upserts one row keyed by traceId, with tool args + results in the payload', async () => {
    upsertSpy.mockResolvedValueOnce({})
    await persistTurnDebug({ conversationId: 'c1', messageIndex: 3, traceId: 't1', events: events('t1') })
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const arg = upsertSpy.mock.calls[0][0] as {
      where: { traceId: string }
      create: { conversationId: string; messageIndex: number; payload: any }
    }
    expect(arg.where).toEqual({ traceId: 't1' })
    expect(arg.create.conversationId).toBe('c1')
    expect(arg.create.messageIndex).toBe(3)
    expect(arg.create.payload.toolCalls[0].args).toEqual({ insuranceType: 'life' })
    expect(arg.create.payload.toolCalls[0].result.data).toEqual({ items: 2 })
    expect(arg.create.payload.totals.totalInputTokens).toBe(10)
  })

  it('does not write when there are no events', async () => {
    await persistTurnDebug({ conversationId: 'c1', messageIndex: 0, traceId: 't1', events: [] })
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('swallows DB errors and never throws', async () => {
    upsertSpy.mockRejectedValueOnce(new Error('db down'))
    await expect(
      persistTurnDebug({ conversationId: 'c1', messageIndex: 0, traceId: 't1', events: events('t1') }),
    ).resolves.toBeUndefined()
  })
})
```

> Note: `persistTurnDebug` takes no `debugEnabled` flag — it persists purely from the accumulated events. That is what makes persistence always-on: the dev/header gate cannot suppress it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/chat/turn-debug-persistence.test.ts`
Expected: FAIL — cannot resolve `@/lib/chat/turn-debug-persistence`.

- [ ] **Step 3: Implement**

Create `lib/chat/turn-debug-persistence.ts`:

```ts
/**
 * Persist one turn's full debug record to the TurnDebug table.
 *
 * Fire-and-forget from the orchestrator at turn-end. Reduces the accumulated
 * debug events into the same DebugTurn shape the panel renders, then upserts
 * by traceId (idempotent). DB failures are logged and swallowed — debug
 * persistence must never break or delay the user-facing turn.
 */

import { prisma } from '@/lib/db'
import { logError } from '@/lib/errors/logger'
import { buildTurnDebugPayload } from '@/lib/debug/reducer'
import type { DebugEvent } from './debug'

export interface PersistTurnDebugInput {
  conversationId: string
  messageIndex: number
  traceId: string
  events: DebugEvent[]
}

export async function persistTurnDebug(input: PersistTurnDebugInput): Promise<void> {
  const payload = buildTurnDebugPayload(input.events)
  if (!payload) return

  // Round-trip through JSON to drop any non-serializable values, matching the
  // existing turnTrace.create pattern in orchestrator.ts.
  const json = JSON.parse(JSON.stringify(payload))

  try {
    await prisma.turnDebug.upsert({
      where: { traceId: input.traceId },
      create: {
        conversationId: input.conversationId,
        messageIndex: input.messageIndex,
        traceId: input.traceId,
        payload: json,
      },
      update: {
        messageIndex: input.messageIndex,
        payload: json,
      },
    })
  } catch (err) {
    logError({
      layer: 'orchestrator',
      category: 'turn_debug',
      message: 'TurnDebug write error',
      context: { conversationId: input.conversationId },
      error: err,
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/chat/turn-debug-persistence.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add lib/chat/turn-debug-persistence.ts __tests__/lib/chat/turn-debug-persistence.test.ts
git commit -m "feat(debug): persistTurnDebug reduces + upserts a TurnDebug row"
```

---

### Task 6: Wire the orchestrator — always record, persist at turn-end

**Files:**
- Modify: `lib/chat/orchestrator.ts` (imports ~line 48; `TurnState` ~line 121; state init ~line 163; identity block ~lines 296-335; all `debugYield` call sites; turn-end ~line 1636)

- [ ] **Step 1: Update imports**

Replace line 48:

```ts
import { debugYield, isDev, buildIdentityPayload } from './debug'
```

with:

```ts
import { debugYield, isDev, buildIdentityPayload, recordDebugEvent, type DebugEvent } from './debug'
import { persistTurnDebug } from './turn-debug-persistence'
```

- [ ] **Step 2: Add `debugEvents` to `TurnState`**

In `interface TurnState` (~line 121), add a field at the end (before the closing brace):

```ts
  complianceResult: ComplianceCheckResult | null
  debugEvents: DebugEvent[]
}
```

- [ ] **Step 3: Initialize `debugEvents` in state**

In the `const state: TurnState = { ... }` initializer (~line 163), add at the end (after `complianceResult: null,`):

```ts
    complianceResult: null,
    debugEvents: [],
  }
```

- [ ] **Step 4: Add the local `recordAndYield` wrapper**

Immediately after `async function* chatTurnGenerator(...)`'s opening (e.g. just below the `const state: TurnState = {...}` block, before the first `eventBus.emit`), add:

```ts
  // Records every debug event for DB persistence (always), then yields it to
  // the live SSE stream only when the debug gate is open. Single chokepoint so
  // the two concerns never drift apart.
  function* recordAndYield(event: DebugEvent): Generator<SSEEvent> {
    recordDebugEvent(state, event)
    yield* debugYield(isDev(), debugEnabled, event)
  }
```

- [ ] **Step 5: Route every existing `debugYield` call through `recordAndYield`**

For every existing call of the form:

```ts
yield* debugYield(isDev(), debugEnabled, {
  event: 'debug:...',
  data: { ... },
})
```

replace the call head `yield* debugYield(isDev(), debugEnabled, {` with `yield* recordAndYield({` and remove the now-unused `isDev(), debugEnabled,` arguments (the closing `})` stays). Example — the `debug:turn_start` site (~line 192):

Before:
```ts
  yield* debugYield(isDev(), debugEnabled, {
    event: 'debug:turn_start',
    data: {
      traceId: state.traceId,
      conversationId: state.conversationId,
      messageIndex: state.messageCount,
      userMessage: input.message,
      language: state.language,
    },
  })
```
After:
```ts
  yield* recordAndYield({
    event: 'debug:turn_start',
    data: {
      traceId: state.traceId,
      conversationId: state.conversationId,
      messageIndex: state.messageCount,
      userMessage: input.message,
      language: state.language,
    },
  })
```

Apply the identical head-replacement at each remaining `debugYield` site (the gate, prompt, tool_call, tool_result, and turn_end sites). After this step, the only direct caller of `debugYield` left in the file is inside `recordAndYield`.

- [ ] **Step 6: Make the identity event always-built**

Replace the entire block at ~lines 296-335 (the `let preloadedInsights ...` declaration through its `if (isDev() && debugEnabled) { ... }`) with the always-on version below. The key change: the `if (isDev() && debugEnabled)` gate is removed so `loadCustomerInsights` runs and the identity event is recorded every turn; the SSE yield stays gated inside `recordAndYield`.

```ts
  // Pre-fetch raw insights every turn so the persisted debug record's identity
  // card is complete even when the live debug stream is off, and so the same
  // rows thread into loadAllSections (no second query). The SSE yield inside
  // recordAndYield is still gated. A failure here must never break the turn —
  // log and continue with no preloaded insights.
  let preloadedInsights: RawCustomerInsight[] | undefined
  try {
    preloadedInsights = await loadCustomerInsights(state.customerId)
    yield* recordAndYield({
      event: 'debug:identity',
      data: buildIdentityPayload({
        traceId: state.traceId,
        conversationId: state.conversationId,
        messageIndex: state.messageCount,
        customerId: state.customerId,
        customer: turnCtx.customer,
        conversation: {
          mode: turnCtx.conversation.mode,
          productId: turnCtx.conversation.productId,
          product: turnCtx.conversation.product,
          candidateProductId: turnCtx.conversation.candidateProductId,
          candidateConfidence: turnCtx.conversation.candidateConfidence,
          candidateSetAt: turnCtx.conversation.candidateSetAt,
          application: turnCtx.conversation.application,
        },
        insights: preloadedInsights,
        now: new Date(),
      }),
    })
  } catch (err) {
    logWarn({
      layer: 'orchestrator',
      category: 'debug',
      message: 'Failed to build/record debug:identity event',
      context: { conversationId: state.conversationId, customerId: state.customerId },
      error: err,
    })
    preloadedInsights = undefined
  }
```

- [ ] **Step 7: Persist the turn at turn-end**

Find the `debug:turn_end` emission (now `yield* recordAndYield({ event: 'debug:turn_end', ... })`, ~line 1625). Immediately **after** that block (so the recorded events include `turn_end`), add:

```ts
  // Persist the full debug record for this turn. Always-on (no debug gate),
  // fire-and-forget, errors swallowed inside persistTurnDebug.
  void persistTurnDebug({
    conversationId: state.conversationId,
    messageIndex: state.messageCount,
    traceId: state.traceId,
    events: state.debugEvents,
  })
```

- [ ] **Step 8: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors (confirms `prisma.turnDebug` is typed, `recordAndYield` signatures line up, no leftover `debugYield` arity mismatch).

Run: `npm test`
Expected: PASS, including the existing `__tests__/lib/chat/debug.test.ts` and `route-debug-header.test.ts` (we did not change `debugYield`'s signature or the route).

- [ ] **Step 9: Manual runtime verification (always-on, debug OFF)**

The orchestrator generator has no unit harness in this project, so verify the wiring against a running app with the debug stream **off** (proves persistence is independent of the gate):

1. Start the app: `npm run dev`
2. Send a turn that calls a tool, WITHOUT the debug header:
   ```bash
   curl -N -X POST http://localhost:3000/api/chat \
     -H 'Content-Type: application/json' \
     -d '{"message":"vreau o asigurare de viata","language":"ro"}'
   ```
   Note the `conversationId` from the final `done` event.
3. Confirm a row was written (and contains tool calls):
   ```bash
   npx prisma studio   # open TurnDebug, filter conversationId
   ```
   or query directly:
   ```bash
   echo "SELECT \"messageIndex\", \"traceId\", jsonb_array_length(payload->'toolCalls') AS tools FROM \"TurnDebug\" WHERE \"conversationId\"='<id>';" | npx prisma db execute --stdin
   ```
   Expected: at least one row for the conversation; `tools` ≥ 1 for the tool-calling turn. This proves the rich debug data (tool args/results) is persisted even though `x-zeno-debug` was never sent.

- [ ] **Step 10: Commit**

```bash
git add lib/chat/orchestrator.ts
git commit -m "feat(orchestrator): record + persist full debug record every turn"
```

---

### Task 7: Read endpoint `GET /api/conversations/[id]/debug`

**Files:**
- Create: `app/api/conversations/[id]/debug/route.ts`
- Test: `__tests__/app/api/conversations/conversation-debug-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/app/api/conversations/conversation-debug-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManySpy = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: { turnDebug: { findMany: (...a: unknown[]) => findManySpy(...a) } },
}))
vi.mock('@/lib/errors/logger', () => ({ logError: vi.fn() }))

const { GET } = await import('@/app/api/conversations/[id]/debug/route')

function req() {
  return new Request('http://localhost/api/conversations/A/debug') as unknown as import('next/server').NextRequest
}

describe('GET /api/conversations/[id]/debug', () => {
  beforeEach(() => {
    findManySpy.mockReset()
    vi.unstubAllEnvs()
  })

  it('returns 404 outside development (no DB read)', async () => {
    const res = await GET(req(), { params: Promise.resolve({ id: 'A' }) })
    expect(res.status).toBe(404)
    expect(findManySpy).not.toHaveBeenCalled()
  })

  it('returns the conversation turns, scoped to the path id, newest-first', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    findManySpy.mockResolvedValueOnce([{ payload: { traceId: 't2', conversationId: 'A' } }])
    const res = await GET(req(), { params: Promise.resolve({ id: 'A' }) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { turns: unknown[] }
    expect(body.turns).toEqual([{ traceId: 't2', conversationId: 'A' }])
    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: 'A' },
        orderBy: { createdAt: 'desc' },
      }),
    )
  })

  it('returns empty turns for an unknown conversation', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    findManySpy.mockResolvedValueOnce([])
    const res = await GET(req(), { params: Promise.resolve({ id: 'nope' }) })
    const body = (await res.json()) as { turns: unknown[] }
    expect(body.turns).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/app/api/conversations/conversation-debug-route.test.ts`
Expected: FAIL — cannot resolve `@/app/api/conversations/[id]/debug/route`.

- [ ] **Step 3: Implement**

Create `app/api/conversations/[id]/debug/route.ts`:

```ts
/**
 * GET /api/conversations/[id]/debug
 *
 * Returns the persisted per-turn debug records for a conversation so the dev
 * debug panel can replay prior turns across reloads. Dev-only: returns 404 in
 * production (the panel is dev-only, and the payloads contain full prompts +
 * customer data — forensic prod access goes through the DB directly, not here).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isDev } from '@/lib/chat/debug'
import { logError } from '@/lib/errors/logger'
import type { DebugTurn } from '@/lib/debug/reducer'

const MAX_TURNS = 50

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDev()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { id } = await params

  try {
    const rows = await prisma.turnDebug.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'desc' },
      take: MAX_TURNS,
      select: { payload: true },
    })
    const turns = rows.map((r) => r.payload as unknown as DebugTurn)
    return NextResponse.json({ turns })
  } catch (err) {
    logError({
      layer: 'api',
      category: 'turn_debug',
      message: 'Failed to load conversation debug',
      context: { conversationId: id },
      error: err,
    })
    return NextResponse.json({ turns: [] })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/app/api/conversations/conversation-debug-route.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add app/api/conversations/[id]/debug/route.ts __tests__/app/api/conversations/conversation-debug-route.test.ts
git commit -m "feat(api): dev-only GET /api/conversations/[id]/debug"
```

---

### Task 8: Panel rehydration — `hydrate` in provider + fetch in ChatPage

**Files:**
- Modify: `components/debug/debug-provider.tsx`
- Modify: `components/chat/chat-page.tsx`

> The HYDRATE reducer logic is already covered by Task 3's `debugReducer` test. This task is thin client glue; verify via typecheck + the manual replay check in Step 5.

- [ ] **Step 1: Switch the provider to `debugReducer` and expose `hydrate`**

In `components/debug/debug-provider.tsx`:

Replace the import line:
```ts
import { EMPTY_STATE, reduceDebugEvent, type DebugState, type DebugTurn } from '@/lib/debug/reducer'
```
with:
```ts
import { EMPTY_STATE, debugReducer, type DebugTurn } from '@/lib/debug/reducer'
```

Replace the `useReducer` block:
```ts
  const [state, dispatch] = useReducer(
    (s: DebugState, e: DebugEvent | { type: 'CLEAR' }) =>
      'type' in e ? EMPTY_STATE : reduceDebugEvent(s, e),
    EMPTY_STATE,
  )
```
with:
```ts
  const [state, dispatch] = useReducer(debugReducer, EMPTY_STATE)
```

(The `import type { DebugEvent } from '@/lib/chat/debug'` at the top is still used by `onDebugEvent`; leave it.)

- [ ] **Step 2: Add `hydrate` to the context**

Add `hydrate` to the `DebugContextValue` interface:
```ts
  clearLog: () => void
  hydrate: (turns: DebugTurn[]) => void
}
```

Add the callback (next to `clearLog`):
```ts
  const clearLog = useCallback(() => dispatch({ type: 'CLEAR' }), [])
  const hydrate = useCallback((turns: DebugTurn[]) => dispatch({ type: 'HYDRATE', turns }), [])
```

Add it to the memoized value and its dependency array:
```ts
  const value = useMemo<DebugContextValue>(
    () => ({ enabled, setEnabled, turns: state.turns, onDebugEvent, extraHeaders, clearLog, hydrate }),
    [enabled, setEnabled, state.turns, onDebugEvent, extraHeaders, clearLog, hydrate],
  )
```

Add it to the no-provider fallback in `useDebug`:
```ts
    clearLog: () => undefined,
    hydrate: () => undefined,
  }
```

- [ ] **Step 3: Fetch + hydrate on conversation load in ChatPage**

In `components/chat/chat-page.tsx`:

Add to the React import:
```ts
import { useEffect, useState } from 'react'
```
Add the type import:
```ts
import type { DebugTurn } from '@/lib/debug/reducer'
```

After the `useChat(...)` call (and after `const debug = useDebug()`), add:
```ts
  // Replay this conversation's persisted debug turns into the panel on load
  // (and whenever debug is toggled on), so a refresh doesn't lose history.
  useEffect(() => {
    if (!debug.enabled || !conversationId) return
    let cancelled = false
    fetch(`/api/conversations/${conversationId}/debug`)
      .then((r) => (r.ok ? r.json() : { turns: [] }))
      .then((body: { turns: DebugTurn[] }) => {
        if (!cancelled) debug.hydrate(body.turns)
      })
      .catch(() => {
        /* dev-only convenience; ignore fetch failures */
      })
    return () => {
      cancelled = true
    }
  }, [conversationId, debug.enabled, debug.hydrate])
```

- [ ] **Step 4: Typecheck and run the suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm test`
Expected: PASS (full suite, including the reducer and route tests).

- [ ] **Step 5: Manual replay verification**

1. `npm run dev`, open the chat, toggle the debug drawer **on**.
2. Send 2-3 messages; confirm turn cards appear in the drawer.
3. **Reload the page.** Expected: the prior turns reappear in the drawer (fetched from `/api/conversations/<id>/debug` and hydrated), instead of the previous empty state.
4. Send another message; it prepends as a new live turn above the hydrated ones.

- [ ] **Step 6: Commit**

```bash
git add components/debug/debug-provider.tsx components/chat/chat-page.tsx
git commit -m "feat(debug-ui): rehydrate panel from persisted turns on load"
```

---

## Self-Review

**Spec coverage:**
- Dedicated `TurnDebug` table, keyed per conversation → Task 1. ✓
- Always-on write decoupled from the SSE gate → Tasks 4 (recordDebugEvent), 6 (recordAndYield records always; yields gated; identity always-built; persist at turn-end). `persistTurnDebug` takes no gate flag (Task 5). ✓
- Reuse `reduceDebugEvent` for the persisted shape → Task 2 (`buildTurnDebugPayload`). ✓
- `loadCustomerInsights` every turn for full identity fidelity → Task 6 Step 6 (gate removed). ✓
- Read path `GET /api/conversations/[id]/debug` → Task 7. ✓
- UI rehydration (`hydrate` + ChatPage effect) → Tasks 3 (`debugReducer` HYDRATE) + 8. ✓
- Idempotency by `traceId` → Task 1 (`@unique`) + Task 5 (`upsert`). ✓
- Fire-and-forget, errors swallowed → Task 5 + Task 6 Step 7 (`void`). ✓
- Disk JSONL left untouched → not modified by any task. ✓ (`debugYield` keeps its `writeDebugEvent` call.)
- Negative test on the new endpoint (CLAUDE.md rule) → Task 7 (404 outside dev; unknown id → empty). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows runnable assertions.

**Type consistency:** `DebugTurn`, `DebugState`, `DebugEvent`, `EMPTY_STATE`, `MAX_TURNS` come from `lib/debug/reducer.ts` / `lib/chat/debug.ts` as used. `recordDebugEvent(sink, event)`, `buildTurnDebugPayload(events)`, `debugReducer(state, action)`, `persistTurnDebug(input)`, and the `{ params: Promise<{ id: string }> }` route signature are consistent across their definition and call sites. `prisma.turnDebug` matches the model name in Task 1 (Prisma camelCases `TurnDebug` → `turnDebug`).

## Out of Scope (follow-ups)
- `TurnDebug` retention / pruning job (storage growth, PII lifecycle).
- Removing the now-redundant dev-only disk JSONL path once DB persistence is trusted.
