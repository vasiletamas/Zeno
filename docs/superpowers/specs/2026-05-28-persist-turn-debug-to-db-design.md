# Persist Per-Turn Debug Data to the Database — Design

**Status:** Draft
**Date:** 2026-05-28
**Author:** Vasile Tamas + Claude

## Goal

Persist the full rich per-turn debug record (the same `DebugTurn` the dev panel renders) to the database for **every** turn, keyed **per conversation**, so that:

1. **Forensic querying** — past conversations are queryable in the DB after the live session ends (which tools ran with what args/results, the assembled prompt, the reasoning-gate decision, identity snapshot, token/cost totals).
2. **UI replay** — the debug drawer can reload a conversation's prior turns from the DB instead of losing them on page refresh or past the in-memory 50-turn cap.

## Background — current state (verified 2026-05-28)

- The orchestrator emits a typed per-turn event stream: `debug:turn_start` → `debug:identity` → `debug:gate` → `debug:prompt` → `debug:tool_call` / `debug:tool_result` (repeated) → `debug:turn_end` (`lib/chat/debug.ts:136`).
- The browser reduces this stream into one `DebugTurn` object per turn via `reduceDebugEvent` (`lib/debug/reducer.ts:63`). State is held in `DebugProvider`'s `useReducer`, capped at 50 turns, and **lost on page reload**.
- Each event also currently passes through `writeDebugEvent`, which appends it to a **dev-only disk JSONL** file at `.debug-traces/<date>/<conversationId>/<traceId>.jsonl` (`lib/chat/debug-persistence.ts`). This is gated (it runs inside `debugYield`, which requires `isDev() && debugEnabled`).
- The DB persists only a lightweight `TurnTrace` per turn (phase timings, tokens, cost, latency, anomalies) — **no** tool args/results, prompt, gate I/O, or identity (`prisma/schema.prisma:638`, written at `orchestrator.ts:1591`).
- `Message.toolCalls` / `Message.toolResults` columns exist but are never written (dead columns).
- The debug payloads are built **only** under `isDev() && debugEnabled`. In particular, the identity payload and its feeding `loadCustomerInsights` query run only in that branch (`orchestrator.ts:301`). Everything else the payloads need (customer, conversation, assembled prompt via `buildResult`, gate I/O, per-tool call/result data) is already computed unconditionally during the turn.

## Non-Goals (v1)

- Retention / pruning of old `TurnDebug` rows. Storage will grow (full prompt text stored per turn). Noted as a likely follow-up; not built now.
- Removing or changing the dev-only disk JSONL path — left untouched. The DB now supersedes it for this goal, but it is harmless.
- Editing or redacting persisted debug data from the panel (read-only replay).
- Changing the live SSE stream or production response bytes in any way.
- A general "conversations" REST surface — only the single debug read endpoint is added.

## Decisions (locked)

- **When to persist:** always, every turn (including production, with no `x-zeno-debug` header). Accepted tradeoff: storage growth and full prompt text + tool args/results stored in the DB for every turn (potential PII surface).
- **Storage model:** a dedicated `TurnDebug` table (not reusing `Message`/`TurnTrace` columns), for clean per-conversation reads, independent retention, and a stored shape that matches the UI.
- **Identity fidelity:** run `loadCustomerInsights` every turn so the persisted identity payload's `memory` list is fully populated. This is the one accepted extra DB query per turn in production (a single indexed lookup).
- **Scope:** both forensic write path AND UI rehydration, keyed per conversation.

## Architecture

### 1. Data model — new `TurnDebug` table

```prisma
model TurnDebug {
  id             String   @id @default(cuid())
  conversationId String
  messageIndex   Int
  traceId        String   @unique          // one row per turn; idempotent upsert key
  payload        Json                      // the full DebugTurn shape
  createdAt      DateTime @default(now())

  conversation   Conversation @relation(fields: [conversationId], references: [id])

  @@index([conversationId, messageIndex])
}
```

Add the back-relation `turnDebugs TurnDebug[]` to the `Conversation` model.

`payload` stores exactly the `DebugTurn` shape (`lib/debug/reducer.ts:29`) that the panel already renders — `identity`, `gate`, `prompt`, `toolCalls[]` (each with its `result`), and `totals`. Storing the rendered shape means rehydration is a straight load with no server-side transform.

### 2. Write path — always-on recorder, decoupled from the SSE gate

The core change: separate *recording the debug record* (always) from *yielding it to SSE* (gated).

- Add a `debugEvents: DebugEvent[]` accumulator to the orchestrator turn `state`.
- Introduce `recordDebugEvent(state, event)` (a small helper) called **unconditionally** at each of the ~9 debug emission sites in `orchestrator.ts`. It pushes the event into `state.debugEvents`.
- `debugYield(isDev, enabled, event)` keeps gating only the SSE yield and the dev-only disk JSONL write. The live stream and production response bytes are therefore unchanged. At each site the event object is built once, passed to both `recordDebugEvent` (always) and `debugYield` (gated).
- Move the identity-payload build (and its `loadCustomerInsights` call) out from under the `isDev() && debugEnabled` guard at `orchestrator.ts:301` so the identity event is recorded every turn. The existing dev-only `debugYield` of `debug:identity` still happens; the difference is the build now always runs and is always recorded. Failures in this path remain logged-and-swallowed (must never break the turn). `preloadedInsights` continues to thread into `loadAllSections` to avoid a *second* insights query.
- At turn-end (Step 10, beside the existing `turnTrace.create` at `orchestrator.ts:1591`): reduce `state.debugEvents` with the existing, already-tested `reduceDebugEvent` into a single `DebugTurn`, then **fire-and-forget** `prisma.turnDebug.upsert({ where: { traceId }, ... })`. Errors are logged via `logError` and swallowed — identical failure posture to `TurnTrace`.

Reusing `reduceDebugEvent` server-side keeps the persisted shape and the live UI shape identical and DRY (single source of reduction logic).

### 3. Read path — `GET /api/conversations/[id]/debug`

New route at `app/api/conversations/[id]/debug/route.ts`.

- Loads `TurnDebug` rows `where conversationId = params.id`, ordered `createdAt desc` (newest-first, matching the panel's ordering), capped (e.g. 50 to match `MAX_TURNS`).
- Returns `{ turns: DebugTurn[] }` — the `payload` column values directly.
- Strictly scoped to the path `conversationId`. An unknown id returns `{ turns: [] }`, never another conversation's data.

### 4. UI rehydration

- Add a `HYDRATE` action to the debug reducer/provider that replaces `state.turns` with a provided `DebugTurn[]` (capped at `MAX_TURNS`). Live `debug:*` events continue to reduce normally afterward and prepend on top.
- Expose `hydrate(turns: DebugTurn[])` from `DebugProvider` (`components/debug/debug-provider.tsx`).
- In `ChatPage` (`components/chat/chat-page.tsx`, which already holds `conversationId` and `useDebug()`), add an effect: on mount with a known `conversationId` and when `debug.enabled`, fetch `GET /api/conversations/[id]/debug` and call `debug.hydrate(turns)`. Opening or refreshing a conversation restores its turns.

## Data Flow

```
turn runs ─► recordDebugEvent(state, e)  [ALWAYS]  ─► state.debugEvents[]
          └► debugYield(isDev,enabled,e) [GATED]   ─► SSE stream ─► browser reduceDebugEvent ─► live panel
                                                    └► disk JSONL (dev only)

turn-end ─► reduceDebugEvent(state.debugEvents) ─► DebugTurn ─► prisma.turnDebug.upsert (fire-and-forget)

page load ─► GET /api/conversations/[id]/debug ─► DebugTurn[] ─► debug.hydrate ─► panel (HYDRATE)
```

## Error Handling

- `turnDebug.upsert` is fire-and-forget; failures are logged (`logError`, category `turn_debug`) and swallowed. A debug-persistence failure must never break or delay the user-facing turn — same contract as `TurnTrace`.
- The always-on identity build / `loadCustomerInsights` retains its existing try/catch that logs and continues with `preloadedInsights = undefined` on failure.
- The read endpoint returns `{ turns: [] }` for unknown ids and on query error (after logging), never leaking other conversations' data.

## Testing (TDD — write the failing test first for each)

1. **Reducer `HYDRATE`** (`__tests__/lib/debug/reducer.test.ts`): `HYDRATE` seeds `state.turns` from a provided array (capped at `MAX_TURNS`); a subsequent live `debug:turn_start` prepends correctly without dropping hydrated turns.
2. **Write path is always-on** (orchestrator-level test): a turn run with `debugEnabled: false` still results in exactly one `turnDebug.upsert` whose `payload` deep-equals the `DebugTurn` produced by reducing that turn's events. Asserts tool `args` and `result` are present in the payload (the forensic gap this closes).
3. **Idempotency:** two writes with the same `traceId` upsert to a single row (no duplicates).
4. **Read API scoping** (`__tests__/app/api/.../conversation-debug-route.test.ts`): seeding `TurnDebug` rows for conversations A and B, `GET /api/conversations/A/debug` returns only A's turns, newest-first; an unknown id returns `{ turns: [] }`.

`npm test` (Vitest) must pass before any push. The new tables require a Prisma migration; tests that touch the DB run against the test database per existing project setup.

## Files Touched

- `prisma/schema.prisma` — add `TurnDebug` model + `Conversation.turnDebugs` back-relation; new migration.
- `lib/chat/debug.ts` — `recordDebugEvent` helper; keep `debugYield` for the gated SSE/disk path.
- `lib/chat/orchestrator.ts` — accumulate `state.debugEvents`; always-build identity; turn-end `turnDebug.upsert` via `reduceDebugEvent`.
- `lib/debug/reducer.ts` — `HYDRATE` action.
- `components/debug/debug-provider.tsx` — `hydrate` + `HYDRATE` dispatch.
- `components/chat/chat-page.tsx` — rehydration fetch effect.
- `app/api/conversations/[id]/debug/route.ts` — new read endpoint.
- Tests as enumerated above.

## Open Follow-ups (not in this slice)

- `TurnDebug` retention / pruning job (storage growth, PII lifecycle).
- Optionally drop the now-redundant dev-only disk JSONL path once DB persistence is trusted.
