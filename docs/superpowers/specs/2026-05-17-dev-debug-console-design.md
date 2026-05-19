# Dev-Mode Debug Console — Design

**Status:** Draft
**Date:** 2026-05-17
**Author:** Vasile Tamas + Claude

## Goal

Build a developer-only observability panel on the chat surface that surfaces what's happening behind the scenes for each turn: the reasoning gate's decision, the full system prompt that was assembled, and every tool call with its arguments and results. The panel must be impossible to reach in a production build.

## Non-Goals (v1)

- Historic browsing of past `TurnTrace` rows
- Phase timeline / LLM I/O panel (per-call provider, model, tokens, cost)
- Surfacing the other `ZenoEvent` types (mode transitions, skill packs, compliance, cache)
- Export / download trace as JSON
- Search, filter, or diff across turns
- Edit-and-replay of prompts or gate decisions
- Admin or staging gating ("on for staff in staging")
- Telemetry on the panel itself

If any of these become valuable later, they are layered on top — they do not invalidate this design.

## Architecture & Safety

Two layers of dev-only gating, both required.

### Layer 1 — Server guard

In `lib/chat/orchestrator.ts`, every debug SSE yield goes through a single helper:

```ts
const isDev = process.env.NODE_ENV === 'development'

function* debugYield(
  enabled: boolean,
  event: SSEEvent,
): Generator<SSEEvent> {
  if (isDev && enabled) yield event
}
```

`enabled` is a per-request flag derived from a client header (see Layer 3). In a production build the constant `isDev` is `false`, so the prompt/gate/tool payloads never serialize into the response. There is no debug HTTP endpoint that can be probed.

### Layer 2 — Client guard

The toggle button and `DebugDrawer` component are wrapped in `process.env.NODE_ENV === 'development'` early returns inside split-component wrappers (`DebugToggleInner` / `DebugDrawerInner` own the hooks; the exported wrappers do the early return without hooks to satisfy `react-hooks/rules-of-hooks`). In production the wrappers always return `null`, so neither the toggle nor the drawer is ever rendered — the floating button is not in the DOM, the drawer JSX never instantiates, and no `x-zeno-debug` header is ever sent by `useChat`.

**Known trade-off**: Because `components/chat/chat-page.tsx` statically imports `useDebug`, `DebugToggle`, and `DebugDrawer`, the underlying modules (`debug-provider.tsx`, `debug-drawer.tsx`, `debug-toggle.tsx`, `turn-card.tsx`, `lib/debug/reducer.ts`, parts of `lib/chat/debug.ts`) remain in the prod client bundle as inert code. A future audit will find string literals such as `"debug:turn_start"`, `"x-zeno-debug"`, and `"zeno_debug"` in `.next/static/chunks/*.js`. These literals correspond to dead-code paths: the reducer's `switch` cases never fire (no provider is mounted), `useDebug()` returns its no-op fallback, and the toggle/drawer wrappers short-circuit before reaching the inner components. Estimated weight: ~3-5KB minified. A future improvement using `next/dynamic` with build-time-gated imports could eliminate this; for v1 the visible-UI guarantee was deemed sufficient.

### Layer 3 — User toggle (dev only)

Even in dev, the panel is off by default and the server skips emission. A `DebugProvider` React context owns:

- `enabled: boolean` — persisted to `localStorage.zeno_debug`, default `false`
- When `enabled === true`, requests to `/api/chat` include header `x-zeno-debug: 1`
- The chat route reads that header and passes `debugEnabled: true` to `handleChatTurn`
- When the header is absent, no debug events are emitted regardless of `NODE_ENV`

**Net effect:** in prod, debug code does not exist in either bundle. In dev, the developer decides per-session whether the panel is on, and turning it off stops both server emission and client rendering.

## Server: SSE event additions

All new events live alongside the existing `content` / `tool_start` / `tool_complete` / `ui_action` / `error` / `done` stream. All are emitted only via `debugYield(state.debugEnabled, ...)`.

| Event | When emitted | Payload |
|---|---|---|
| `debug:turn_start` | Top of `chatTurnGenerator` (after `eventBus.emit({ type: 'turn:start', ... })`) | `{ traceId, conversationId, messageIndex, userMessage, language }` |
| `debug:gate` | End of `gatePromise` | `{ traceId, skipped: boolean, reason?: 'fast_path' \| 'synthetic', input?: ReasoningGateInput, output?: ReasoningGateOutput, durationMs }` |
| `debug:prompt` | After `buildPrompt(...)` resolves | `{ traceId, sections: PromptSections, sectionSizes, includedSections, excludedSections, gateActive, stablePrefix, dynamicSuffix, totalTokens }` |
| `debug:tool_call` | Before each `executeToolWithPipeline(...)` | `{ traceId, round, toolCallId, name, args, partition: 'readOnly' \| 'writing' \| 'background' }` |
| `debug:tool_result` | After each `executeToolWithPipeline(...)` | `{ traceId, toolCallId, success, durationMs, cached, data, error, uiAction?, transition? }` |
| `debug:turn_end` | Just before the final `done` yield | `{ traceId, phases, totalInputTokens, totalOutputTokens, cost, latencyMs, anomalies }` |

### Insertion points in `lib/chat/orchestrator.ts`

- `debug:turn_start` — immediately after the existing `eventBus.emit({ type: 'turn:start', ... })` near line 175
- `debug:gate` — end of `gatePromise` (~line 418), pulling from local `gateOutput` and `gateInput`
- `debug:prompt` — after `buildPrompt(mergedSections, gateSelection)` (~line 598), using `buildResult` and `mergedSections`
- `debug:tool_call` and `debug:tool_result` — wrap each of the four `executeToolWithPipeline(...)` call sites: synthetic (~line 713), read-only batch (~line 956), writing (~line 1011), background (~line 917). The background case emits `debug:tool_call` with `partition: 'background'` and a synthetic `debug:tool_result` with `success: true, message: 'fire-and-forget'` because we don't await it.
- `debug:turn_end` — immediately before the final `yield { event: 'done', ... }` near line 1283

### Input plumbing

`ChatTurnInput` gains `debugEnabled?: boolean`. The chat route handler (`app/api/chat/route.ts`) sets it from `request.headers.get('x-zeno-debug') === '1'`. The handler does no other validation — the env guard in `debugYield` is the actual safety net.

### PII note

Tool `args` and `data` may contain customer PII (names, dates of birth, addresses). This is acceptable for a dev-only feature running against a local DB. We will document this in the toggle's tooltip ("Shows raw customer data — local dev only") but enforce nothing beyond the env guard.

## Client: hook + UI components

### File layout

```
components/debug/
  debug-provider.tsx       # React Context — turn log, toggle, headers
  debug-drawer.tsx         # Right-side slide-out panel
  debug-toggle.tsx         # Floating bottom-right toggle button
  turn-card.tsx            # Collapsible card per turn
  sections/
    gate-section.tsx       # ReasoningGateOutput renderer
    prompt-section.tsx     # Section list + expand-to-full-text
    tools-section.tsx      # Tool call timeline
lib/hooks/
  use-debug-stream.ts      # Consumes debug:* events
```

### Intrusion into existing code

The only change to existing files:

1. `lib/hooks/use-chat.ts` — `useChat` gains optional params:
   - `onDebugEvent?: (event: DebugEvent) => void`
   - `extraHeaders?: Record<string, string>` (merged into the `fetch` headers)

   When `onDebugEvent` is set, any SSE event whose name starts with `debug:` is forwarded to the callback instead of being silently dropped. In prod, neither param is ever passed.

2. `app/chat/[id]/page.tsx` and `app/chat/page.tsx` — wrap `<ChatPage>` in `<DebugProvider>` and render `<DebugToggle />` + `<DebugDrawer />` as siblings of the chat. The entire dev block is gated by `process.env.NODE_ENV === 'development'`.

### DebugProvider

Owns:

- `turns: DebugTurn[]` — running log, newest first, capped at 50 turns to bound memory
- `enabled: boolean` — read from `localStorage.zeno_debug` on mount, default `false`
- `setEnabled(b: boolean)` — writes through to `localStorage`
- `extraHeaders: Record<string, string>` — `{ 'x-zeno-debug': '1' }` when enabled, otherwise `{}`
- `onDebugEvent: (event: DebugEvent) => void` — appends/updates the current turn entry

A `DebugTurn` is built incrementally as events arrive, keyed by `traceId`:

```ts
interface DebugTurn {
  traceId: string
  conversationId: string
  messageIndex: number
  userMessage: string
  startedAt: number
  gate?: GatePayload
  prompt?: PromptPayload
  toolCalls: Array<ToolCallPayload & { result?: ToolResultPayload }>
  endedAt?: number
  totals?: TurnEndPayload
}
```

### DebugDrawer

- Base UI `Dialog` in non-modal mode, anchored right, ~480px wide
- Closeable with Esc
- Header: on/off `Switch`, "Clear log" button, current `conversationId` short-form
- Body: scrollable list of `<TurnCard />` newest first

### TurnCard

- Shows turn number, user message preview, total latency
- Three collapsible sub-sections: **Gate** / **Prompt** / **Tools**
- Default state: most recent turn expanded with all three open; older turns fully collapsed

### Sub-sections

- **GateSection** — if `skipped`, renders the reason. Otherwise renders complexity, situationType, confidence, recommendedSkillPacks, mode transition, requiredSections, excludedSections.
- **PromptSection** — list of `includedSections` with sizes (chars / tokens). Click a row to expand the raw text inline. Buttons: "Copy stablePrefix", "Copy dynamicSuffix".
- **ToolsSection** — vertical timeline of tool calls. Each row: name, partition badge, duration, success/failure pill, expand to show `args` and `data` as JSON trees.

## Testing strategy

TDD per the universal rules — failing test first, then implementation.

| Test | File | What it asserts |
|---|---|---|
| Server prod-safety | `lib/chat/orchestrator.debug.test.ts` | With `NODE_ENV=production`, run `chatTurnGenerator` against a fixture turn and assert no event's name starts with `debug:`. |
| Server dev emission | same | With `NODE_ENV=development` + `debugEnabled: true`, assert the expected event sequence and snapshot the payload shapes. |
| Client opt-out | same | With `NODE_ENV=development` but `debugEnabled: false`, assert no `debug:*` events emitted. |
| Gate event payload branches | same | Fast-path → `skipped: true, reason: 'fast_path'`. Synthetic action → `reason: 'synthetic'`. Full gate → `output` populated, `skipped: false`. |
| Hook event collection | `components/debug/debug-provider.test.tsx` | Render `<DebugProvider>` with a stub emitter; fire synthetic `debug:turn_start` + `debug:gate` + `debug:turn_end`; assert `turns[0]` has gate populated and the right traceId. |
| Drawer dev-only mount | same | With `process.env.NODE_ENV = 'production'`, `data-testid="debug-toggle"` is absent. With `'development'`, present. |
| Manual runtime | n/a | Open `/chat`, send a message, confirm drawer populates. Toggle off, send another, confirm no `debug:*` in the Network tab. Run `next build && next start`, confirm toggle is absent from DOM. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| A future contributor adds a `yield { event: 'debug:...' }` outside `debugYield` | The server prod-safety test scans every yielded event in a fixture run; the test fails if any `debug:*` event slips through with `NODE_ENV=production`. |
| `process.env.NODE_ENV` check gets bypassed by an `if/else` someone "simplifies" | The `debugYield` helper is the single chokepoint. Lint rule could enforce this later if it becomes a recurring problem. |
| Tool payloads grow large enough to dominate the SSE stream | The client opt-out header means `enabled === false` produces zero extra bytes. When on, the panel discards old turns past the cap of 50. |
| PII visible during screen-share | Documented in the toggle tooltip; the developer is responsible for turning it off before sharing. |
| Prod bundle contains inert debug strings (~3-5KB) | Accepted for v1: UI is invisible in prod and no debug header is sent. A `next/dynamic` refactor is the documented future improvement if this matters. |

## Rollout

This ships as a single PR. No migration, no feature flag, no staged rollout — the panel only exists in dev builds, so production is unaffected by definition.
