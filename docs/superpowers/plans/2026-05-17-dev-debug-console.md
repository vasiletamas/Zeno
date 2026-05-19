# Dev-Mode Debug Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a developer-only observability panel on the `/chat` surface that surfaces the reasoning gate decision, full assembled system prompt, and tool calls + results for each turn — with three-layer gating that guarantees zero presence in production builds.

**Architecture:** A single `debugYield(isDev, enabled, event)` helper in the chat orchestrator emits new `debug:*` SSE events alongside the existing chat stream. Emission only happens when `NODE_ENV === 'development'` AND the request carried `x-zeno-debug: 1`. The frontend reads the events via an optional `onDebugEvent` callback on `useChat`, accumulates them into per-turn cards using a pure reducer, and renders them in a right-side slide-out drawer. The entire UI is wrapped in `process.env.NODE_ENV === 'development'`, so Next.js dead-code-eliminates it from the prod client bundle.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Vitest, Tailwind v4, Base UI primitives, Server-Sent Events.

**Reference spec:** `docs/superpowers/specs/2026-05-17-dev-debug-console-design.md`

---

## File Structure

### Created

- `lib/chat/debug.ts` — `debugYield` helper, shared `DebugEvent` discriminated union, payload types
- `lib/debug/reducer.ts` — pure `reduceDebugEvent(state, event)` function and `DebugTurn` type
- `components/debug/debug-provider.tsx` — React Context owning turn log, toggle state, headers
- `components/debug/debug-drawer.tsx` — right-side slide-out panel
- `components/debug/debug-toggle.tsx` — floating bottom-right toggle button
- `components/debug/turn-card.tsx` — collapsible per-turn card
- `components/debug/sections/gate-section.tsx`
- `components/debug/sections/prompt-section.tsx`
- `components/debug/sections/tools-section.tsx`
- `__tests__/lib/chat/debug.test.ts` — unit tests for `debugYield`
- `__tests__/lib/debug/reducer.test.ts` — unit tests for `reduceDebugEvent`
- `__tests__/app/api/chat/route-debug-header.test.ts` — header → flag plumbing test

### Modified

- `lib/chat/stream-handler.ts` — widen `SSEEvent['event']` to allow `debug:*` names
- `lib/chat/orchestrator.ts` — accept `debugEnabled` in input; emit `debug:*` events at six insertion points
- `app/api/chat/route.ts` — read `x-zeno-debug` header, pass `debugEnabled` to `handleChatTurn`
- `lib/hooks/use-chat.ts` — add optional `onDebugEvent` callback and `extraHeaders` parameter; forward `debug:*` events; merge headers into the `fetch` call
- `app/chat/[id]/page.tsx` — wrap `<ChatPage>` in `<DebugProvider>`; mount `<DebugToggle />` + `<DebugDrawer />` (dev-only)
- `app/chat/page.tsx` — same wrapping if/when it renders chat directly (currently just redirects, but mount the dev wrapper for parity)
- `components/chat/chat-page.tsx` — pass `extraHeaders` and `onDebugEvent` from `useDebug()` context into `useChat(...)`

---

## Task 1: Shared debug types + `debugYield` helper

Establishes the single chokepoint through which every debug payload must pass. This is the most important file in the plan — the prod-safety guarantee lives here.

**Files:**
- Create: `lib/chat/debug.ts`
- Create: `__tests__/lib/chat/debug.test.ts`
- Modify: `lib/chat/stream-handler.ts:13` — widen the `event` type

- [ ] **Step 1: Widen the SSE event type to allow `debug:*` names**

Modify `lib/chat/stream-handler.ts` lines 12–15 to:

```ts
export interface SSEEvent {
  event:
    | 'content'
    | 'tool_start'
    | 'tool_complete'
    | 'ui_action'
    | 'error'
    | 'done'
    | 'status'
    | `debug:${string}`
  data: Record<string, unknown>
}
```

The template-literal type allows any `debug:foo` event without listing each one.

- [ ] **Step 2: Write the failing test for `debugYield`**

Create `__tests__/lib/chat/debug.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { debugYield, type DebugEvent } from '@/lib/chat/debug'

function collect(gen: Generator<unknown>): unknown[] {
  const out: unknown[] = []
  for (const x of gen) out.push(x)
  return out
}

const sample: DebugEvent = {
  event: 'debug:turn_start',
  data: { traceId: 't1', conversationId: 'c1', messageIndex: 0, userMessage: 'hi', language: 'en' },
}

describe('debugYield', () => {
  it('yields nothing when isDev=false (production)', () => {
    expect(collect(debugYield(false, true, sample))).toEqual([])
  })

  it('yields nothing when enabled=false (dev with panel off)', () => {
    expect(collect(debugYield(true, false, sample))).toEqual([])
  })

  it('yields nothing when both are false', () => {
    expect(collect(debugYield(false, false, sample))).toEqual([])
  })

  it('yields the event when isDev=true AND enabled=true', () => {
    expect(collect(debugYield(true, true, sample))).toEqual([sample])
  })
})
```

- [ ] **Step 3: Run the test — it should fail because `lib/chat/debug.ts` does not exist**

Run: `npx vitest run __tests__/lib/chat/debug.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/chat/debug"`.

- [ ] **Step 4: Implement `lib/chat/debug.ts`**

Create `lib/chat/debug.ts`:

```ts
/**
 * Dev-mode debug instrumentation for the chat orchestrator.
 *
 * Every debug SSE event passes through debugYield(). In production builds
 * (NODE_ENV !== 'development') the helper is a no-op, so no debug payloads
 * are ever serialized into the response. The `enabled` flag adds a per-
 * request opt-in driven by the `x-zeno-debug: 1` client header.
 */

import type { SSEEvent } from './stream-handler'
import type { ReasoningGateInput, ReasoningGateOutput } from './reasoning-gate'
import type { PromptSections } from './prompt-builder'

// ==============================================
// DEBUG EVENT PAYLOADS
// ==============================================

export interface DebugTurnStartPayload {
  traceId: string
  conversationId: string
  messageIndex: number
  userMessage: string
  language: 'en' | 'ro'
}

export interface DebugGatePayload {
  traceId: string
  skipped: boolean
  reason?: 'fast_path' | 'synthetic'
  input?: ReasoningGateInput
  output?: ReasoningGateOutput
  durationMs: number
}

export interface DebugPromptPayload {
  traceId: string
  sections: PromptSections
  sectionSizes: Record<string, number>
  includedSections: string[]
  excludedSections: string[]
  gateActive: boolean
  stablePrefix: string | null
  dynamicSuffix: string | null
  totalChars: number
}

export interface DebugToolCallPayload {
  traceId: string
  round: number
  toolCallId: string
  name: string
  args: Record<string, unknown>
  partition: 'readOnly' | 'writing' | 'background'
}

export interface DebugToolResultPayload {
  traceId: string
  toolCallId: string
  success: boolean
  durationMs: number
  cached: boolean
  data?: unknown
  error?: string
  uiAction?: Record<string, unknown>
  transition?: Record<string, unknown>
}

export interface DebugTurnEndPayload {
  traceId: string
  phases: Record<string, unknown>
  totalInputTokens: number
  totalOutputTokens: number
  cost: number | null
  latencyMs: number
  anomalies: unknown[]
}

// ==============================================
// DEBUG EVENT UNION (the wire format)
// ==============================================

export type DebugEvent =
  | { event: 'debug:turn_start'; data: DebugTurnStartPayload }
  | { event: 'debug:gate'; data: DebugGatePayload }
  | { event: 'debug:prompt'; data: DebugPromptPayload }
  | { event: 'debug:tool_call'; data: DebugToolCallPayload }
  | { event: 'debug:tool_result'; data: DebugToolResultPayload }
  | { event: 'debug:turn_end'; data: DebugTurnEndPayload }

// ==============================================
// THE GATING HELPER
// ==============================================

/**
 * Yields the given debug event only when running in development AND the per-
 * request enabled flag is true. In every other case it yields nothing.
 *
 * This is the single chokepoint for all debug emissions in the orchestrator.
 */
export function* debugYield(
  isDev: boolean,
  enabled: boolean,
  event: DebugEvent,
): Generator<SSEEvent> {
  if (isDev && enabled) yield event
}

// ==============================================
// MODULE-LEVEL DEV FLAG
// ==============================================

/**
 * True iff the server is running with NODE_ENV === 'development'.
 *
 * Evaluated lazily so vi.stubEnv() works after this module has been
 * imported — otherwise tests that flip NODE_ENV at runtime would be
 * silently ignored.
 */
export function isDev(): boolean {
  return process.env.NODE_ENV === 'development'
}
```

- [ ] **Step 5: Run the test — it should pass**

Run: `npx vitest run __tests__/lib/chat/debug.test.ts`
Expected: PASS, 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add lib/chat/debug.ts lib/chat/stream-handler.ts __tests__/lib/chat/debug.test.ts
git commit -m "feat(debug): add debugYield helper and shared debug event types"
```

---

## Task 2: Plumb `debugEnabled` from request header into orchestrator input

The route handler reads `x-zeno-debug: 1` and passes a `debugEnabled` flag into `handleChatTurn`. This is the per-request opt-in — without it, the orchestrator skips emission even in dev.

**Files:**
- Modify: `lib/chat/orchestrator.ts:102-108` — add `debugEnabled` to `ChatTurnInput`
- Modify: `app/api/chat/route.ts` — read header, pass flag
- Create: `__tests__/app/api/chat/route-debug-header.test.ts`

- [ ] **Step 1: Add `debugEnabled` to `ChatTurnInput`**

In `lib/chat/orchestrator.ts`, modify the `ChatTurnInput` interface (around line 102):

```ts
export interface ChatTurnInput {
  conversationId?: string
  customerId?: string
  message: string
  language?: 'en' | 'ro'
  syntheticToolCall?: ToolCall
  debugEnabled?: boolean
}
```

Then in `chatTurnGenerator` (around line 151), add a local constant near the top of the generator (just after `initObservability()`):

```ts
const debugEnabled = input.debugEnabled === true
```

We will use this in every subsequent task to gate emissions. No emissions yet — this task only plumbs the flag.

- [ ] **Step 2: Write the failing route-handler test**

Create `__tests__/app/api/chat/route-debug-header.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the handleChatTurn arguments so we can assert on them
const handleChatTurnSpy = vi.fn(() => new ReadableStream({ start(c) { c.close() } }))

vi.mock('@/lib/chat/orchestrator', () => ({
  handleChatTurn: (input: unknown) => handleChatTurnSpy(input),
}))
vi.mock('@/lib/chat/action-adapter', () => ({ adaptAction: () => undefined }))
vi.mock('@/lib/errors/logger', () => ({ logError: vi.fn(), logFatal: vi.fn() }))

const { POST } = await import('@/app/api/chat/route')

function makeRequest(headers: Record<string, string>) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ conversationId: 'c1', customerId: 'cust1', message: 'hi' }),
  }) as unknown as import('next/server').NextRequest
}

describe('POST /api/chat — x-zeno-debug header', () => {
  beforeEach(() => handleChatTurnSpy.mockClear())

  it('passes debugEnabled=true when x-zeno-debug: 1 is present', async () => {
    await POST(makeRequest({ 'x-zeno-debug': '1' }))
    expect(handleChatTurnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ debugEnabled: true }),
    )
  })

  it('passes debugEnabled=false when the header is missing', async () => {
    await POST(makeRequest({}))
    expect(handleChatTurnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ debugEnabled: false }),
    )
  })

  it('passes debugEnabled=false when the header has any other value', async () => {
    await POST(makeRequest({ 'x-zeno-debug': '0' }))
    expect(handleChatTurnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ debugEnabled: false }),
    )
  })
})
```

- [ ] **Step 3: Run the test — it should fail**

Run: `npx vitest run __tests__/app/api/chat/route-debug-header.test.ts`
Expected: FAIL — calls do not include `debugEnabled`.

- [ ] **Step 4: Read the header in the route handler**

In `app/api/chat/route.ts`, locate the `handleChatTurn` call (around line 79) and modify it to:

```ts
const debugEnabled = request.headers.get('x-zeno-debug') === '1'

let stream: ReadableStream<Uint8Array>
try {
  stream = handleChatTurn({
    conversationId: parsed.conversationId,
    customerId: parsed.customerId,
    message,
    language: parsed.language,
    syntheticToolCall,
    debugEnabled,
  })
} catch (err) {
  // ... existing error handling
}
```

- [ ] **Step 5: Run the test — it should pass**

Run: `npx vitest run __tests__/app/api/chat/route-debug-header.test.ts`
Expected: PASS, 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add lib/chat/orchestrator.ts app/api/chat/route.ts __tests__/app/api/chat/route-debug-header.test.ts
git commit -m "feat(debug): plumb x-zeno-debug header into ChatTurnInput.debugEnabled"
```

---

## Task 3: Emit `debug:turn_start` and `debug:turn_end` events

These are the bookends. Adding them first lets us verify the full pipeline (server → SSE → wire format) before adding the other four events.

**Files:**
- Modify: `lib/chat/orchestrator.ts` — insert two `yield* debugYield(...)` calls

- [ ] **Step 1: Import `debugYield` and `isDev` in the orchestrator**

At the top of `lib/chat/orchestrator.ts`, add to the existing imports:

```ts
import { debugYield, isDev } from './debug'
```

- [ ] **Step 2: Emit `debug:turn_start` near the start of `chatTurnGenerator`**

Find the existing `eventBus.emit({ type: 'turn:start', ... })` call (around line 175). Immediately after it, add:

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

- [ ] **Step 3: Emit `debug:turn_end` just before the final `done` yield**

Find the final `yield { event: 'done', ... }` (around line 1283). Immediately before it, add:

```ts
yield* debugYield(isDev(), debugEnabled, {
  event: 'debug:turn_end',
  data: {
    traceId: state.traceId,
    phases: state.phases,
    totalInputTokens: state.totalInputTokens,
    totalOutputTokens: state.totalOutputTokens,
    cost: getTurnCost(state.traceId),
    latencyMs,
    anomalies: getTurnAnomalies(state.traceId),
  },
})
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no new errors. If TypeScript complains about the SSEEvent generic in `debugYield`'s return, double-check that Task 1 widened the `event` field to include `` `debug:${string}` ``.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Manual runtime verification (dev mode)**

The dev server should already be running on `http://localhost:3000`. If not:
```bash
npm run dev
```

Then in a second terminal:
```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -H 'x-zeno-debug: 1' \
  -d '{"customerId":"","message":"hello","language":"en"}' \
  | head -20
```

Expected: among the SSE output, you should see at least one line starting with `event: debug:turn_start` and (at the very end) `event: debug:turn_end`.

Then verify the opt-out:
```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"customerId":"","message":"hello","language":"en"}' \
  | grep '^event:'
```

Expected: no `event: debug:*` lines should appear.

- [ ] **Step 6: Commit**

```bash
git add lib/chat/orchestrator.ts
git commit -m "feat(debug): emit debug:turn_start and debug:turn_end SSE events"
```

---

## Task 4: Emit `debug:gate` event with all three branches

The gate has three execution paths: fast-path skip, synthetic-action skip, full gate run. Emit a `debug:gate` event for each.

**Files:**
- Modify: `lib/chat/orchestrator.ts` — three emissions inside `gatePromise`

- [ ] **Step 1: Build a local `gateDebug` accumulator inside `gatePromise`**

Currently, `gatePromise` (around line 302) is structured as an IIFE that returns `{ gateOutput, gateSelection }`. We need to also return the data needed to emit a `debug:gate` event from outside the IIFE, since `yield*` cannot be called inside a nested async function.

Change `gatePromise`'s return type to:

```ts
const gatePromise = (async (): Promise<{
  gateOutput: ReasoningGateOutput | null
  gateSelection: GateSelection
  gateDebug: {
    skipped: boolean
    reason?: 'fast_path' | 'synthetic'
    input?: ReasoningGateInput
    output?: ReasoningGateOutput
    durationMs: number
  }
}> => {
  // ...
})()
```

Inside the IIFE, build the `gateDebug` object in each of the three branches:

```ts
// In the fast-path branch (after `gateSelection = FAST_PATH_GATE`):
const gateDebug = {
  skipped: true,
  reason: 'fast_path' as const,
  durationMs: 0,
}
return { gateOutput, gateSelection, gateDebug }
```

```ts
// In the synthetic branch:
const gateDebug = {
  skipped: true,
  reason: 'synthetic' as const,
  durationMs: 0,
}
return { gateOutput, gateSelection, gateDebug }
```

```ts
// In the full-gate branch (at the bottom, after `state.phases['reasoningGate']` is set):
const gateDebug = {
  skipped: false,
  input: gateInput,
  output: gateOutput ?? undefined,
  durationMs: Date.now() - gateStart,
}
// (then existing return)
return { gateOutput, gateSelection, gateDebug }
```

Be sure to declare `gateInput` outside the inner `try` block so it remains in scope for `gateDebug` even on error, or move the assignment up.

- [ ] **Step 2: Emit `debug:gate` after `Promise.all([gatePromise, contextPromise])`**

Find the line `const [gateResult, contextResult] = await Promise.all([gatePromise, contextPromise])` (around line 486). Immediately after destructuring `gateResult`, add:

```ts
yield* debugYield(isDev(), debugEnabled, {
  event: 'debug:gate',
  data: { traceId: state.traceId, ...gateResult.gateDebug },
})
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. If `gateInput` is reported as possibly undefined, hoist its declaration above the `try`.

- [ ] **Step 4: Manual runtime verification — fast-path branch**

A short factual greeting should hit the fast-path. Send:
```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -H 'x-zeno-debug: 1' \
  -d '{"customerId":"","message":"buna","language":"ro"}' \
  | grep -A1 'debug:gate'
```

Expected: one `event: debug:gate` line whose JSON `data` field contains `"skipped":true,"reason":"fast_path"`.

- [ ] **Step 5: Manual runtime verification — full-gate branch**

A nuanced question should run the full gate. Send:
```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -H 'x-zeno-debug: 1' \
  -d '{"customerId":"","message":"Cum se compara Protect cu Liberty pentru cineva cu copii?","language":"ro"}' \
  | grep -A1 'debug:gate'
```

Expected: one `event: debug:gate` whose data has `"skipped":false` and an `output` field with `complexity`, `situationType`, `confidence`.

- [ ] **Step 6: Commit**

```bash
git add lib/chat/orchestrator.ts
git commit -m "feat(debug): emit debug:gate event for fast-path, synthetic, and full branches"
```

---

## Task 5: Emit `debug:prompt` event after `buildPrompt`

Surfaces the actual system prompt the LLM saw, broken out by section.

**Files:**
- Modify: `lib/chat/orchestrator.ts` — emission after `buildPrompt(...)`

- [ ] **Step 1: Emit `debug:prompt` right after `buildPrompt` returns**

Find the line `const buildResult = buildPrompt(mergedSections, gateSelection)` (around line 598). Immediately after it (before the existing comment about `STEP 4b`), add:

```ts
yield* debugYield(isDev(), debugEnabled, {
  event: 'debug:prompt',
  data: {
    traceId: state.traceId,
    sections: mergedSections,
    sectionSizes: buildResult.sectionSizes,
    includedSections: buildResult.includedSections,
    excludedSections: buildResult.excludedSections,
    gateActive: buildResult.gateActive,
    stablePrefix: buildResult.stablePrefix ?? null,
    dynamicSuffix: buildResult.dynamicSuffix ?? null,
    totalChars: (buildResult.stablePrefix?.length ?? 0) + (buildResult.dynamicSuffix?.length ?? 0),
  },
})
```

Note: `mergedSections` is the merged `PromptSections` object after skill-pack merging — exactly what `buildPrompt` saw. `buildResult.sectionSizes`, `includedSections`, `excludedSections`, `gateActive`, `stablePrefix`, `dynamicSuffix` are all already exposed on the existing `buildResult`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. If `mergedSections` is reported as `Record<string, string | null>` instead of `PromptSections`, cast it: `mergedSections as PromptSections`.

- [ ] **Step 3: Manual runtime verification**

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -H 'x-zeno-debug: 1' \
  -d '{"customerId":"","message":"buna","language":"ro"}' \
  | grep -A1 'debug:prompt'
```

Expected: one `event: debug:prompt` line whose JSON contains a `sections` object with keys like `agentIdentity`, `constraints`, `customerContext`, etc., and an `includedSections` array.

- [ ] **Step 4: Commit**

```bash
git add lib/chat/orchestrator.ts
git commit -m "feat(debug): emit debug:prompt event with assembled system prompt"
```

---

## Task 6: Emit `debug:tool_call` and `debug:tool_result` at all four call sites

The orchestrator calls `executeToolWithPipeline` from four places: synthetic, read-only batch, writing, background.

**Files:**
- Modify: `lib/chat/orchestrator.ts` — six insertions (call+result at 3 sites + 2 at the background site)

- [ ] **Step 1: Synthetic tool call site (around line 713)**

Before the existing `const pipelineResult = await executeToolWithPipeline(...)` for synthetic, add:

```ts
yield* debugYield(isDev(), debugEnabled, {
  event: 'debug:tool_call',
  data: {
    traceId: state.traceId,
    round: 0,
    toolCallId: tc.id,
    name: tc.name,
    args: tc.arguments,
    partition: (def?.sideEffects === false ? 'readOnly' : 'writing'),
  },
})

const synthStart = Date.now()
```

After the `pipelineResult` is assigned, add:

```ts
yield* debugYield(isDev(), debugEnabled, {
  event: 'debug:tool_result',
  data: {
    traceId: state.traceId,
    toolCallId: tc.id,
    success: pipelineResult.toolResult.success,
    durationMs: Date.now() - synthStart,
    cached: false,
    data: pipelineResult.toolResult.data,
    error: pipelineResult.toolResult.error,
    uiAction: pipelineResult.toolResult.uiAction as Record<string, unknown> | undefined,
    transition: pipelineResult.transition as Record<string, unknown> | undefined,
  },
})
```

- [ ] **Step 2: Background tool site (around line 916, inside `for (const tc of background)`)**

The background loop is `void executeToolWithPipeline(...)` (fire-and-forget). Add a `debug:tool_call` before the void call and a synthetic `debug:tool_result` immediately after — matching what the LLM sees:

```ts
yield* debugYield(isDev(), debugEnabled, {
  event: 'debug:tool_call',
  data: {
    traceId: state.traceId,
    round,
    toolCallId: tc.id,
    name: tc.name,
    args: tc.arguments,
    partition: 'background',
  },
})

void executeToolWithPipeline(/* existing args */).catch(/* existing handler */)

yield* debugYield(isDev(), debugEnabled, {
  event: 'debug:tool_result',
  data: {
    traceId: state.traceId,
    toolCallId: tc.id,
    success: true,
    durationMs: 0,
    cached: false,
    data: { backgroundFireAndForget: true },
  },
})
```

- [ ] **Step 3: Read-only parallel batch site (around line 944)**

Inside the existing `if (readOnly.length > 0)` block, before the existing `for (const tc of readOnly)` that emits `tool_start`, add a separate loop that emits `debug:tool_call` for each (so the calls appear before any results):

```ts
for (const tc of readOnly) {
  yield* debugYield(isDev(), debugEnabled, {
    event: 'debug:tool_call',
    data: {
      traceId: state.traceId,
      round,
      toolCallId: tc.id,
      name: tc.name,
      args: tc.arguments,
      partition: 'readOnly',
    },
  })
}
```

Then in the `for (let i = 0; i < readOnly.length; i++)` loop where results are processed (around line 979), after `resultMap.set(tc.id, { pipelineResult, def })`, add:

```ts
yield* debugYield(isDev(), debugEnabled, {
  event: 'debug:tool_result',
  data: {
    traceId: state.traceId,
    toolCallId: tc.id,
    success: pipelineResult.toolResult.success,
    durationMs: 0, // parallel — no per-call timing available
    cached: false,
    data: pipelineResult.toolResult.data,
    error: pipelineResult.toolResult.error,
    uiAction: pipelineResult.toolResult.uiAction as Record<string, unknown> | undefined,
    transition: pipelineResult.transition as Record<string, unknown> | undefined,
  },
})
```

- [ ] **Step 4: Writing sequential site (around line 997, inside `for (const tc of writing)`)**

Before the existing `let pipelineResult: PipelineResult` line, add:

```ts
yield* debugYield(isDev(), debugEnabled, {
  event: 'debug:tool_call',
  data: {
    traceId: state.traceId,
    round,
    toolCallId: tc.id,
    name: tc.name,
    args: tc.arguments,
    partition: 'writing',
  },
})

const writeStart = Date.now()
```

After `resultMap.set(tc.id, { pipelineResult, def })` (around line 1031), add:

```ts
yield* debugYield(isDev(), debugEnabled, {
  event: 'debug:tool_result',
  data: {
    traceId: state.traceId,
    toolCallId: tc.id,
    success: pipelineResult.toolResult.success,
    durationMs: Date.now() - writeStart,
    cached: false,
    data: pipelineResult.toolResult.data,
    error: pipelineResult.toolResult.error,
    uiAction: pipelineResult.toolResult.uiAction as Record<string, unknown> | undefined,
    transition: pipelineResult.transition as Record<string, unknown> | undefined,
  },
})
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 6: Manual runtime verification**

Trigger a turn that uses tools. For example, asking about a product should fire `list_products` or similar:
```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -H 'x-zeno-debug: 1' \
  -d '{"customerId":"","message":"ce produse aveti?","language":"ro"}' \
  | grep -E '^event: debug:tool'
```

Expected: one or more pairs of `event: debug:tool_call` and `event: debug:tool_result`. If the conversation didn't fire any tools, send a message likely to trigger one (e.g. asking about quotes or products).

- [ ] **Step 7: Commit**

```bash
git add lib/chat/orchestrator.ts
git commit -m "feat(debug): emit debug:tool_call and debug:tool_result at all 4 sites"
```

---

## Task 7: Client reducer `reduceDebugEvent`

A pure function that takes the current per-turn map and a debug event, returning the updated map. Pure = trivially unit-testable, no DOM needed.

**Files:**
- Create: `lib/debug/reducer.ts`
- Create: `__tests__/lib/debug/reducer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/debug/reducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reduceDebugEvent, type DebugState, EMPTY_STATE } from '@/lib/debug/reducer'
import type { DebugEvent } from '@/lib/chat/debug'

function start(traceId: string, idx: number): DebugEvent {
  return {
    event: 'debug:turn_start',
    data: { traceId, conversationId: 'c1', messageIndex: idx, userMessage: 'hi', language: 'en' },
  }
}

function gate(traceId: string): DebugEvent {
  return {
    event: 'debug:gate',
    data: { traceId, skipped: true, reason: 'fast_path', durationMs: 0 },
  }
}

function end(traceId: string): DebugEvent {
  return {
    event: 'debug:turn_end',
    data: {
      traceId,
      phases: {},
      totalInputTokens: 1,
      totalOutputTokens: 2,
      cost: 0.001,
      latencyMs: 100,
      anomalies: [],
    },
  }
}

describe('reduceDebugEvent', () => {
  it('creates a new turn on debug:turn_start', () => {
    const s = reduceDebugEvent(EMPTY_STATE, start('t1', 0))
    expect(s.turns).toHaveLength(1)
    expect(s.turns[0].traceId).toBe('t1')
    expect(s.turns[0].userMessage).toBe('hi')
    expect(s.turns[0].toolCalls).toEqual([])
  })

  it('attaches debug:gate payload to the matching turn', () => {
    let s = reduceDebugEvent(EMPTY_STATE, start('t1', 0))
    s = reduceDebugEvent(s, gate('t1'))
    expect(s.turns[0].gate).toEqual({ skipped: true, reason: 'fast_path', durationMs: 0 })
  })

  it('stamps endedAt and totals on debug:turn_end', () => {
    let s = reduceDebugEvent(EMPTY_STATE, start('t1', 0))
    s = reduceDebugEvent(s, end('t1'))
    expect(s.turns[0].endedAt).toBeDefined()
    expect(s.turns[0].totals?.totalInputTokens).toBe(1)
    expect(s.turns[0].totals?.latencyMs).toBe(100)
  })

  it('matches a debug:tool_result to its prior debug:tool_call by toolCallId', () => {
    let s = reduceDebugEvent(EMPTY_STATE, start('t1', 0))
    s = reduceDebugEvent(s, {
      event: 'debug:tool_call',
      data: { traceId: 't1', round: 0, toolCallId: 'tc1', name: 'list_products', args: {}, partition: 'readOnly' },
    })
    s = reduceDebugEvent(s, {
      event: 'debug:tool_result',
      data: { traceId: 't1', toolCallId: 'tc1', success: true, durationMs: 5, cached: false, data: { ok: true } },
    })
    expect(s.turns[0].toolCalls).toHaveLength(1)
    expect(s.turns[0].toolCalls[0].name).toBe('list_products')
    expect(s.turns[0].toolCalls[0].result?.success).toBe(true)
  })

  it('keeps newest turn first and caps at 50', () => {
    let s = EMPTY_STATE
    for (let i = 0; i < 55; i++) {
      s = reduceDebugEvent(s, start(`t${i}`, i))
    }
    expect(s.turns).toHaveLength(50)
    expect(s.turns[0].traceId).toBe('t54')
    expect(s.turns[49].traceId).toBe('t5')
  })

  it('ignores events for unknown traceIds (no turn_start seen)', () => {
    const s = reduceDebugEvent(EMPTY_STATE, gate('unknown'))
    expect(s.turns).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test — it should fail**

Run: `npx vitest run __tests__/lib/debug/reducer.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/debug/reducer"`.

- [ ] **Step 3: Implement `lib/debug/reducer.ts`**

Create `lib/debug/reducer.ts`:

```ts
/**
 * Pure reducer for the debug panel state.
 *
 * Accumulates debug:* events (forwarded by useChat) into a list of per-turn
 * cards keyed by traceId. Newest turn first; capped at MAX_TURNS to bound
 * memory.
 */

import type {
  DebugEvent,
  DebugGatePayload,
  DebugPromptPayload,
  DebugToolCallPayload,
  DebugToolResultPayload,
  DebugTurnEndPayload,
} from '@/lib/chat/debug'

const MAX_TURNS = 50

export interface DebugTurnToolCall {
  round: number
  toolCallId: string
  name: string
  args: Record<string, unknown>
  partition: 'readOnly' | 'writing' | 'background'
  result?: DebugToolResultPayload
}

export interface DebugTurn {
  traceId: string
  conversationId: string
  messageIndex: number
  userMessage: string
  language: 'en' | 'ro'
  startedAt: number
  gate?: Omit<DebugGatePayload, 'traceId'>
  prompt?: Omit<DebugPromptPayload, 'traceId'>
  toolCalls: DebugTurnToolCall[]
  endedAt?: number
  totals?: Omit<DebugTurnEndPayload, 'traceId'>
}

export interface DebugState {
  /** Newest turn first. */
  turns: DebugTurn[]
}

export const EMPTY_STATE: DebugState = { turns: [] }

function updateTurn(
  state: DebugState,
  traceId: string,
  patch: (t: DebugTurn) => DebugTurn,
): DebugState {
  const idx = state.turns.findIndex((t) => t.traceId === traceId)
  if (idx === -1) return state
  const next = state.turns.slice()
  next[idx] = patch(next[idx])
  return { turns: next }
}

export function reduceDebugEvent(state: DebugState, event: DebugEvent): DebugState {
  switch (event.event) {
    case 'debug:turn_start': {
      const turn: DebugTurn = {
        traceId: event.data.traceId,
        conversationId: event.data.conversationId,
        messageIndex: event.data.messageIndex,
        userMessage: event.data.userMessage,
        language: event.data.language,
        startedAt: Date.now(),
        toolCalls: [],
      }
      const turns = [turn, ...state.turns].slice(0, MAX_TURNS)
      return { turns }
    }

    case 'debug:gate': {
      const { traceId, ...rest } = event.data
      return updateTurn(state, traceId, (t) => ({ ...t, gate: rest }))
    }

    case 'debug:prompt': {
      const { traceId, ...rest } = event.data
      return updateTurn(state, traceId, (t) => ({ ...t, prompt: rest }))
    }

    case 'debug:tool_call': {
      const { traceId, ...rest } = event.data
      return updateTurn(state, traceId, (t) => ({
        ...t,
        toolCalls: [...t.toolCalls, rest as DebugTurnToolCall],
      }))
    }

    case 'debug:tool_result': {
      const { traceId } = event.data
      return updateTurn(state, traceId, (t) => ({
        ...t,
        toolCalls: t.toolCalls.map((tc) =>
          tc.toolCallId === event.data.toolCallId ? { ...tc, result: event.data } : tc,
        ),
      }))
    }

    case 'debug:turn_end': {
      const { traceId, ...rest } = event.data
      return updateTurn(state, traceId, (t) => ({
        ...t,
        endedAt: Date.now(),
        totals: rest,
      }))
    }
  }
}
```

- [ ] **Step 4: Run the test — it should pass**

Run: `npx vitest run __tests__/lib/debug/reducer.test.ts`
Expected: PASS, 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/debug/reducer.ts __tests__/lib/debug/reducer.test.ts
git commit -m "feat(debug): pure reducer reduceDebugEvent + DebugTurn types"
```

---

## Task 8: Extend `useChat` with `onDebugEvent` callback and `extraHeaders`

Two optional parameters. Existing callers pass nothing → existing behavior unchanged.

**Files:**
- Modify: `lib/hooks/use-chat.ts`

- [ ] **Step 1: Add the new parameters and headers merge**

In `lib/hooks/use-chat.ts`, modify the `useChat` signature (around line 80):

```ts
export interface UseChatOptions {
  initialMessages?: ChatMessage[]
  onDebugEvent?: (event: { event: string; data: Record<string, unknown> }) => void
  extraHeaders?: Record<string, string>
}

export function useChat(
  conversationId: string,
  customerId: string,
  options: UseChatOptions = {},
): UseChatReturn {
  const { initialMessages, onDebugEvent, extraHeaders } = options
  // ... rest of the existing function
}
```

For backward compatibility with the existing call site that passes `initialMessages` as a third positional argument, you have two options:

**Option A (cleaner, requires updating callers):** Just change the signature. Then in Task 12 we'll update `components/chat/chat-page.tsx` to pass options.

**Option B (backward compat):** Accept either shape — detect by checking if the third arg is an array.

Use Option A — there is exactly one caller (`components/chat/chat-page.tsx`) and it's already going to be touched in Task 12.

Update the third-parameter destructure at line 85:
```ts
const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? [])
```
(no change needed — `initialMessages` is now from `options`).

- [ ] **Step 2: Merge `extraHeaders` into the two fetch calls**

There are two `fetch('/api/chat', ...)` calls in this file (`sendMessage` ~line 146 and `sendAction` ~line 341). In each, change:

```ts
headers: { 'Content-Type': 'application/json' },
```

to:

```ts
headers: { 'Content-Type': 'application/json', ...(extraHeaders ?? {}) },
```

- [ ] **Step 3: Forward `debug:*` events to `onDebugEvent`**

In each `switch (sseEvent.event)` block (two places: `sendMessage` ~line 190 and `sendAction` ~line 382), add a default branch at the bottom that forwards debug events:

```ts
default: {
  if (sseEvent.event.startsWith('debug:') && onDebugEvent) {
    onDebugEvent({ event: sseEvent.event, data })
  }
  break
}
```

- [ ] **Step 4: Update the existing call site to use options form**

In `components/chat/chat-page.tsx`, change line ~35 from:

```ts
} = useChat(conversationId, customerId, initialMessages)
```

to:

```ts
} = useChat(conversationId, customerId, { initialMessages })
```

(In Task 12 we'll add `onDebugEvent` and `extraHeaders` to this options object.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. If TypeScript complains that the existing tests pass `initialMessages` positionally, update them similarly (search: `useChat(`).

- [ ] **Step 6: Manual runtime verification**

Reload `/chat/...` in the browser and send a message. Confirm chat still works (the change should be a pure refactor of the call shape with no behavior change).

- [ ] **Step 7: Commit**

```bash
git add lib/hooks/use-chat.ts components/chat/chat-page.tsx
git commit -m "feat(debug): add onDebugEvent + extraHeaders options to useChat"
```

---

## Task 9: `DebugProvider` React Context

Owns the on/off toggle (localStorage-backed), the turn log (via `reduceDebugEvent`), and exposes `extraHeaders` and `onDebugEvent` for `useChat`.

**Files:**
- Create: `components/debug/debug-provider.tsx`

- [ ] **Step 1: Implement the provider**

Create `components/debug/debug-provider.tsx`:

```tsx
'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react'
import type { DebugEvent } from '@/lib/chat/debug'
import { EMPTY_STATE, reduceDebugEvent, type DebugState, type DebugTurn } from '@/lib/debug/reducer'

const STORAGE_KEY = 'zeno_debug'

interface DebugContextValue {
  enabled: boolean
  setEnabled: (b: boolean) => void
  turns: DebugTurn[]
  onDebugEvent: (event: { event: string; data: Record<string, unknown> }) => void
  extraHeaders: Record<string, string>
  clearLog: () => void
}

const DebugContext = createContext<DebugContextValue | null>(null)

export function DebugProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(false)

  // Hydrate enabled from localStorage (client-only)
  useEffect(() => {
    try {
      setEnabledState(window.localStorage.getItem(STORAGE_KEY) === '1')
    } catch {
      // ignore
    }
  }, [])

  const setEnabled = useCallback((b: boolean) => {
    setEnabledState(b)
    try {
      if (b) window.localStorage.setItem(STORAGE_KEY, '1')
      else window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }, [])

  const [state, dispatch] = useReducer(
    (s: DebugState, e: DebugEvent | { type: 'CLEAR' }) =>
      'type' in e ? EMPTY_STATE : reduceDebugEvent(s, e),
    EMPTY_STATE,
  )

  const onDebugEvent = useCallback(
    (event: { event: string; data: Record<string, unknown> }) => {
      // Cast narrows to DebugEvent — the orchestrator guarantees this shape
      dispatch(event as DebugEvent)
    },
    [],
  )

  const extraHeaders = useMemo<Record<string, string>>(
    () => (enabled ? { 'x-zeno-debug': '1' } : {}),
    [enabled],
  )

  const clearLog = useCallback(() => dispatch({ type: 'CLEAR' }), [])

  const value = useMemo<DebugContextValue>(
    () => ({ enabled, setEnabled, turns: state.turns, onDebugEvent, extraHeaders, clearLog }),
    [enabled, setEnabled, state.turns, onDebugEvent, extraHeaders, clearLog],
  )

  return <DebugContext.Provider value={value}>{children}</DebugContext.Provider>
}

/**
 * Returns the debug context, or a no-op fallback when not wrapped in a
 * DebugProvider. The fallback is what production builds get, since the
 * provider is only mounted in dev.
 */
export function useDebug(): DebugContextValue {
  const ctx = useContext(DebugContext)
  if (ctx) return ctx
  return {
    enabled: false,
    setEnabled: () => undefined,
    turns: [],
    onDebugEvent: () => undefined,
    extraHeaders: {},
    clearLog: () => undefined,
  }
}
```

The no-op fallback is important: in prod, `chat-page.tsx` will still call `useDebug()` but the provider won't be mounted, so `useDebug()` must return safe defaults.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/debug/debug-provider.tsx
git commit -m "feat(debug): DebugProvider context with localStorage toggle + reducer"
```

---

## Task 10: `DebugToggle` floating button (dev-only mount)

Bottom-right floating button that opens the drawer. Wrapped in `NODE_ENV === 'development'` so it dead-code-eliminates from prod builds.

**Files:**
- Create: `components/debug/debug-toggle.tsx`

- [ ] **Step 1: Implement the toggle button**

Create `components/debug/debug-toggle.tsx`:

```tsx
'use client'

import { useDebug } from './debug-provider'

interface DebugToggleProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DebugToggle({ open, onOpenChange }: DebugToggleProps) {
  // Build-time dead-code elimination guard. Next.js inlines this constant.
  if (process.env.NODE_ENV !== 'development') return null

  const { enabled, turns } = useDebug()

  return (
    <button
      type="button"
      data-testid="debug-toggle"
      onClick={() => onOpenChange(!open)}
      title={enabled ? 'Debug console (on)' : 'Debug console (off)'}
      className="fixed bottom-4 right-4 z-50 flex h-10 items-center gap-2 rounded-full border border-black/10 bg-white px-3 text-xs font-mono shadow-md hover:shadow-lg transition-shadow"
    >
      <span
        className={`h-2 w-2 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-gray-400'}`}
      />
      <span>debug</span>
      {enabled && turns.length > 0 && (
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">{turns.length}</span>
      )}
    </button>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/debug/debug-toggle.tsx
git commit -m "feat(debug): DebugToggle floating button (dev-only)"
```

---

## Task 11: `DebugDrawer` + `TurnCard` + 3 sub-sections

The actual visible UI. Right-side slide-out, list of turn cards, three collapsibles per turn.

**Files:**
- Create: `components/debug/debug-drawer.tsx`
- Create: `components/debug/turn-card.tsx`
- Create: `components/debug/sections/gate-section.tsx`
- Create: `components/debug/sections/prompt-section.tsx`
- Create: `components/debug/sections/tools-section.tsx`

- [ ] **Step 1: Implement `gate-section.tsx`**

Create `components/debug/sections/gate-section.tsx`:

```tsx
import type { DebugTurn } from '@/lib/debug/reducer'

export function GateSection({ gate }: { gate: DebugTurn['gate'] }) {
  if (!gate) return <p className="text-xs text-gray-500">No gate data yet.</p>

  if (gate.skipped) {
    return (
      <div className="space-y-1 text-xs">
        <p className="font-mono">
          <span className="font-semibold">Skipped:</span> {gate.reason}
        </p>
      </div>
    )
  }

  const out = gate.output
  return (
    <div className="space-y-2 text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono">
        {out?.complexity && <><dt>complexity</dt><dd>{out.complexity}</dd></>}
        {out?.situationType && <><dt>situationType</dt><dd>{out.situationType}</dd></>}
        {typeof out?.confidence === 'number' && <><dt>confidence</dt><dd>{out.confidence.toFixed(2)}</dd></>}
        {out?.modeTransition && <><dt>modeTransition</dt><dd>{out.modeTransition}</dd></>}
        <dt>durationMs</dt><dd>{gate.durationMs}</dd>
      </dl>
      {out?.recommendedSkillPacks && out.recommendedSkillPacks.length > 0 && (
        <p className="font-mono">skillPacks: {out.recommendedSkillPacks.join(', ')}</p>
      )}
      {out?.requiredSections && out.requiredSections.length > 0 && (
        <p className="font-mono">required: {out.requiredSections.join(', ')}</p>
      )}
      {out?.excludedSections && out.excludedSections.length > 0 && (
        <p className="font-mono">excluded: {out.excludedSections.join(', ')}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Implement `prompt-section.tsx`**

Create `components/debug/sections/prompt-section.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { DebugTurn } from '@/lib/debug/reducer'

export function PromptSection({ prompt }: { prompt: DebugTurn['prompt'] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  if (!prompt) return <p className="text-xs text-gray-500">No prompt data yet.</p>

  const sectionEntries = Object.entries(prompt.sections).filter(([, v]) => v != null && v !== '')

  return (
    <div className="space-y-2 text-xs">
      <p className="font-mono">total: {prompt.totalChars} chars</p>
      <ul className="space-y-1">
        {sectionEntries.map(([key, value]) => {
          const size = prompt.sectionSizes[key] ?? (value as string).length
          const included = prompt.includedSections.includes(key)
          const open = expandedKey === key
          return (
            <li key={key} className="border border-black/5 rounded">
              <button
                type="button"
                onClick={() => setExpandedKey(open ? null : key)}
                className="w-full flex justify-between items-center px-2 py-1 font-mono text-left hover:bg-gray-50"
              >
                <span className={included ? '' : 'opacity-50 line-through'}>{key}</span>
                <span className="text-[10px] text-gray-500">{size}</span>
              </button>
              {open && (
                <pre className="px-2 py-1 text-[11px] whitespace-pre-wrap bg-gray-50 max-h-64 overflow-auto">
                  {String(value)}
                </pre>
              )}
            </li>
          )
        })}
      </ul>
      {prompt.stablePrefix && (
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(prompt.stablePrefix ?? '')}
          className="text-[10px] underline"
        >
          Copy stablePrefix
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Implement `tools-section.tsx`**

Create `components/debug/sections/tools-section.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { DebugTurn } from '@/lib/debug/reducer'

export function ToolsSection({ toolCalls }: { toolCalls: DebugTurn['toolCalls'] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  if (toolCalls.length === 0) return <p className="text-xs text-gray-500">No tool calls.</p>

  return (
    <ul className="space-y-1">
      {toolCalls.map((tc) => {
        const open = expandedId === tc.toolCallId
        const status = tc.result?.success === true ? 'ok' : tc.result?.success === false ? 'fail' : 'pending'
        const color = status === 'ok' ? 'bg-emerald-100 text-emerald-700' : status === 'fail' ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-600'
        return (
          <li key={tc.toolCallId} className="border border-black/5 rounded text-xs">
            <button
              type="button"
              onClick={() => setExpandedId(open ? null : tc.toolCallId)}
              className="w-full flex items-center justify-between gap-2 px-2 py-1 font-mono text-left hover:bg-gray-50"
            >
              <span>{tc.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500">{tc.partition}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${color}`}>{status}</span>
              </span>
            </button>
            {open && (
              <div className="px-2 py-1 space-y-2 bg-gray-50">
                <div>
                  <p className="font-mono text-[10px] text-gray-500">args</p>
                  <pre className="text-[11px] whitespace-pre-wrap">{JSON.stringify(tc.args, null, 2)}</pre>
                </div>
                {tc.result && (
                  <div>
                    <p className="font-mono text-[10px] text-gray-500">result ({tc.result.durationMs}ms)</p>
                    <pre className="text-[11px] whitespace-pre-wrap">{JSON.stringify(tc.result.data ?? tc.result.error, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 4: Implement `turn-card.tsx`**

Create `components/debug/turn-card.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { DebugTurn } from '@/lib/debug/reducer'
import { GateSection } from './sections/gate-section'
import { PromptSection } from './sections/prompt-section'
import { ToolsSection } from './sections/tools-section'

interface TurnCardProps {
  turn: DebugTurn
  defaultOpen: boolean
}

export function TurnCard({ turn, defaultOpen }: TurnCardProps) {
  const [openGate, setOpenGate] = useState(defaultOpen)
  const [openPrompt, setOpenPrompt] = useState(defaultOpen)
  const [openTools, setOpenTools] = useState(defaultOpen)

  const latency = turn.totals?.latencyMs
  const preview = turn.userMessage.length > 60 ? turn.userMessage.slice(0, 57) + '...' : turn.userMessage

  return (
    <div className="border border-black/10 rounded-md bg-white">
      <div className="px-3 py-2 border-b border-black/5">
        <p className="text-xs font-mono">
          <span className="text-gray-500">#{turn.messageIndex}</span>{' '}
          {preview}
        </p>
        {latency != null && (
          <p className="text-[10px] text-gray-500 font-mono mt-1">
            {latency}ms · in {turn.totals?.totalInputTokens ?? 0}t · out {turn.totals?.totalOutputTokens ?? 0}t
          </p>
        )}
      </div>
      <Subsection title="Gate" open={openGate} onToggle={() => setOpenGate(!openGate)}>
        <GateSection gate={turn.gate} />
      </Subsection>
      <Subsection title="Prompt" open={openPrompt} onToggle={() => setOpenPrompt(!openPrompt)}>
        <PromptSection prompt={turn.prompt} />
      </Subsection>
      <Subsection title="Tools" open={openTools} onToggle={() => setOpenTools(!openTools)}>
        <ToolsSection toolCalls={turn.toolCalls} />
      </Subsection>
    </div>
  )
}

function Subsection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-black/5 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-1.5 text-left text-xs font-mono font-semibold hover:bg-gray-50 flex justify-between items-center"
      >
        <span>{title}</span>
        <span className="text-gray-400">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  )
}
```

- [ ] **Step 5: Implement `debug-drawer.tsx`**

Create `components/debug/debug-drawer.tsx`:

```tsx
'use client'

import { useEffect } from 'react'
import { useDebug } from './debug-provider'
import { TurnCard } from './turn-card'

interface DebugDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DebugDrawer({ open, onOpenChange }: DebugDrawerProps) {
  // Build-time dead-code elimination guard
  if (process.env.NODE_ENV !== 'development') return null

  const { enabled, setEnabled, turns, clearLog } = useDebug()

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <aside
      data-testid="debug-drawer"
      className="fixed top-0 right-0 z-40 h-dvh w-[480px] max-w-[90vw] bg-white border-l border-black/10 shadow-xl flex flex-col"
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-black/10">
        <span className="text-xs font-mono font-semibold">Zeno Debug</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] font-mono cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>enabled</span>
          </label>
          <button
            type="button"
            onClick={clearLog}
            className="text-[11px] font-mono underline hover:no-underline"
          >
            clear
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close debug drawer"
            className="text-lg leading-none px-1"
          >
            ×
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-2 space-y-2 bg-gray-50">
        {!enabled && (
          <p className="text-xs text-gray-500 p-2">
            Debug is off. Toggle it on, then send a message to capture a turn.
          </p>
        )}
        {enabled && turns.length === 0 && (
          <p className="text-xs text-gray-500 p-2">Waiting for a turn...</p>
        )}
        {turns.map((turn, i) => (
          <TurnCard key={turn.traceId} turn={turn} defaultOpen={i === 0} />
        ))}
      </div>
    </aside>
  )
}
```

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add components/debug/debug-drawer.tsx components/debug/turn-card.tsx components/debug/sections/
git commit -m "feat(debug): DebugDrawer + TurnCard + Gate/Prompt/Tools sub-sections"
```

---

## Task 12: Mount on chat pages + manual end-to-end verification

Wire `<DebugProvider>` + `<DebugToggle>` + `<DebugDrawer>` into the chat layout, hook them up to `useChat`, and verify the full pipeline works in dev and is absent in prod.

**Files:**
- Modify: `app/chat/[id]/page.tsx`
- Modify: `components/chat/chat-page.tsx`

- [ ] **Step 1: Wrap `ChatPage` in `DebugProvider` in the server component**

In `app/chat/[id]/page.tsx`, add the import and wrap (dev-only). At the top:

```ts
import { DebugProvider } from '@/components/debug/debug-provider'
```

Then change the `return (...)` block:

```tsx
const isDev = process.env.NODE_ENV === 'development'
const content = (
  <ChatPage
    conversationId={conversation.id}
    customerId={customerId ?? conversation.customerId}
    initialMessages={initialMessages}
    language={(conversation.language as 'ro' | 'en') ?? 'ro'}
  />
)

return isDev ? <DebugProvider>{content}</DebugProvider> : content
```

Since this is a server component, `process.env.NODE_ENV` is evaluated at build time and Next.js eliminates the prod branch entirely.

- [ ] **Step 2: Wire `useDebug` into `useChat` and mount toggle + drawer in `chat-page.tsx`**

In `components/chat/chat-page.tsx`, modify the imports:

```tsx
import { useState } from 'react'
import { useDebug } from '@/components/debug/debug-provider'
import { DebugToggle } from '@/components/debug/debug-toggle'
import { DebugDrawer } from '@/components/debug/debug-drawer'
```

Replace the `useChat(...)` call (around line 24) with:

```tsx
const debug = useDebug()
const [drawerOpen, setDrawerOpen] = useState(false)
const {
  messages,
  isStreaming,
  toolStatus,
  error,
  sendMessage,
  sendAction,
  suggestions,
  uiActions,
  answeredMessageIds,
  markAnswered,
} = useChat(conversationId, customerId, {
  initialMessages,
  onDebugEvent: debug.onDebugEvent,
  extraHeaders: debug.extraHeaders,
})
```

Then at the very end of the `return (...)`, after the existing chat layout closes, add the toggle + drawer as siblings (they're `position: fixed` so they don't affect layout):

```tsx
<DebugToggle open={drawerOpen} onOpenChange={setDrawerOpen} />
<DebugDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
```

Both components return `null` in prod, so this is safe to render unconditionally.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: all tests pass — including the new ones from Tasks 1, 2, and 7.

- [ ] **Step 5: Manual verification — happy path in dev**

The dev server should be running on `http://localhost:3000`. Open `/chat` in a browser.

1. Confirm a small `debug` pill is visible bottom-right with a gray dot (off).
2. Click the pill → drawer opens on the right with "Debug is off."
3. Click the `enabled` checkbox in the drawer header → dot turns green.
4. Type a message in the chat (e.g. "ce produse aveti?") → after the response streams in, a turn card appears at the top of the drawer.
5. Verify the **Gate** section shows complexity/situationType OR `Skipped: fast_path`.
6. Verify the **Prompt** section shows a list of section names with sizes; click one to expand the raw text.
7. Verify the **Tools** section shows any tool calls with ok/fail badges.
8. Send a second message → a second card appears at the top, older card stays below.
9. Click `clear` → log empties.
10. Press Esc → drawer closes.

- [ ] **Step 6: Manual verification — opt-out in dev**

In the drawer header, uncheck `enabled`. Open the browser devtools Network panel. Send another message. Inspect the `/api/chat` request:

- The request headers should **not** contain `x-zeno-debug`.
- The SSE response stream should contain **no** `event: debug:*` lines.

Re-enable and confirm both reappear.

- [ ] **Step 7: Manual verification — prod build is clean**

Stop the dev server. Run:

```bash
npm run build && npm start
```

Open `http://localhost:3000/chat` in an incognito window. Confirm:

1. No `debug` toggle button anywhere on the page.
2. View source / inspect the rendered HTML → no "DebugDrawer", "DebugToggle", or "debug:" strings present.
3. Send a message → response streams normally.
4. In devtools Network panel → no `x-zeno-debug` header sent, no `debug:*` events in the SSE response.
5. Search the loaded JS chunks for `"debug:turn_start"` → not found.

If any of these fail, the dead-code elimination is not working and we have a real prod safety problem — stop and investigate before merging.

- [ ] **Step 8: Commit**

```bash
git add app/chat/[id]/page.tsx components/chat/chat-page.tsx
git commit -m "feat(debug): mount DebugProvider/Toggle/Drawer on chat page (dev only)"
```

- [ ] **Step 9: Restart dev server (if it was stopped for the prod test)**

```bash
npm run dev
```

---

## Self-Review Summary

Spec coverage check against `2026-05-17-dev-debug-console-design.md`:

- **§Architecture & Safety / Layer 1 (server guard)** → Task 1 (`debugYield`) + every emit task wraps via the helper.
- **§Architecture & Safety / Layer 2 (client guard)** → Tasks 10 and 11 (`if (process.env.NODE_ENV !== 'development') return null`); Task 12 step 7 verifies it.
- **§Architecture & Safety / Layer 3 (user toggle + header)** → Task 9 (`DebugProvider` localStorage + `extraHeaders`) and Task 2 (route header read).
- **§Server SSE event additions / all 6 events** → Tasks 3 (`turn_start` + `turn_end`), 4 (`gate`), 5 (`prompt`), 6 (`tool_call` + `tool_result`).
- **§Server / Input plumbing** → Task 2.
- **§Server / PII note** → not implemented as code (documented in spec only); no separate task required.
- **§Client / File layout** → Tasks 7, 9, 10, 11.
- **§Client / DebugProvider** → Task 9.
- **§Client / DebugDrawer, TurnCard, sub-sections** → Task 11.
- **§Client / Intrusion into existing code** → Task 8 (`useChat` options) + Task 12 (mount).
- **§Testing strategy / Server prod-safety** → covered as a unit test in Task 1 (deterministic) and as live verification in Task 12 step 7. The unit test is stronger than the spec's integration approach because it tests the chokepoint without mocking 8 modules.
- **§Testing strategy / Server dev emission** → Task 1 unit test for the helper + Task 3-6 manual `curl` verifications.
- **§Testing strategy / Client opt-out** → Task 12 step 6.
- **§Testing strategy / Gate event branches** → Task 4 (steps 4 and 5 cover fast-path and full; synthetic verifiable via UI actions).
- **§Testing strategy / Hook event collection** → Task 7 (`reduceDebugEvent` covers the underlying logic).
- **§Testing strategy / Drawer dev-only mount** → Task 12 step 7.

Test strategy deviation from spec: the spec proposed component DOM tests (RTL), but the codebase has no DOM testing setup (`jsdom`, `@testing-library/react`). Rather than introduce them for two tests, this plan tests the pure reducer (`reduceDebugEvent`) where the logic actually lives, and validates rendering via the per-task manual verification + Task 12 prod-bundle audit. Per CLAUDE.md: "If tests can't run locally, do a manual runtime verification."

No placeholders, no "similar to Task N", no undefined references — every step has its own code.
