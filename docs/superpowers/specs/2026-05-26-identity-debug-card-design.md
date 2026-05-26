# Identity & Stored-Context Debug Card — Design

**Status:** Draft
**Date:** 2026-05-26
**Author:** Vasile Tamas + Claude

## Goal

Add a developer-only debug card, rendered inside each `TurnCard` above the existing `GateSection`, that shows exactly what customer-tied data Zeno loaded for that turn: the cookie-resolved identity, the `Customer` row scalars (including the JSON `extractedProfile`), the compliance acks (`gdprConsentAt` / `aiDisclosureAcknowledgedAt`), and the cross-conversation `CustomerInsight` memory. Changes between consecutive turns are visually highlighted so the developer can see at a glance which fields the conversation just affected.

## Non-Goals (v1)

- Conversation-level state (workflow step, application status, quote) — handled by a separate card if needed later.
- Editing values from the panel (read-only).
- Cross-turn timeline / history view inside the card. The existing turn timeline already lets the developer scroll back through snapshots.
- Server-side diff computation. Diff is a presentation concern and lives in the client.
- Surfacing the raw cookie value itself (only the resolved `customerId` UUID is shown — that UUID *is* the cookie value, but it's labelled as `cookieId` for clarity).
- Production gating beyond what `dev-debug-console-design.md` already provides. This card inherits the same three layers; nothing new is added.

## Architecture

### Server: new SSE event `debug:identity`

A single new event, emitted once per turn from `lib/chat/orchestrator.ts` after `loadTurnContext()` and `loadCustomerMemory()` have both run.

```ts
type DebugIdentityEvent = {
  type: 'debug:identity'
  traceId: string
  conversationId: string
  messageIndex: number
  identity: {
    cookieId: string          // the customerId UUID, equal to the zeno_session cookie value
    isAnonymous: boolean
  }
  customer: {
    name: string | null
    age: number | null        // computed from dateOfBirth at snapshot time; null if DOB unset
    language: string
    extractedProfile: Record<string, unknown> | null
  }
  consent: {
    gdprConsentAt: string | null            // ISO-8601 or null
    gdprConsentScope: string | null
    aiDisclosureAcknowledgedAt: string | null
  }
  memory: Array<{
    id: string
    kind: string
    text: string
    createdAt: string         // ISO-8601
  }>
}
```

The event is gated through the existing `debugYield(state.debugEnabled, ...)` helper. In production builds the constant `isDev` is `false` and the event is never serialized.

### Insertion point in `lib/chat/orchestrator.ts`

A single `debugYield` call after the existing `loadTurnContext` call completes, gated on `isDev() && debugEnabled`. To populate the structured `memory` field without issuing a second DB query, the orchestrator pre-fetches the raw `CustomerInsight` rows once (in dev+debug only) and threads them through `loadAllSections` → `loadCustomerMemory` via an optional `preloadedInsights` parameter, so the existing memory formatting reuses the same rows. Net DB query count is identical to prod.

### `lib/chat/debug.ts`

Add `emitIdentity(args): DebugIdentityEvent` alongside the existing emitters, matching the naming and shape conventions of `emitTurnStart`, `emitGate`, etc. The function is pure: it accepts the already-loaded `Customer` row, the computed `age`, and the memory array, and returns the event payload.

### Client: new component `components/debug/identity-section.tsx`

- Rendered inside `TurnCard` immediately above `GateSection`.
- Collapsed by default. Expansion state is per-turn and held in local component state (matches the existing `GateSection` / `PromptSection` pattern).
- Reads `turn.identity` from the turn object stored by `DebugProvider`.
- Reads the *previous* turn's `identity` (via `turn.previous` or by index lookup in the provider's turn array) to compute the diff at render time.

### `components/debug/debug-provider.tsx`

Extend the reducer to handle `debug:identity` by attaching the payload to the matching turn under `turn.identity`. No other state changes.

## Visual treatment

```
▼ Identity & Stored Context              [3 changes this turn]
  Identity
    cookieId    7f2a…e91c    (truncated, click to copy)
    anonymous   🔵 yes
  Profile
    name        —
    age         34   (was: —)        ← changed
    language    ro
    extractedProfile:
      occupation     "engineer"
      familySize     3   (was: —)   ← changed
      hasChildren    true
  Consent
    GDPR              ✗ not granted
    AI disclosure     ✓ 2026-05-26 10:14
  Memory (2 insights)  [click to expand]
```

- **Header chip** `[N changes this turn]` shows the count of changed leaf paths. Hidden when `N == 0`.
- **Changed scalar field** — yellow background on the value cell, plus inline `(was: <previous value>)` annotation. `—` is used for `null` both in the current value and in the "was:" annotation.
- **`extractedProfile`** is rendered as a small key→value tree (one level deep is sufficient for the current schema; nested keys, if they appear, fall through to JSON-stringified rendering). Diff is computed per leaf path, not per object.
- **Consent** — boolean-ish status: present → `✓` + formatted timestamp, absent → `✗ not granted`. Changed transitions get the standard yellow + `(was: …)`.
- **Memory** — single click-to-expand toggle showing `(N insights)`. Each insight, when expanded, shows `kind — first 80 chars`, then expandable to full text + `createdAt`. New insights (matched by `id` against the previous turn) get a subtle green left-border.
- **Zero state** — when `memory.length === 0`, show `— no cross-conversation insights yet —` instead of the expander.

## Diff algorithm

Implemented as a pure function inside `identity-section.tsx`:

```
diff(current: DebugIdentityEvent, previous: DebugIdentityEvent | null): {
  changes: number
  scalarDiffs: Map<string, { now: unknown; was: unknown }>   // dotted paths
  newMemoryIds: Set<string>
}
```

- If `previous === null` (first turn in the session): no diffs shown, `changes` is `0`, but every value still renders normally.
- Scalars compared with `===`. `null` and `undefined` collapse to "not set" and are equal to each other for diff purposes.
- `extractedProfile` is diffed key-by-key (shallow). Keys present in only one side count as changes.
- Memory: ids present in `current` and not in `previous` go into `newMemoryIds`. Removed insights do not generate a diff entry in v1 (insights are append-only by convention in the current schema).

## Testing

Per the project's TDD rule, each runtime behaviour gets a failing test before implementation. The project currently has no React component-test setup (vitest is configured for `.test.ts` files in a node environment, no jsdom, no `@testing-library/react`). Rather than scaffold that for one component, the only non-trivial logic — the diff algorithm — is extracted into a pure helper and tested in isolation. The component itself is presentational and is covered by manual verification.

### Unit — `__tests__/lib/chat/debug-identity.test.ts`

1. Given a synthetic `Customer` (with `dateOfBirth`, `extractedProfile`, both consent fields populated) and two raw `CustomerInsight` rows, the `buildIdentityPayload()` helper returns a payload with the expected shape, ISO-8601 date strings, and computed `age`.
2. Given a `Customer` with `dateOfBirth: null`, `age` is `null` (not `0`, not throwing).
3. Given `insights: []`, the payload's `memory` is `[]` (not `undefined`).

### Unit — `__tests__/components/debug/identity-diff.test.ts`

1. `diffIdentity(current, null)` (first turn): `changes === 0`, `scalarDiffs` empty, `newMemoryIds` empty.
2. `diffIdentity(current, previous)` where `extractedProfile.familySize` changed from `null` to `3`: `scalarDiffs` contains exactly the path `customer.extractedProfile.familySize` with `{ now: 3, was: null }`, `changes === 1`.
3. `diffIdentity(current, previous)` where a new insight id appears in `current`: `newMemoryIds` contains exactly that id, `changes` includes it in the count.
4. `diffIdentity(current, previous)` where consent flipped from `null` to a timestamp: `scalarDiffs` contains `consent.gdprConsentAt`, `changes === 1`.

### Manual verification (per CLAUDE.md "every runtime behaviour change needs a verification step")

1. `npm run dev`, open a fresh browser profile, open `/chat`.
2. Toggle the debug drawer on. Confirm the new "Identity & Stored Context" card appears at the top of the first turn card, collapsed.
3. Expand it. Confirm `cookieId` matches the `zeno_session` cookie value in DevTools, `anonymous` is `🔵 yes`, `name` is `—`, `consent.GDPR` is `✗ not granted`.
4. Send a message that triggers the `record_gdpr_consent` tool. After the next turn lands, confirm the new turn's card shows `GDPR ✓ <timestamp>` highlighted yellow with `(was: ✗ not granted)`, and the header chip reads `[1 change this turn]`.
5. Send a message that causes Zeno to extract a profile field (e.g. occupation). Confirm the next turn's `extractedProfile.occupation` row is highlighted and annotated.
6. Verify in a production build (`npm run build && npm start`) that the debug drawer never renders and the `debug:identity` event never appears in the network tab — i.e. the existing prod-gating still works after the change.

## Files touched

- `lib/chat/debug.ts` — add `emitIdentity` and the `DebugIdentityEvent` type to the discriminated union.
- `lib/chat/orchestrator.ts` — one new `debugYield(emitIdentity(...))` call site after `loadTurnContext` / `loadCustomerMemory`.
- `components/debug/debug-provider.tsx` — reducer case for `debug:identity`, attaches payload to the matching turn.
- `components/debug/turn-card.tsx` — render `<IdentitySection turn={turn} previous={previousTurn} />` above `<GateSection />`.
- `components/debug/identity-section.tsx` — **new file**, the card itself + pure `diff` helper.
- `__tests__/lib/chat/debug.identity.test.ts` — **new file**, unit tests for the emitter.
- `__tests__/components/debug/identity-section.test.tsx` — **new file**, unit tests for the card.

## Out-of-scope follow-ups (not part of this spec)

- A second card for conversation-level state (workflow, application, product, quote).
- Diff highlighting that survives the turn boundary visually (e.g. a "what changed across the whole session" summary at the top of the drawer).
- Server-emitted change counters (would let the drawer badge show pending diffs without expanding every turn).
- Copy-to-clipboard for the full snapshot as JSON.
