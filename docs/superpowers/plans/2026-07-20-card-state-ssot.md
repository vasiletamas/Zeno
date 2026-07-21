# Card-State SSOT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interactive chat cards become server-derived state (semantic key + status) instead of fire-and-forget SSE events — killing zombie cards, fake-✓, reload loss, and agent card-blindness in one architecture, per the approved spec `docs/superpowers/specs/2026-07-20-card-state-ssot-design.md`.

**Architecture:** A new pure derivation `deriveActiveCards(snapshot, …)` (precedent: `derivePendingCard`) computes the full card set from domain facts. The orchestrator emits it at turn end as a `cards_state` SSE event; the client renders card interactivity/✓ SOLELY from it; the situational briefing prints it for the agent. Deterministic hygiene lands independently first: detection checks, replay presentation strip, ladder gating.

**Tech Stack:** Next.js 15 / React, Prisma (postgres, docker `zeno-db-1` :5435), Vitest (`npx vitest run`, projects: unit + integration), tsx scripts for runtime verification.

## Progress ledger (updated as tasks land)

| Task | Status | Commits | Evidence |
|---|---|---|---|
| T1 stale_card_replayed | ✅ done + spec+quality approved | 7f1056d0 (+39eb710b, 94d1a71c) | fires @turn 12 live; window semantics mutation-pinned |
| T2 card_for_committed_fact | ✅ done + spec+quality approved | f8b325b3 | fires @turn 12 live |
| T3 competing_input_cards | ✅ done + spec+quality approved | 924ac79e | fires @turn 8 live |
| T4 gui-actor fabrication exemption | ✅ done + spec+quality approved | 41a8b1de (+00c2391d, 94d1a71c) | turn-12 false positive gone; floor-revert + targetRef mutants killed |
| T5 replay presentation strip | ✅ done + spec+quality approved | 79825621 (+b115d61e, 6ac38741) | sanitize stored+returned; stale pins aligned, never weakened |
| T6 ladder gate + due-timing + OTP-owns-turn | ✅ done + spec+quality approved | 0c34f72c | 16/16 collect ring green; plan code verbatim |
| T7 deferral facts (defer_customer_field) | ✅ done + spec+quality approved | b944fa1f (+6ac38741 GDPR+FK) | migrations verified; erasure covers deferrals (TDD) |
| T8 deriveActiveCards SSOT | ✅ done + spec+quality approved | 5006ee3b (+9860ee70) | 7/7 derivations; single snapshot per turn; payload parity pinned |
| T9 cards_state SSE | ✅ done + spec+quality approved | 2fb0136d | emitted once, main path, before done; consumer case + harness assert |
| T10 reload parity (full set) | ✅ done | 20af7522 (joint w/ T12) | page.tsx seeds deriveActiveCards → initialCards; tsc clean |
| T11 card-view reducer + wiring | ✅ done | d101ae04 (reducer) + 20af7522 (wiring) | 17 pure unit tests TDD; REAL action types enumerated |
| T12 components render card truth | ✅ done + **browser-verified** | 20af7522 | chat ring 50 files/361 green; identity-cards 4/4; live DOM audit below |

**Browser verification (2026-07-21, coordinator, conv `cmrrhruba0001g40yh3am7peo`, cold reload — the incident conversation itself):** `phoneCardPresent: false` — the zombie phone card that opened this investigation no longer renders. The OTP card is re-derived server-side on a cold load (pre-fix: `show_otp_entry` was lost entirely on reload) and renders its true status: "Codul a expirat", code input + Verifică disabled, **"Retrimite codul" ENABLED** (pre-fix it was dead via positional supersession — the customer's only recovery path was blocked). Zero console errors.

**Environment gotcha (cost 20 minutes, worth recording):** a dev server started BEFORE a migration holds a stale in-memory Prisma client — `deriveActiveCards` threw `Cannot read properties of undefined (reading 'findMany')` on `profileFieldDeferral` at SSR while unit tests and `tsc` were green (vitest spawns fresh processes). The code was correct; restart the dev server after every migration.
| T13–T16 | ⬜ pending | — | — |

**T8-9 notes:** plan's phone-active fixture needed a declared email (ladder order); ErrorLayer has no 'chat' → 'orchestrator'; noted-for-later: deep-freeze FIELD_META_FOR_CARDS next time data-handlers.ts is touched; card-view.ts (T11) becomes the canonical home of the shared card-entry type + the 'question:batch' key constant.

**T10-12 notes:** (a) REAL action types differ from the plan's guesses — `medical_batch` (not submit_medical_batch), question code rides `payload.questionCode` (nullable, string|null); cardKeyForAction also covers legacy `answer_dnt` and the question confirm round-trips `write_question_answer`/`modify_answer`. (b) card-view.ts is the canonical type home per the quality-review directive: `ActiveCard = ActiveCardEntry & { hint: string }`; `questionKeyFor`/`QUESTION_BATCH_KEY` shared by derivation + client mappers. (c) `buildOtpSubmitAction(code, channel?)` threads the channel so the submitting key is truthful (adapter ignores it; legacy {code}-only payloads fall back to otp:email). (d) DEVIATION: live `ui_action` upserts an optimistic ACTIVE entry into cardsState (never a ✓/resolved) — without it a just-emitted card renders "Nu mai este necesar" until the turn-end cards_state lands; the turn-end set still replaces wholesale and remains the only authority. (e) newest-wins (`lastActionableId`) retired ONLY for keyed input cards; presentation cards (key null) keep it, and with markAnswered gone a presentation card stays interactive until a newer uiAction-bearing message lands (gateway idempotency + confirm round-trips absorb re-clicks). (f) page.tsx logError uses layer 'api' (ErrorLayer has no 'chat'), category 'cards_state'. (g) Step 12.4's FULL-suite run and Step 12.5's browser verification deliberately deferred to the T16 coordinator gate (here: tsc clean, chat unit ring 50/361 green, identity-cards 4/4, derive-active-cards integration 7/7).

**T5-7 deviation log:** integration suites must run ONE at a time (shared postgres wedges concurrent runs); `.env` EMAIL_PROVIDER restored to `mock` (uncommitted — flip back if resend was deliberate); accepted quality observations: getFieldDeferrals db param half-threaded, snapshot cost on email-save path, deferral message says "this conversation" while the fact is customer-scoped.

**Deviation log:** T1/T4 — TurnDebug stamps `startedAt === endedAt` at reduction time (AFTER mid-turn ledger writes), so the ledger-window floor is the PRECEDING turn's `endedAt`, not `t.startedAt`. Systemic: any future check correlating ledger rows to turns must use the same floor. Diagnostics ring: 88/88 green.

**Evidence base (read these before starting):**
- Spec: `docs/superpowers/specs/2026-07-20-card-state-ssot-design.md`
- Incident analysis: `docs/superpowers/specs/2026-07-19-card-state-awareness-design.md`
- Incident report: `docs/debug-reports/2026-07-19-cmrrhruba0001g40yh3am7peo.md`

**Ground rules (from CLAUDE.md + house doctrine):**
- TDD every task: failing test → run (expect FAIL) → implement → run (expect PASS) → commit.
- `lib/diagnostics/index.ts` registers `...Object.values(ui)` WITHOUT an isCheck filter — `lib/diagnostics/checks-ui.ts` must export ONLY `DiagnosticCheck` values; keep helpers module-private.
- The instrumentation test `__tests__/lib/events/instrumentation.test.ts` is a known flake (~1/3): treat as PASS when it is the only full-suite failure.
- Never push; commit per task on local `main`.

**Key recorded facts the tasks rely on (verified 2026-07-20):**
- TurnDebug toolCalls record `{round, toolCallId, name, args, partition, result}` — NO actor, NO disposition. `result` keys: `{success, durationMs, cached, data?, error?, uiAction?, transition?, confirmation?}`.
- Actor + idempotencyDisposition + targetRef live ONLY on CommitLedger rows (`e.ledger` in exports, `CommitLedgerExportRow`). Turn windows: `t.startedAt`/`t.endedAt` are epoch ms; ledger `createdAt` is an ISO string.
- The stored ledger envelope is the full stamped `CommitResult`; on replay rows the envelope is the PRIOR row's Json verbatim and `idempotencyDisposition==='replay'`.
- A card submit turn's persisted user message starts with `⟦action⟧` and the synthetic tool call runs with actor `'gui'` (round 0); agent-loop calls are actor `'agent'`.

---

## File structure (created / modified)

| File | Role |
|---|---|
| `lib/diagnostics/checks-ui.ts` (M) | + `stale_card_replayed`, `card_for_committed_fact`, `competing_input_cards` |
| `lib/diagnostics/checks-fabrication.ts` (M) | gui-actor exemption |
| `lib/tools/gateway.ts` (M) | `sanitizeReplayEnvelope` in `writeReplayRow` |
| `lib/tools/handlers/data-handlers.ts` (M) | ladder gate + timing-aware emission + OTP-owns-turn |
| `prisma/schema.prisma` + migration (M) | `ProfileFieldDeferral` table |
| `lib/customer/profile-service.ts` (M) | deferral read/write helpers |
| `lib/tools/registry.ts`, `lib/tools/validation.ts`, `lib/engines/derive-and-expose.ts`, `lib/tools/handlers/data-handlers.ts` (M) | `defer_customer_field` tool |
| `lib/chat/derive-active-cards.ts` (C) | THE derivation — semantic keys + statuses |
| `lib/chat/orchestrator.ts`, `app/api/chat/route.ts`, `lib/chat/sse-consumer.ts` (M) | `cards_state` turn-end event |
| `app/chat/[id]/page.tsx` (M) | reload parity: full derived set replaces single-card seed |
| `lib/chat/card-view.ts` (C) | PURE client card-view reducer (unit-testable) |
| `lib/hooks/use-chat.ts`, `components/chat/message-list.tsx`, `components/chat/rich/*.tsx` (M) | render from card state |
| `lib/chat/phase-sections-map.ts` (M) | ON-SCREEN CARDS briefing section |
| `prisma/seeds/seed-agents.ts` (M) + reseed | T11 amendment |
| `lib/diagnostics/checks-cards.ts` (M) | briefing-listed cards count as trace |
| `scripts/verify-card-state.ts` (C) | incident-shape runtime verification |

Execution order = task order. Tasks 1–4 (detection) land before any fix, per Ruling 3.

---

### Task 1: `stale_card_replayed` check

A replayed commit must never deliver a card. Detects the turn-12 zombie: a toolCall whose result carries a `uiAction` while a same-tool `idempotencyDisposition==='replay'` ledger row falls inside the turn's time window. After Task 5 lands this is the regression net.

**Files:**
- Modify: `lib/diagnostics/checks-ui.ts`
- Test: `__tests__/lib/diagnostics/checks-ui.test.ts`

- [x] **Step 1.1: Write the failing test** — append to `__tests__/lib/diagnostics/checks-ui.test.ts`:

```ts
describe('stale_card_replayed (2026-07-20 ratchet)', () => {
  // Ratchet origin: conv cmrrhruba0001g40yh3am7peo turn 12 — the gateway
  // replayed turn 10's stored envelope verbatim, re-emitting a phone card
  // computed against dead state. Effects replay; cards must not.
  const replayLedgerRow = (tool: string, createdAt: string) => ({
    id: 'L1', tool, actor: 'agent', outcome: 'applied', effects: [], reasonCode: null,
    phaseFrom: 'DISCOVERY', phaseTo: 'DISCOVERY', idempotencyDisposition: 'replay',
    targetRef: 'field:residency', createdAt,
  })
  const cardResult = { success: true, durationMs: 5, cached: false, uiAction: { type: 'show_data_field', payload: { field: 'phone' } } }

  it('flags a card-bearing toolCall in a turn window containing a same-tool replay ledger row', () => {
    const e = makeExport({
      turns: [turn(12, {
        startedAt: Date.parse('2026-07-19T08:27:50.000Z'), endedAt: Date.parse('2026-07-19T08:27:56.000Z'),
        toolCalls: [{ round: 1, toolCallId: 'x', name: 'collect_customer_field', args: { field: 'residency', value: 'Romania' }, partition: 'writing', result: cardResult }],
      })] as never,
      ledger: [replayLedgerRow('collect_customer_field', '2026-07-19T08:27:53.738Z')] as never,
    })
    const f = runDiagnostics(e).filter((x) => x.checkId === 'stale_card_replayed')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'error', turn: 12, evidence: { tool: 'collect_customer_field', cardType: 'show_data_field' } })
  })

  it('is silent when the replay row is outside the turn window, the tool differs, or no card rides the result', () => {
    const e = makeExport({
      turns: [turn(12, {
        startedAt: Date.parse('2026-07-19T08:27:50.000Z'), endedAt: Date.parse('2026-07-19T08:27:56.000Z'),
        toolCalls: [
          { round: 0, toolCallId: 'a', name: 'collect_customer_field', args: { field: 'phone', value: '07' }, partition: 'writing', result: { success: true, durationMs: 5, cached: false } },
          { round: 1, toolCallId: 'b', name: 'get_product_info', args: {}, partition: 'readOnly', result: cardResult },
        ],
      })] as never,
      ledger: [
        replayLedgerRow('collect_customer_field', '2026-07-19T08:20:00.000Z'), // outside window
        replayLedgerRow('set_candidate_product', '2026-07-19T08:27:53.000Z'),  // different tool than the card-bearing call
      ] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'stale_card_replayed')).toBe(false)
  })

  it('is registered in the catalog', () => {
    expect(CHECK_CATALOG.some((c) => c.id === 'stale_card_replayed')).toBe(true)
  })
})
```

- [x] **Step 1.2: Run to verify failure**

Run: `npx vitest run __tests__/lib/diagnostics/checks-ui.test.ts`
Expected: FAIL — the two positive/registration tests fail (check id unknown).

- [x] **Step 1.3: Implement** — append to `lib/diagnostics/checks-ui.ts` (do NOT export helpers):

```ts
/** Ledger rows inside a turn's [startedAt, endedAt] window (ledger createdAt
 * is ISO, turn bounds are epoch ms). Small windows; O(n·m) is fine. */
const ledgerRowsInTurn = (
  ledger: { tool: string; idempotencyDisposition: string; createdAt: string }[] | undefined,
  t: { startedAt: number; endedAt?: number },
) => (ledger ?? []).filter((r) => {
  const at = Date.parse(r.createdAt)
  return at >= t.startedAt && at <= (t.endedAt ?? Number.MAX_SAFE_INTEGER)
})

/**
 * Ratchet origin: 2026-07-20, conv cmrrhruba0001g40yh3am7peo turn 12 — an
 * idempotent replay returned the stored envelope verbatim, re-emitting a
 * show_data_field(phone) card computed when phone was genuinely missing.
 * A replay confirms a fact; it must never deliver a card.
 */
export const staleCardReplayed: DiagnosticCheck = {
  id: 'stale_card_replayed',
  description: 'A replayed commit\'s result carried a uiAction — a card computed against dead state was re-delivered (2026-07-20, conv cmrrhruba turn 12)',
  run: (e) => e.turns.flatMap((t) => {
    const replays = ledgerRowsInTurn(e.ledger, t as { startedAt: number; endedAt?: number })
      .filter((r) => r.idempotencyDisposition === 'replay')
    if (replays.length === 0) return []
    return t.toolCalls.flatMap((c): Finding[] => {
      const type = (c.result?.uiAction as { type?: unknown } | undefined)?.type
      if (typeof type !== 'string') return []
      if (!replays.some((r) => r.tool === c.name)) return []
      return [{ checkId: 'stale_card_replayed', severity: 'error', turn: t.messageIndex, evidence: { tool: c.name, cardType: type } }]
    })
  }),
}
```

- [x] **Step 1.4: Run to verify pass**

Run: `npx vitest run __tests__/lib/diagnostics/`
Expected: all PASS (including the pre-existing 74).

- [x] **Step 1.5: Prove it fires on the live conversation**

Run: `npx tsx scripts/diagnose-conversation.ts cmrrhruba0001g40yh3am7peo --json`
Expected: exit 1; findings include `{"checkId":"stale_card_replayed","turn":12}`. (Exit 1 = findings exist — correct.)

- [x] **Step 1.6: Commit**

```bash
git add lib/diagnostics/checks-ui.ts __tests__/lib/diagnostics/checks-ui.test.ts
git commit -m "feat(diagnostics): stale_card_replayed — replayed envelopes must not deliver cards (conv cmrrhruba turn 12)"
```

---

### Task 2: `card_for_committed_fact` check

A `show_data_field` card demanding a field that was ALREADY committed at emission time (turn 12 fires: phone card while an applied `field:phone` row predates it).

**Files:** same two as Task 1.

- [x] **Step 2.1: Write the failing test** — append to `__tests__/lib/diagnostics/checks-ui.test.ts`:

```ts
describe('card_for_committed_fact (2026-07-20 ratchet)', () => {
  const appliedRow = (targetRef: string, createdAt: string, disposition = 'fresh') => ({
    id: `L-${targetRef}-${createdAt}`, tool: 'collect_customer_field', actor: 'gui', outcome: 'applied', effects: [],
    reasonCode: null, phaseFrom: 'DISCOVERY', phaseTo: 'DISCOVERY', idempotencyDisposition: disposition,
    targetRef, createdAt,
  })
  const phoneCardCall = (id: string) => ({ round: 1, toolCallId: id, name: 'collect_customer_field',
    args: { field: 'residency', value: 'Romania' }, partition: 'writing',
    result: { success: true, durationMs: 5, cached: false, uiAction: { type: 'show_data_field', payload: { field: 'phone' } } } })

  it('flags a data-field card for a field with an earlier applied commit', () => {
    const e = makeExport({
      turns: [turn(12, { startedAt: Date.parse('2026-07-19T08:27:50.000Z'), endedAt: Date.parse('2026-07-19T08:27:56.000Z'),
        toolCalls: [phoneCardCall('x')] })] as never,
      ledger: [appliedRow('field:phone', '2026-07-19T08:27:51.410Z')] as never,
    })
    const f = runDiagnostics(e).filter((x) => x.checkId === 'card_for_committed_fact')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'error', turn: 12, evidence: { cardField: 'phone' } })
  })

  it('is silent when the field commit happens AFTER the emitting turn (legit ladder progression)', () => {
    const e = makeExport({
      turns: [turn(8, { startedAt: Date.parse('2026-07-19T08:06:00.000Z'), endedAt: Date.parse('2026-07-19T08:06:10.000Z'),
        toolCalls: [phoneCardCall('y')] })] as never,
      ledger: [appliedRow('field:phone', '2026-07-19T08:27:51.410Z')] as never, // committed much later
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'card_for_committed_fact')).toBe(false)
  })

  it('is registered in the catalog', () => {
    expect(CHECK_CATALOG.some((c) => c.id === 'card_for_committed_fact')).toBe(true)
  })
})
```

- [x] **Step 2.2: Run to verify failure** — `npx vitest run __tests__/lib/diagnostics/checks-ui.test.ts` → FAIL on the new describe.

- [x] **Step 2.3: Implement** — append to `lib/diagnostics/checks-ui.ts`:

```ts
/**
 * Ratchet origin: 2026-07-20, conv cmrrhruba turn 12 — a phone card was
 * emitted two seconds AFTER an applied field:phone commit in the same turn.
 * A show_data_field card whose field already has an applied collect commit
 * at (or before) the emitting turn's end is demanding a known fact.
 */
export const cardForCommittedFact: DiagnosticCheck = {
  id: 'card_for_committed_fact',
  description: 'A show_data_field card asked for a field that already had an applied commit at emission time (2026-07-20, conv cmrrhruba turn 12)',
  run: (e) => e.turns.flatMap((t) => t.toolCalls.flatMap((c): Finding[] => {
    const ui = c.result?.uiAction as { type?: unknown; payload?: { field?: unknown } } | undefined
    if (ui?.type !== 'show_data_field' || typeof ui.payload?.field !== 'string') return []
    const field = ui.payload.field
    const turnEnd = (t as { endedAt?: number }).endedAt ?? Number.MAX_SAFE_INTEGER
    const committed = (e.ledger ?? []).some((r) =>
      r.tool === 'collect_customer_field' && r.outcome === 'applied' &&
      r.idempotencyDisposition === 'fresh' && r.targetRef === `field:${field}` &&
      Date.parse(r.createdAt) <= turnEnd)
    if (!committed) return []
    return [{ checkId: 'card_for_committed_fact', severity: 'error', turn: t.messageIndex, evidence: { cardField: field, tool: c.name } }]
  })),
}
```

- [x] **Step 2.4: Run to verify pass** — `npx vitest run __tests__/lib/diagnostics/` → all PASS.
- [x] **Step 2.5: Live proof** — `npx tsx scripts/diagnose-conversation.ts cmrrhruba0001g40yh3am7peo --json` → includes `card_for_committed_fact` at turn 12.
- [x] **Step 2.6: Commit** — `git add` same files; message `feat(diagnostics): card_for_committed_fact — cards must not demand already-committed fields`.

---

### Task 3: `competing_input_cards` check

Two input-collection cards in one turn (turn 8: phone card + OTP card; the client Map silently dropped the first). Severity `warn` — post-fix (Task 6) the auto-chain turn carries only the OTP card.

**Files:** same two as Task 1.

- [x] **Step 3.1: Write the failing test** — append:

```ts
describe('competing_input_cards (2026-07-20 ratchet)', () => {
  const call = (id: string, name: string, type: string) => ({ round: 0, toolCallId: id, name, args: {}, partition: 'writing',
    result: { success: true, durationMs: 5, cached: false, uiAction: { type, payload: {} } } })

  it('flags a turn emitting two input-type cards (conv cmrrhruba turn 8: data_field + otp)', () => {
    const e = makeExport({ turns: [turn(8, { toolCalls: [
      call('a', 'collect_customer_field', 'show_data_field'),
      call('b', 'start_channel_verification', 'show_otp_entry'),
    ] })] as never })
    const f = runDiagnostics(e).filter((x) => x.checkId === 'competing_input_cards')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'warn', turn: 8, evidence: { types: ['show_data_field', 'show_otp_entry'] } })
  })

  it('is silent for one input card, or an input card + a non-input card (quote)', () => {
    const e = makeExport({ turns: [turn(2, { toolCalls: [
      call('a', 'write_dnt_answer', 'show_question'),
      call('b', 'generate_quote', 'show_quote'),
    ] })] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'competing_input_cards')).toBe(false)
  })

  it('is registered in the catalog', () => {
    expect(CHECK_CATALOG.some((c) => c.id === 'competing_input_cards')).toBe(true)
  })
})
```

- [x] **Step 3.2: Verify failure** — same command → FAIL.

- [x] **Step 3.3: Implement** — append to `lib/diagnostics/checks-ui.ts` (private const — do NOT export):

```ts
/** Input-COLLECTION card types: the customer types/taps an answer into them.
 * Review/confirm/quote/payment cards are presentations, not competing inputs. */
const INPUT_CARD_TYPES = new Set(['show_data_field', 'show_otp_entry', 'show_question', 'show_medical_batch'])

/**
 * Ratchet origin: 2026-07-20, conv cmrrhruba turn 8 — phone card + OTP card
 * in one turn; the client's one-card-per-message Map silently dropped the
 * phone card. Two simultaneous input cards is an emission defect regardless
 * of which one survives rendering.
 */
export const competingInputCards: DiagnosticCheck = {
  id: 'competing_input_cards',
  description: 'A single turn emitted more than one input-collection card (2026-07-20, conv cmrrhruba turn 8)',
  run: (e) => e.turns.flatMap((t): Finding[] => {
    const types = t.toolCalls
      .map((c) => (c.result?.uiAction as { type?: unknown } | undefined)?.type)
      .filter((x): x is string => typeof x === 'string' && INPUT_CARD_TYPES.has(x))
    if (types.length <= 1) return []
    return [{ checkId: 'competing_input_cards', severity: 'warn', turn: t.messageIndex, evidence: { types } }]
  }),
}
```

- [x] **Step 3.4: Verify pass** — diagnostics ring green.
- [x] **Step 3.5: Live proof** — diagnose the conversation → `competing_input_cards` at turn 8.
- [x] **Step 3.6: Commit** — `feat(diagnostics): competing_input_cards — one input card per turn`.

---

### Task 4: gui-actor exemption in `questionnaire_answer_fabricated`

A value submitted via a card (`⟦action⟧` turn, actor `'gui'` ledger row) is grounded by the card, not the prose — the masked-phone warn at turn 12 is a false positive.

**Files:**
- Modify: `lib/diagnostics/checks-fabrication.ts`
- Test: `__tests__/lib/diagnostics/checks-fabrication.test.ts`

- [x] **Step 4.1: Write the failing test** — append to the existing fabrication describe file (reuse its export builders; if it has none for ledger, use `makeExport`/`turn` from `./export-helpers`):

```ts
describe('gui-actor exemption (2026-07-20)', () => {
  it('does not flag a value committed by the gui actor (card submit), even when prose only shows a mask', () => {
    const e = makeExport({
      messages: [
        { id: 'u', role: 'user', content: '⟦action⟧✓ Telefon: ***607', toolCalls: null, toolResults: null, createdAt: 'x' },
        { id: 'a', role: 'assistant', content: 'Mulțumesc.', toolCalls: null, toolResults: null, createdAt: 'x' },
      ] as never,
      turns: [turn(0, {
        userMessage: '⟦action⟧✓ Telefon: ***607',
        startedAt: Date.parse('2026-07-19T08:27:50.000Z'), endedAt: Date.parse('2026-07-19T08:27:56.000Z'),
        toolCalls: [{ round: 0, toolCallId: 'x', name: 'collect_customer_field', args: { field: 'phone', value: '0735226607' }, partition: 'writing',
          result: { success: true, durationMs: 5, cached: false } }],
      })] as never,
      ledger: [{ id: 'L1', tool: 'collect_customer_field', actor: 'gui', outcome: 'applied', effects: [], reasonCode: null,
        phaseFrom: 'DISCOVERY', phaseTo: 'DISCOVERY', idempotencyDisposition: 'fresh', targetRef: 'field:phone',
        createdAt: '2026-07-19T08:27:51.410Z' }] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'questionnaire_answer_fabricated')).toBe(false)
  })

  it('still flags an agent-actor value with no anchor (net intact)', () => {
    const e = makeExport({
      messages: [
        { id: 'u', role: 'user', content: 'buna', toolCalls: null, toolResults: null, createdAt: 'x' },
        { id: 'a', role: 'assistant', content: 'ok', toolCalls: null, toolResults: null, createdAt: 'x' },
      ] as never,
      turns: [turn(0, {
        userMessage: 'buna',
        startedAt: Date.parse('2026-07-19T08:27:50.000Z'), endedAt: Date.parse('2026-07-19T08:27:56.000Z'),
        toolCalls: [{ round: 0, toolCallId: 'x', name: 'collect_customer_field', args: { field: 'phone', value: '0735226607' }, partition: 'writing',
          result: { success: true, durationMs: 5, cached: false } }],
      })] as never,
      ledger: [{ id: 'L1', tool: 'collect_customer_field', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null,
        phaseFrom: 'DISCOVERY', phaseTo: 'DISCOVERY', idempotencyDisposition: 'fresh', targetRef: 'field:phone',
        createdAt: '2026-07-19T08:27:51.410Z' }] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'questionnaire_answer_fabricated')).toBe(true)
  })
})
```

NOTE for the implementer: check the existing test file's imports first — it may already import `makeExport`/`turn`; if its local builders differ, adapt the scaffolding but keep the assertions verbatim.

- [x] **Step 4.2: Verify failure** — `npx vitest run __tests__/lib/diagnostics/checks-fabrication.test.ts` → the first new test FAILS (value `0735226607` is numeric-shaped, in scope, unanchored → currently flagged).

- [x] **Step 4.3: Implement** — in `lib/diagnostics/checks-fabrication.ts`, inside the `for (const c of t.toolCalls)` loop of `questionnaireAnswerFabricated`, after the `if (!inScope(value)) continue` line, add:

```ts
        // 2026-07-20 (conv cmrrhruba turn 12): a card-submitted value is
        // grounded by the card itself — the persisted prose only carries a
        // mask (⟦action⟧✓ Telefon: ***607). The gui-actor ledger row in this
        // turn's window, matching this tool (and, for collects, this field's
        // targetRef), is the deterministic card-submission trace.
        const tStart = (t as { startedAt?: number }).startedAt ?? 0
        const tEnd = (t as { endedAt?: number }).endedAt ?? Number.MAX_SAFE_INTEGER
        const guiCommitted = (e.ledger ?? []).some((r) => {
          if (r.actor !== 'gui' || r.tool !== c.name || r.outcome !== 'applied') return false
          const at = Date.parse(r.createdAt)
          if (at < tStart || at > tEnd) return false
          if (c.name === 'collect_customer_field') {
            return r.targetRef === `field:${String((c.args as Record<string, unknown>)?.field ?? '')}`
          }
          return true
        })
        if (guiCommitted) continue
```

- [x] **Step 4.4: Verify pass** — diagnostics ring green.
- [x] **Step 4.5: Live proof** — diagnose the conversation → the turn-12 `questionnaire_answer_fabricated` warn is GONE; `stale_card_replayed`/`card_for_committed_fact`/`competing_input_cards`/`unsolicited_contact_card` remain.
- [x] **Step 4.6: Commit** — `fix(diagnostics): card-submitted (gui-actor) values are grounded — exempt from fabrication check`.

---

### Task 5: replay envelopes strip presentation

`writeReplayRow` currently stores + returns the prior envelope verbatim — including `data._uiAction` and the card-directive `data._message` computed against dead state. Effects/facts keep replaying verbatim; presentation is sanitized on BOTH the stored replay-row envelope and the returned one.

**Files:**
- Modify: `lib/tools/gateway.ts` (writeReplayRow, ~line 226)
- Test: `__tests__/lib/tools/gateway-replay-presentation.test.ts` (create), plus one integration assert in `__tests__/integration/gateway-idempotency.test.ts`

- [ ] **Step 5.1: Write the failing unit test** — create `__tests__/lib/tools/gateway-replay-presentation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sanitizeReplayEnvelope, REPLAY_NOTICE } from '@/lib/tools/gateway'
import type { CommitResult } from '@/lib/engines/domain-types'

describe('sanitizeReplayEnvelope (2026-07-20, conv cmrrhruba turn 12)', () => {
  it('drops _uiAction and swaps the card-directive _message for the neutral notice', () => {
    const envelope: CommitResult = {
      outcome: 'applied', effects: [], ledgerId: 'orig', disposition: 'fresh',
      data: {
        fieldSaved: 'residency', nextField: 'phone',
        _message: 'residency saved. Please provide phone.',
        _uiAction: { type: 'show_data_field', payload: { field: 'phone' } },
        _confirmation: { label: 'x', value: 'y', category: 'save', timestamp: 't' },
      },
    }
    const out = sanitizeReplayEnvelope(envelope)
    const d = out.data as Record<string, unknown>
    expect(d._uiAction).toBeUndefined()
    expect(d._message).toBe(REPLAY_NOTICE)
    expect(d.fieldSaved).toBe('residency')          // facts untouched
    expect(d._confirmation).toBeDefined()            // idempotent ✓ line may re-render
    expect(out.ledgerId).toBe('orig')                // join key untouched
    expect(envelope.data).toHaveProperty('_uiAction') // input not mutated
  })

  it('is a no-op for envelopes without a data bag or without presentation fields', () => {
    const bare: CommitResult = { outcome: 'applied', effects: [] }
    expect(sanitizeReplayEnvelope(bare)).toEqual(bare)
    const factsOnly: CommitResult = { outcome: 'applied', effects: [], data: { fieldSaved: 'phone' } }
    expect((sanitizeReplayEnvelope(factsOnly).data as Record<string, unknown>)._message).toBeUndefined()
  })
})
```

- [ ] **Step 5.2: Verify failure** — `npx vitest run __tests__/lib/tools/gateway-replay-presentation.test.ts` → FAIL (no such exports).

- [ ] **Step 5.3: Implement** — in `lib/tools/gateway.ts`, directly above `writeReplayRow`:

```ts
/** Model-facing notice replacing a replayed card directive (spec 2026-07-20 §3). */
export const REPLAY_NOTICE =
  'Already recorded — no change. Ignore any earlier card instruction from this tool; the state briefing lists any input still needed.'

/**
 * Spec 2026-07-20 §3 (conv cmrrhruba turn 12): a replay confirms a fact — it
 * must never re-deliver presentation computed against dead state. Facts and
 * effects replay verbatim; _uiAction is dropped and a card-directive _message
 * is replaced by the neutral notice. _confirmation stays (an idempotent ✓
 * line is truthful).
 */
export function sanitizeReplayEnvelope(envelope: CommitResult): CommitResult {
  if (envelope.data === undefined || envelope.data === null || typeof envelope.data !== 'object') return envelope
  const d = { ...(envelope.data as Record<string, unknown>) }
  if (!('_uiAction' in d) && !('_message' in d)) return { ...envelope, data: d }
  delete d._uiAction
  if (typeof d._message === 'string') d._message = REPLAY_NOTICE
  return { ...envelope, data: d }
}
```

Then change `writeReplayRow` to sanitize what it stores AND returns (the replay row records what THIS interaction delivered; `ledgerId`/inner `disposition` semantics unchanged):

```ts
async function writeReplayRow(db: Db, req: CommitRequest, prior: CommitLedger): Promise<CommitResult> {
  const sanitized = sanitizeReplayEnvelope(prior.envelope as unknown as CommitResult)
  await db.commitLedger.create({
    data: {
      conversationId: req.conversationId, customerId: req.customerId, actor: req.actor, tool: req.tool,
      targetRef: prior.targetRef, argsHash: prior.argsHash, outcome: prior.outcome, effects: prior.effects,
      reasonCode: prior.reasonCode, phaseFrom: prior.phaseFrom, phaseTo: prior.phaseTo,
      idempotencyDisposition: 'replay', envelope: sanitized as unknown as Prisma.InputJsonValue,
    },
  })
  // Facts verbatim, presentation stripped (sanitizeReplayEnvelope); only the
  // disposition marker changes so callers can count replays (F2.4); the
  // ledgerId stays the ORIGINAL applied row's id (the semantic join target).
  return { ...sanitized, disposition: 'replay' }
}
```

- [ ] **Step 5.4: Add the integration assert** — open `__tests__/integration/gateway-idempotency.test.ts`, find the test asserting replay envelope equality (~lines 56-62). It will now FAIL if it compares envelopes deep-equal including `data` — update it: facts (`outcome`, `effects`, `ledgerId`, `data.fieldSaved` etc.) must still match, but assert `data._uiAction` is `undefined` on the replay and `data._message === REPLAY_NOTICE` when the fresh envelope carried a card directive. Keep the file's fixture as-is (it already satisfies the grounding guard). Add:

```ts
    // spec 2026-07-20 §3: replay strips presentation
    const rd = replayEnvelope.data as Record<string, unknown>
    expect(rd._uiAction).toBeUndefined()
```

- [ ] **Step 5.5: Run** — `npx vitest run __tests__/lib/tools/gateway-replay-presentation.test.ts __tests__/integration/gateway-idempotency.test.ts` → PASS. Then the tool ring: `npx vitest run __tests__/integration/` → green (fix any test pinning the old verbatim-replay behavior by aligning it with the spec rule, never by weakening the strip).

- [ ] **Step 5.6: Live proof** — in the dev conversation (or a fresh one), trigger any duplicate write via the chat (e.g. re-state residency) and diagnose: NO new `stale_card_replayed` finding for the new turn.

- [ ] **Step 5.7: Commit** — `fix(gateway): replayed envelopes strip presentation — facts replay, cards do not (conv cmrrhruba turn 12)`.

---

### Task 6: ladder gate + due-timing + OTP-owns-turn in `collectCustomerField`

Three emission rules (spec §4, Rulings 2+4): (a) only a LADDER save advances the ladder; (b) the next card must be DUE — phone is due only once a quote exists; (c) when the email auto-chain fires, the OTP card owns the turn (no simultaneous phone card).

**Files:**
- Modify: `lib/tools/handlers/data-handlers.ts` (steps 3–4 of collectCustomerField, ~lines 223-277)
- Test: `__tests__/integration/collect-ladder-gate.test.ts` (create)

- [ ] **Step 6.1: Write the failing tests** — create `__tests__/integration/collect-ladder-gate.test.ts`. Copy the setup block (createCustomer + ctx helpers + any message-seeding used to satisfy the grounding guard) from `__tests__/integration/collect-cnp-validation.test.ts`. For the quote fixture, reuse the existing builder found via `grep -r "status: 'ISSUED'" __tests__/integration` (quote-lifecycle tests create application+quote rows — mirror that helper). Tests:

```ts
describe('ladder gate (spec 2026-07-20 §4, conv cmrrhruba turns 6/10/12)', () => {
  it('a non-ladder save (declaredAge) emits NO card and no Please-provide directive', async () => {
    const c = await createCustomer()
    const r = await collectCustomerField({ field: 'declaredAge', value: '40' }, ctx(c.id))
    expect(r.success).toBe(true)
    expect(r.uiAction).toBeUndefined()
    expect(r.message).toBe('declaredAge saved.')
  })

  it('a non-ladder save (residency) emits NO card even when email/phone are missing', async () => {
    const c = await createCustomer()
    const r = await collectCustomerField({ field: 'residency', value: 'Romania' }, ctx(c.id))
    expect(r.success).toBe(true)
    expect(r.uiAction).toBeUndefined()
  })

  it('email saved with NO quote → phone card NOT due yet', async () => {
    const c = await createCustomer() // email verified-channel absent but challenge pending → autoChain suppressed:
    await seedPendingChallenge(c.id)  // reuse the pending-challenge helper from collect-email-autochain.test.ts
    const r = await collectCustomerField({ field: 'email', value: 'a@b.ro' }, ctx(c.id))
    expect(r.success).toBe(true)
    expect(r.uiAction).toBeUndefined()
    expect(r.message).toBe('email saved.')
  })

  it('email saved WITH an issued quote → phone card rides (ladder progression)', async () => {
    const c = await createCustomer()
    await seedPendingChallenge(c.id)
    await seedIssuedQuote(c.id, conversationIdOf(ctx)) // application + ISSUED quote fixture
    const r = await collectCustomerField({ field: 'email', value: 'a@b.ro' }, ctx(c.id))
    expect(r.uiAction).toMatchObject({ type: 'show_data_field', payload: { field: 'phone' } })
    expect(r.message).toContain('Please provide phone')
  })

  it('email save that declares the auto-chain → OTP owns the turn: NO data-field card, chain message', async () => {
    const c = await createCustomer() // no verified email, no pending challenge → chain fires
    await seedIssuedQuote(c.id, conversationIdOf(ctx)) // even with phone due, the OTP card wins
    const r = await collectCustomerField({ field: 'email', value: 'a@b.ro' }, ctx(c.id))
    expect((r.data as Record<string, unknown>)._autoChain).toMatchObject({ tool: 'start_channel_verification' })
    expect(r.uiAction).toBeUndefined()
    expect(r.message).toContain('ALREADY sent')
  })
})
```

(The grounding guard requires each collected value to be anchored in recent customer prose — seed a user message containing the value before each collect, exactly as the existing collect tests do.)

- [ ] **Step 6.2: Verify failure** — `npx vitest run __tests__/integration/collect-ladder-gate.test.ts` → the no-card assertions FAIL (cards currently ride every save).

- [ ] **Step 6.3: Implement** — in `lib/tools/handlers/data-handlers.ts`: add import `import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'`, then REPLACE steps 3–5 (current lines ~227-277) with:

```ts
    // 3. Ladder auto-advance (spec 2026-07-20 §4). ONLY a ladder-member save
    // may advance the contact ladder (conv cmrrhruba turns 6/10: declaredAge/
    // residency must not demand contact), the next field must be DUE (phone
    // waits for a quote — Ruling 2), and a declared auto-chain hands the turn
    // to the OTP card (turn 8: two competing input cards).
    const isLadderSave = (FIELD_ORDER as readonly string[]).includes(field)
    let nextField: CollectableField | null = null
    if (isLadderSave && !autoChain) {
      const profile = await getProfile(context.customerId)
      for (const f of FIELD_ORDER) {
        if (!(f in profile.fields)) {
          nextField = f
          break
        }
      }
      if (nextField === 'phone') {
        const snap = await loadDomainSnapshot(context.conversationId, context.db)
        if (snap.quote === null) nextField = null
      }
    }

    // 4. Result assembly — card only when the ladder produced a due nextField.
    const baseData: Record<string, unknown> = {
      fieldSaved: field,
      ...(w.mirrorConflict ? { mirrorConflict: w.mirrorConflict } : {}),
      ...(autoChain ? { _autoChain: autoChain } : {}),
    }
    if (nextField) {
      const meta = FIELD_META[nextField]
      return {
        success: true,
        data: { ...baseData, nextField },
        message: `${field} saved. Please provide ${nextField}.`,
        uiAction: {
          type: 'show_data_field',
          payload: {
            field: nextField,
            label: meta.label,
            type: meta.type,
            validation: meta.validation ?? null,
            placeholder: meta.placeholder ?? null,
          } as unknown as Record<string, unknown>,
        },
      }
    }
    return {
      success: true,
      data: baseData,
      message: autoChain ? emailAutoChainMessage(trimmedValue) : `${field} saved.`,
    }
```

- [ ] **Step 6.4: Run the affected ring** — `npx vitest run __tests__/integration/collect-ladder-gate.test.ts __tests__/integration/collect-email-autochain.test.ts __tests__/integration/collect-field-provenance.test.ts __tests__/integration/collect-cnp-validation.test.ts` → PASS. Note: `collect-email-autochain.test.ts` pins the exact auto-chain `_message` — unchanged by design. If any test pinned `'All customer information collected successfully.'`, update it to the new `'<field> saved.'` contract (the suite audit on 2026-07-19 found no such pin).

- [ ] **Step 6.5: Live proof** — dev server: fresh conversation, say "am 40" after picking a product → NO email card, prose continues discovery. Diagnose the new conversation → zero `unsolicited_contact_card` findings.

- [ ] **Step 6.6: Commit** — `fix(profile-cards): ladder gate + due-timing + OTP-owns-turn in collect_customer_field (conv cmrrhruba turns 6/8/10)`.

---

### Task 7: declination facts — `ProfileFieldDeferral` + `defer_customer_field`

Ruling 6: a customer's "not now" is a FACT, not a card operation. New table + profile-service helpers + a commit tool the agent calls when the customer declines a contact ask; the derivation (Task 8) reads it as status `deferred`.

**Files:**
- Modify: `prisma/schema.prisma` (+ migration `card_state_deferrals`)
- Modify: `lib/customer/profile-service.ts`
- Modify: `lib/tools/registry.ts`, `lib/tools/validation.ts`, `lib/engines/derive-and-expose.ts`
- Modify: `lib/tools/handlers/data-handlers.ts` (handler lives beside collectCustomerField)
- Test: `__tests__/integration/defer-customer-field.test.ts` (create)

- [ ] **Step 7.1: Schema + migration.** Append to `prisma/schema.prisma` (beside CustomerProfile models):

```prisma
/// Spec 2026-07-20 §1 (Ruling 6): a customer's refusal to provide a contact
/// field NOW is a recorded fact the card derivation reads as status
/// 'deferred'. A later provided value simply supersedes (field presence wins).
model ProfileFieldDeferral {
  id             String   @id @default(cuid())
  customerId     String
  field          String
  conversationId String?
  reason         String?
  createdAt      DateTime @default(now())

  @@index([customerId, field, createdAt])
}
```

Run: `npx prisma migrate dev --name card_state_deferrals` (docker db must be up). Then `npx prisma generate`.
Expected: one new migration folder; `npx tsx scripts/verify-migrations.ts` still green.

- [ ] **Step 7.2: Write the failing test** — create `__tests__/integration/defer-customer-field.test.ts` (setup copied from collect-cnp-validation.test.ts):

```ts
describe('defer_customer_field (spec 2026-07-20 §1)', () => {
  it('records a deferral fact for a ladder field', async () => {
    const c = await createCustomer()
    const r = await executeTool('defer_customer_field', { field: 'phone', reason: 'nu doresc acum' }, ctx(c.id))
    expect(r.success).toBe(true)
    const rows = await prisma.profileFieldDeferral.findMany({ where: { customerId: c.id, field: 'phone' } })
    expect(rows).toHaveLength(1)
  })

  it('rejects non-ladder fields (only contact asks are deferrable)', async () => {
    const c = await createCustomer()
    const r = await executeTool('defer_customer_field', { field: 'name' }, ctx(c.id))
    expect(r.success).toBe(false)
  })

  it('getFieldDeferrals returns the deferred set; a provided value supersedes', async () => {
    const c = await createCustomer()
    await executeTool('defer_customer_field', { field: 'phone' }, ctx(c.id))
    expect(await getFieldDeferrals(c.id)).toEqual(['phone'])
    // provide the value afterwards (seed grounding prose first, as ever):
    await collectCustomerField({ field: 'phone', value: '0735226607' }, ctx(c.id))
    expect(await getFieldDeferrals(c.id)).toEqual([]) // presence wins over deferral
  })
})
```

- [ ] **Step 7.3: Verify failure** — tool unknown / helper missing.

- [ ] **Step 7.4: Implement**:

(a) `lib/customer/profile-service.ts` — append:

```ts
/** Spec 2026-07-20 §1: fields the customer explicitly declined to provide
 * now, MINUS any field that has since been provided (presence wins). */
export async function getFieldDeferrals(customerId: string, db: DbClient = prisma): Promise<string[]> {
  const rows = await db.profileFieldDeferral.findMany({
    where: { customerId }, select: { field: true }, distinct: ['field'],
  })
  if (rows.length === 0) return []
  const profile = await getProfile(customerId)
  return rows.map((r) => r.field).filter((f) => !(f in profile.fields))
}
```

(Use the file's existing db-handle convention — if its helpers take `db` differently, match them.)

(b) `lib/tools/handlers/data-handlers.ts` — append:

```ts
export const deferCustomerField: ToolHandler = async (args, context) => {
  const { field, reason } = args as { field: string; reason?: string }
  if (!(FIELD_ORDER as readonly string[]).includes(field)) {
    return { success: false, error: `invalid_args: only contact fields (${FIELD_ORDER.join(', ')}) can be deferred.` }
  }
  await context.db.profileFieldDeferral.create({
    data: { customerId: context.customerId, field, conversationId: context.conversationId, reason: reason ?? null },
  })
  return {
    success: true,
    data: { fieldDeferred: field },
    message: `${field} deferral recorded — do not ask again this conversation; the card is released.`,
  }
}
```

(c) `lib/tools/validation.ts` — beside collect_customer_field's schema: `defer_customer_field: z.object({ field: z.string(), reason: z.string().optional() })` (match the file's schema-map idiom).

(d) `lib/tools/registry.ts` — register beside collect_customer_field, kind `'commit'`, sideEffect `'save'`, description:

```
Record that the customer declined to provide a contact field (email/phone) for now. Call when the customer refuses or postpones a contact ask — never invent a refusal. The pending contact card is released by this fact.
```

(e) `lib/engines/derive-and-expose.ts` — exposure rule beside collect_customer_field's (find `collect_customer_field` in the rules list and mirror its `exposedWhen`, e.g. always-exposed commit).

- [ ] **Step 7.5: Run** — `npx vitest run __tests__/integration/defer-customer-field.test.ts` → PASS; `npx vitest run __tests__/lib/tools/registry-kind.test.ts` → green (it pins tool registry invariants; update its expected tool count if it pins one).

- [ ] **Step 7.6: Commit** — `feat(profile): defer_customer_field — declination facts for contact asks (spec §1, Ruling 6)`.

---

### Task 8: `deriveActiveCards` — the SSOT derivation

**v1 scope contract (raise at review — deliberate narrowing of the spec §1 table):** the derived set contains only keys the incident classes + agent awareness need: `data_field:*`, `otp:*`, `question:*`, `confirm:*`. Presentation cards (quote/acceptance/payment/review/upload) stay live-turn hints — their funnel state is already in the briefing via stateGrounding. **Statuses in the set: `active` | `expired` | `deferred`. `resolved`/`superseded` materialize as ABSENCE** — a client-rendered card whose key is not in the set renders inert ("no longer needed"); the briefing prints only what the set contains.

**Files:**
- Create: `lib/chat/derive-active-cards.ts`
- Test: `__tests__/integration/derive-active-cards.test.ts`

- [ ] **Step 8.1: Write the failing tests** (integration — real DB; reuse the customer/conversation fixture builders from `__tests__/integration/collect-cnp-validation.test.ts`, the application/quote builders from the quote-lifecycle tests, and the DNT session builders from the DNT flow tests — find each via grep before writing):

```ts
import { deriveActiveCards } from '@/lib/chat/derive-active-cards'

describe('deriveActiveCards (spec 2026-07-20 §1)', () => {
  it('empty conversation → empty set (DISCOVERY is contact-free)', async () => {
    const { conversationId } = await makeConversationFixture()
    expect(await deriveActiveCards(conversationId)).toEqual([])
  })

  it('open application → data_field:email active (identity anchor before DNT)', async () => {
    const { conversationId } = await makeConversationFixture({ openApplication: true })
    const cards = await deriveActiveCards(conversationId)
    expect(cards).toContainEqual(expect.objectContaining({ key: 'data_field:email', status: 'active' }))
    expect(cards.find((c) => c.key === 'data_field:phone')).toBeUndefined() // phone waits for a quote
  })

  it('email in profile → data_field:email absent (resolved = absence)', async () => {
    const { conversationId, customerId } = await makeConversationFixture({ openApplication: true })
    await setDeclaredField(customerId, 'email', 'a@b.ro', 'test')
    const cards = await deriveActiveCards(conversationId)
    expect(cards.find((c) => c.key === 'data_field:email')).toBeUndefined()
  })

  it('issued quote → data_field:phone active; deferral row → status deferred', async () => {
    const { conversationId, customerId } = await makeConversationFixture({ openApplication: true, issuedQuote: true })
    const before = await deriveActiveCards(conversationId)
    expect(before).toContainEqual(expect.objectContaining({ key: 'data_field:phone', status: 'active' }))
    await prisma.profileFieldDeferral.create({ data: { customerId, field: 'phone' } })
    const after = await deriveActiveCards(conversationId)
    expect(after).toContainEqual(expect.objectContaining({ key: 'data_field:phone', status: 'deferred' }))
  })

  it('unconsumed challenge → otp active while unexpired, expired after — never silently absent', async () => {
    const { conversationId, customerId } = await makeConversationFixture()
    const ch = await prisma.verificationChallenge.create({ data: { customerId, channel: 'email', target: 'a@b.ro', codeHash: 'h', expiresAt: new Date(Date.now() + 60_000) } })
    expect(await deriveActiveCards(conversationId)).toContainEqual(expect.objectContaining({ key: 'otp:email', status: 'active' }))
    await prisma.verificationChallenge.update({ where: { id: ch.id }, data: { expiresAt: new Date(Date.now() - 1_000) } })
    expect(await deriveActiveCards(conversationId)).toContainEqual(expect.objectContaining({ key: 'otp:email', status: 'expired' }))
  })

  it('active DNT session with a pending question → question:<code> active with a renderable uiAction', async () => {
    const { conversationId } = await makeDntSessionFixture() // reuse the DNT test builder
    const cards = await deriveActiveCards(conversationId)
    const q = cards.find((c) => c.key.startsWith('question:'))
    expect(q?.status).toBe('active')
    expect(q?.uiAction?.type).toMatch(/^show_(question|medical_batch)$/)
  })

  it('latest ledger row requires_confirmation → confirm:<tool> active', async () => {
    const { conversationId, customerId } = await makeConversationFixture()
    await prisma.commitLedger.create({ data: { conversationId, customerId, actor: 'agent', tool: 'sign_dnt', targetRef: 'x', argsHash: 'h', outcome: 'requires_confirmation', effects: [], idempotencyDisposition: 'fresh', envelope: {} } })
    expect(await deriveActiveCards(conversationId)).toContainEqual(expect.objectContaining({ key: 'confirm:sign_dnt', status: 'active' }))
  })
})
```

- [ ] **Step 8.2: Verify failure** — module does not exist.

- [ ] **Step 8.3: Implement** — create `lib/chat/derive-active-cards.ts`:

```ts
/**
 * Card-state SSOT (spec 2026-07-20 §1): the server's answer to "what inputs
 * is the customer currently being asked for, and what is each one's status?"
 * Extends the derive-pending-card reload-parity precedent to the full input-
 * card set. Consumed by: the orchestrator's turn-end cards_state SSE event,
 * the /chat/[id] reload seed, and the ON-SCREEN CARDS briefing section.
 *
 * Set contract: only pending obligations appear. `resolved`/`superseded`
 * materialize as ABSENCE — a rendered card whose key is missing renders
 * inert client-side; the briefing prints only present entries.
 */
import { prisma } from '@/lib/db'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { getProfile, getFieldDeferrals } from '@/lib/customer/profile-service'
import { maskVerificationTarget } from '@/lib/customer/verification-service'
import { derivePendingCard } from './derive-pending-card'
import { FIELD_META_FOR_CARDS } from '@/lib/tools/handlers/data-handlers'

export type ActiveCardStatus = 'active' | 'expired' | 'deferred'
export interface ActiveCard {
  key: string
  status: ActiveCardStatus
  /** Renderable payload — INPUT cards only (data_field/otp/question). */
  uiAction?: { type: string; payload: Record<string, unknown> } | null
  /** Briefing conduct hint, server-authored (spec §5). */
  hint: string
}

export async function deriveActiveCards(conversationId: string): Promise<ActiveCard[]> {
  const snapshot = await loadDomainSnapshot(conversationId)
  const customerId = snapshot.customerId
  const [profile, deferrals] = await Promise.all([getProfile(customerId), getFieldDeferrals(customerId)])
  const cards: ActiveCard[] = []

  // ---- data_field ladder (Ruling 2: email at application start, phone at quote)
  const emailDue = snapshot.application !== null || snapshot.dnt.sessionActive
    || deriveAndExpose(snapshot).actions.available.includes('open_dnt_session')
  const fieldCard = (field: 'email' | 'phone'): ActiveCard => deferrals.includes(field)
    ? { key: `data_field:${field}`, status: 'deferred', hint: `customer declined ${field} for now — do NOT re-ask; resumes only if they offer it` }
    : {
        key: `data_field:${field}`, status: 'active',
        uiAction: { type: 'show_data_field', payload: FIELD_META_FOR_CARDS[field] },
        hint: `the ${field} card owns this input — invite the customer to fill it; do not re-ask in prose`,
      }
  if (!('email' in profile.fields) && emailDue) cards.push(fieldCard('email'))
  if (!('phone' in profile.fields) && snapshot.quote !== null && 'email' in profile.fields) cards.push(fieldCard('phone'))

  // ---- otp: latest unconsumed challenge, INCLUDING expired (expiry is a
  // status, never a disappearance — spec §1; the snapshot's pendingChallenge
  // filters expired, so query directly)
  const challenge = await prisma.verificationChallenge.findFirst({
    where: { customerId, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (challenge && !snapshot.identity.verifiedChannels.includes(challenge.channel as 'email' | 'sms')) {
    const expired = challenge.expiresAt <= new Date()
    cards.push({
      key: `otp:${challenge.channel}`,
      status: expired ? 'expired' : 'active',
      uiAction: { type: 'show_otp_entry', payload: { channel: challenge.channel, target: challenge.target, targetMasked: maskVerificationTarget(challenge.channel as 'email' | 'sms', challenge.target) } },
      hint: expired
        ? 'the code EXPIRED — offer to resend (start_channel_verification); never ask for the old code'
        : 'a code-entry card is live — ask for the 6-digit code or the email link; do not resend unprompted',
    })
  }

  // ---- question: reuse the existing reload-parity derivation verbatim
  const pending = await derivePendingCard(conversationId)
  if (pending) {
    const payload = pending.payload as Record<string, unknown>
    const code = (payload.code ?? (payload.question as { code?: string } | undefined)?.code ?? 'batch') as string
    cards.push({ key: `question:${code}`, status: 'active', uiAction: pending as ActiveCard['uiAction'], hint: 'the question card owns this input — invite a tap, never enumerate options in prose' })
  }

  // ---- confirm: ledger-derived pending confirmations (existing P0-5 fact)
  for (const tool of snapshot.pendingConfirmationTools ?? []) {
    cards.push({ key: `confirm:${tool}`, status: 'active', hint: `a ${tool} confirmation card awaits the customer's tap — do NOT call ${tool} again` })
  }

  return cards
}
```

Supporting change in `lib/tools/handlers/data-handlers.ts`: export the card payloads the derivation reuses (single source with the emitter):

```ts
/** Card payloads shared with deriveActiveCards (spec 2026-07-20 §1). */
export const FIELD_META_FOR_CARDS: Record<CollectableField, Record<string, unknown>> = Object.fromEntries(
  FIELD_ORDER.map((f) => [f, {
    field: f,
    label: FIELD_META[f].label,
    type: FIELD_META[f].type,
    validation: FIELD_META[f].validation ?? null,
    placeholder: FIELD_META[f].placeholder ?? null,
  }]),
) as Record<CollectableField, Record<string, unknown>>
```

NOTE: `derivePendingCard`'s question-payload shape — verify the `code` extraction against `questionnaire-cards.ts`'s `questionCard()` payload before finalizing (adjust the two-step lookup if the code rides elsewhere; the widget threads `question.code` since the 2026-06-24 fix).

- [ ] **Step 8.4: Run** — `npx vitest run __tests__/integration/derive-active-cards.test.ts` → PASS.
- [ ] **Step 8.5: Commit** — `feat(cards): deriveActiveCards — server-derived card set with semantic keys + statuses (spec §1)`.

---

### Task 9: `cards_state` turn-end SSE event

**Files:**
- Modify: `lib/chat/stream-handler.ts` (SSEEvent union), `lib/chat/orchestrator.ts` (turn-end yield), `lib/chat/sse-consumer.ts` (dispatch case)
- Test: `__tests__/lib/chat/sse-consumer-cards.test.ts` (create) + one assertion in the existing orchestrator/synthetic-turn integration harness

- [ ] **Step 9.1: Failing consumer test** — create `__tests__/lib/chat/sse-consumer-cards.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { consumeSSE } from '@/lib/chat/sse-consumer'

const sseResponse = (frames: string[]): Response =>
  new Response(new ReadableStream({
    start(c) { frames.forEach((f) => c.enqueue(new TextEncoder().encode(f))); c.close() },
  }))

describe('cards_state SSE dispatch (spec 2026-07-20 §2)', () => {
  it('dispatches cards_state frames to onCardsState', async () => {
    const seen: unknown[] = []
    await consumeSSE(sseResponse([
      'event: cards_state\ndata: {"cards":[{"key":"data_field:email","status":"active","hint":"x"}]}\n\n',
      'event: done\ndata: {}\n\n',
    ]), {
      onCardsState: (d) => seen.push(d),
      onDone: () => {},
    })
    expect(seen).toEqual([{ cards: [{ key: 'data_field:email', status: 'active', hint: 'x' }] }])
  })
})
```

- [ ] **Step 9.2: Verify failure** — `onCardsState` not a known handler / frame dropped by default case.

- [ ] **Step 9.3: Implement**
  - `stream-handler.ts`: add `| 'cards_state'` to the SSEEvent union.
  - `sse-consumer.ts`: add optional `onCardsState?: (data: Record<string, unknown>) => void` to the handlers type and a `case 'cards_state': handlers.onCardsState?.(data); break` beside `ui_action`.
  - `orchestrator.ts` turn end — insert immediately BEFORE the final `done` yield (after STEP 8's assistant save, so the derivation sees the turn's committed state), with the same failure posture as turn-debug persistence (never break the turn):

```ts
    // Card-state SSOT (spec 2026-07-20 §2): the turn's authoritative card
    // set — the client reconciles rendered cards against it; absence of a
    // key means resolved/superseded.
    try {
      const cards = await deriveActiveCards(state.conversationId)
      yield { event: 'cards_state', data: { cards } }
    } catch (err) {
      logError({ layer: 'chat', category: 'cards_state', message: 'deriveActiveCards failed at turn end', context: { conversationId: state.conversationId }, error: err })
    }
```

  (import `deriveActiveCards` from `./derive-active-cards`.)

- [ ] **Step 9.4: Orchestrator-level assertion** — in the existing synthetic-turn harness (`__tests__/integration/synthetic-turn-tool-loop.test.ts` collects generator events): add to one happy-path test:

```ts
    const cardsEvents = events.filter((e) => e.event === 'cards_state')
    expect(cardsEvents).toHaveLength(1)
    expect(events.findIndex((e) => e.event === 'cards_state')).toBeLessThan(events.findIndex((e) => e.event === 'done'))
```

- [ ] **Step 9.5: Run** — the two test files + `npx vitest run __tests__/integration/` → green.
- [ ] **Step 9.6: Commit** — `feat(chat): cards_state turn-end SSE event — derived card set reaches the client every turn`.

---

### Task 10: reload parity — full derived set seeds the client

**Files:**
- Modify: `app/chat/[id]/page.tsx`, `components/chat/chat-page.tsx`, `lib/hooks/use-chat.ts` (options only, state lands in Task 11)

- [x] **Step 10.1:** In `page.tsx`, replace the `derivePendingCard` try/catch seed with:

```ts
  let initialCards: ActiveCard[] = []
  try {
    initialCards = await deriveActiveCards(conversation.id)
  } catch (e) {
    logError({ layer: 'chat', category: 'cards_state', message: 'reload card derivation failed', context: { conversationId: conversation.id }, error: e })
  }
```

Pass `initialCards` through `ChatPage` props into `useChat` options (`initialCards?: ActiveCard[]`), replacing `initialUiAction` end-to-end (delete the old option and its Map seeding — Task 11 owns the new state). `derivePendingCard` itself STAYS (the derivation calls it).

- [x] **Step 10.2:** Type-only step — `npx tsc --noEmit` green after the prop threading; behavior verified in Task 11/12 tests + the browser pass.
- [x] **Step 10.3: Commit** — `feat(chat): reload seeds the full derived card set (spec §2)` (combined with Task 11's commit if the tree is not independently green — the two tasks may share one commit when splitting would leave a red intermediate state; note it in the commit body).

---

### Task 11: client card state — pure `card-view` reducer + use-chat wiring

**Files:**
- Create: `lib/chat/card-view.ts`
- Modify: `lib/hooks/use-chat.ts`
- Test: `__tests__/lib/chat/card-view.test.ts` (create — PURE unit tests carry the logic)

- [x] **Step 11.1: Failing unit tests** for the pure reducer:

```ts
import { cardView, cardKeyForUiAction, cardKeyForAction } from '@/lib/chat/card-view'

describe('card-view (spec 2026-07-20 §2 — ✓ can never lie)', () => {
  const cardsState = [
    { key: 'data_field:phone', status: 'active', hint: 'x' },
    { key: 'otp:email', status: 'expired', hint: 'x' },
    { key: 'data_field:email', status: 'deferred', hint: 'x' },
  ]
  it('key in set: active→interactive, expired→inert_expired (resend enabled), deferred→inert_released', () => {
    expect(cardView('data_field:phone', cardsState, null)).toEqual({ status: 'interactive' })
    expect(cardView('otp:email', cardsState, null)).toEqual({ status: 'inert_expired' })
    expect(cardView('data_field:email', cardsState, null)).toEqual({ status: 'inert_released' })
  })
  it('key absent from set → inert_resolved (absence = resolved/superseded)', () => {
    expect(cardView('question:BD_1', cardsState, null)).toEqual({ status: 'inert_resolved' })
  })
  it('submitting key overrides while in flight', () => {
    expect(cardView('data_field:phone', cardsState, 'data_field:phone')).toEqual({ status: 'submitting' })
  })
  it('maps rendered uiActions and submitted actions to semantic keys', () => {
    expect(cardKeyForUiAction({ type: 'show_data_field', payload: { field: 'phone' } })).toBe('data_field:phone')
    expect(cardKeyForUiAction({ type: 'show_otp_entry', payload: { channel: 'email' } })).toBe('otp:email')
    expect(cardKeyForAction({ type: 'submit_field', payload: { field: 'phone', value: 'x' } })).toBe('data_field:phone')
    expect(cardKeyForUiAction({ type: 'show_quote', payload: {} })).toBeNull() // presentation cards: no key in v1
  })
})
```

- [x] **Step 11.2: Verify failure**, then **implement** `lib/chat/card-view.ts` as a PURE module (no React):

```ts
/** Client card-truth reducer (spec 2026-07-20 §2). Absence from cardsState
 * = resolved/superseded; ✓ is only ever derived from server state. */
export interface ActiveCardEntry { key: string; status: 'active' | 'expired' | 'deferred'; uiAction?: { type: string; payload: Record<string, unknown> } | null; hint?: string }
export type CardViewStatus = 'interactive' | 'submitting' | 'inert_resolved' | 'inert_expired' | 'inert_released'

export function cardKeyForUiAction(ui: { type: string; payload: Record<string, unknown> }): string | null {
  switch (ui.type) {
    case 'show_data_field': return typeof ui.payload.field === 'string' ? `data_field:${ui.payload.field}` : null
    case 'show_otp_entry': return typeof ui.payload.channel === 'string' ? `otp:${ui.payload.channel}` : null
    case 'show_question': case 'show_medical_batch': {
      const code = (ui.payload.code ?? (ui.payload.question as { code?: string } | undefined)?.code ?? 'batch') as string
      return `question:${code}`
    }
    default: return null // presentation cards keep legacy rendering in v1
  }
}

export function cardKeyForAction(action: { type: string; payload: Record<string, unknown> }): string | null {
  // Enumerate against lib/chat/action-adapter.ts adaptAction's accepted types
  // (verify at implementation time; extend for every input-submit type found):
  switch (action.type) {
    case 'submit_field': return typeof action.payload.field === 'string' ? `data_field:${action.payload.field}` : null
    case 'otp_submit': case 'otp_resend': return `otp:${String(action.payload.channel ?? 'email')}`
    case 'answer_question': case 'submit_medical_batch': {
      const code = (action.payload.code ?? action.payload.questionCode ?? 'batch') as string
      return `question:${code}`
    }
    default: return null
  }
}

export function cardView(key: string | null, cardsState: ActiveCardEntry[], submittingKey: string | null): { status: CardViewStatus } {
  if (key === null) return { status: 'inert_resolved' }
  if (submittingKey === key) return { status: 'submitting' }
  const entry = cardsState.find((c) => c.key === key)
  if (!entry) return { status: 'inert_resolved' }
  if (entry.status === 'expired') return { status: 'inert_expired' }
  if (entry.status === 'deferred') return { status: 'inert_released' }
  return { status: 'interactive' }
}
```

- [x] **Step 11.3: Wire use-chat** — replace `uiActions` seeding of `initialUiAction`, `answeredMessageIds`, `markAnswered` with:

```ts
  const [cardsState, setCardsState] = useState<ActiveCardEntry[]>(options.initialCards ?? [])
  const [submittingKey, setSubmittingKey] = useState<string | null>(null)
```

  - `onCardsState: (d) => { if (ownsTurn()) { setCardsState((d.cards ?? []) as ActiveCardEntry[]); setSubmittingKey(null) } }` in BOTH sendMessage and sendAction consumeSSE wirings.
  - `sendAction`: at claim time `setSubmittingKey(cardKeyForAction(action))`; in every error/abort settle path `setSubmittingKey(null)` (the card returns to `interactive` — the server state still lists it).
  - KEEP the per-message `uiActions` Map as the transcript ANCHOR record (which card renders where) — but it no longer carries interactivity; delete `answeredMessageIds`/`markAnswered` from the hook's return type and update `UseChatReturn` (`cardsState`, `submittingKey` exported instead).
- [x] **Step 11.4: Run** — `npx vitest run __tests__/lib/chat/card-view.test.ts` PASS; `npx tsc --noEmit` reveals every message-list/chat-page call-site to update — fix them in Task 12 (run the two tasks to green before committing if the intermediate tree doesn't compile).
- [x] **Step 11.5: Commit** (possibly joint with Task 12) — `feat(chat-client): card truth from derived state — pure card-view reducer, no optimistic ✓`.

---

### Task 12: components render card truth

**Files:**
- Modify: `components/chat/message-list.tsx`, `components/chat/chat-page.tsx`, `components/chat/rich/rich-content.tsx`, `components/chat/rich/inline-data-form.tsx`, `components/chat/rich/otp-entry-card.tsx`

- [x] **Step 12.1: message-list** — delete `lastActionableId` and the `answeredMessageIds`/`markAnswered` props. Per rendered card: `const key = cardKeyForUiAction(action); const view = cardView(key, cardsState, submittingKey)`. Pass `viewStatus={view.status}` down; presentation cards (`key === null`) keep their existing `isAnswered` semantics (newest-wins is retired only for keyed input cards). Append a `PendingCardsBlock` after the last message: for every `cardsState` entry with `status !== 'deferred'` and a `uiAction` whose key is NOT already rendered by a transcript message, render the card from the derived payload (this is reload parity for all input cards).
- [x] **Step 12.2: inline-data-form** — replace `isAnswered` with `viewStatus`: `interactive` → form; `submitting` → disabled with spinner label 'Se trimite…'; `inert_resolved` WITH a locally-typed/answered value → ✓ + value (truthful); `inert_resolved` WITHOUT one → muted "Nu mai este necesar" (NEVER ✓ + empty — kills the fake-✓); `inert_released` → muted "Amânat la cererea ta".
- [x] **Step 12.3: otp-entry-card** — `viewStatus === 'inert_expired'`: code inputs + Verifică disabled, an expiry note ("Codul a expirat"), and the RESEND button ENABLED (it submits `buildOtpResendAction(...)` — an action, allowed from an inert-expired card). `interactive` → as today; `submitting` → all disabled; `inert_resolved` → fully inert ✓.
- [ ] **Step 12.4: Type + suite** — `npx tsc --noEmit` verified clean here; the FULL `npx vitest run` was NOT run at T12 — it is deliberately gated at Task 16 (note (g)), so this step stays open until that gate passes.
- [ ] **Step 12.5: Browser verification** (per <verification_workflow>; the dev server is `preview_start {name:"zeno-dev"}`): fresh conversation → reach the DNT flow → reload mid-questionnaire (question card re-renders interactive); submit an email at application start → OTP card; wait for expiry (10 min TTL — or shrink `expiresAt` via a direct DB update) → reload → OTP card renders EXPIRED with resend enabled; click resend → new code arrives (MockEmail console) → verify. Screenshot each state.
- [x] **Step 12.6: Commit** — `feat(chat-client): truthful card rendering — submitting/resolved/expired/released states, reload parity, resend from expired OTP`.

---

### Task 13: ON-SCREEN CARDS briefing block

The briefing prints ONLY the gap-filling subset (no duplication with battle-tested blocks): `data_field:*` entries (all statuses) and `otp:*` when EXPIRED. Active OTP keeps the existing Verification line; `confirm:*` keeps P0-5; `question:*` keeps the DNT-code line + dntContext/questionnaireContext. The full set still reaches the client — this is prompt hygiene only.

**Files:**
- Modify: `lib/chat/phase-sections-map.ts` (formatDerivedBriefing signature + block), `lib/chat/orchestrator.ts` (pass turn-start card set; record `cards_briefed` debug event)
- Modify: `lib/debug/reducer.ts` + `lib/chat/debug.ts` (DebugTurn.briefedCards)
- Test: `__tests__/lib/chat/phase-sections-briefing.test.ts` (extend the existing formatDerivedBriefing tests if present — grep for `formatDerivedBriefing` in `__tests__` first; else create)

- [ ] **Step 13.1: Failing test:**

```ts
describe('ON-SCREEN CARDS briefing (spec 2026-07-20 §5)', () => {
  it('prints data_field entries and EXPIRED otp entries with their hints', () => {
    const briefing = formatDerivedBriefing(baseState(), baseActions(), [
      { key: 'data_field:phone', status: 'active', hint: 'the phone card owns this input — invite the customer to fill it; do not re-ask in prose' },
      { key: 'data_field:email', status: 'deferred', hint: 'customer declined email for now — do NOT re-ask; resumes only if they offer it' },
      { key: 'otp:email', status: 'expired', hint: 'the code EXPIRED — offer to resend (start_channel_verification); never ask for the old code' },
      { key: 'otp:sms', status: 'active', hint: 'x' },        // active otp: existing Verification line owns it
      { key: 'confirm:sign_dnt', status: 'active', hint: 'x' }, // P0-5 owns it
    ])
    expect(briefing).toContain('ON-SCREEN CARDS:')
    expect(briefing).toContain('data_field:phone [ACTIVE] — the phone card owns this input')
    expect(briefing).toContain('data_field:email [DEFERRED] — customer declined email')
    expect(briefing).toContain('otp:email [EXPIRED] — the code EXPIRED')
    expect(briefing).not.toContain('otp:sms')
    expect(briefing).not.toMatch(/ON-SCREEN CARDS:[\s\S]*confirm:sign_dnt/)
  })
  it('omits the block entirely when no printable entries exist', () => {
    expect(formatDerivedBriefing(baseState(), baseActions(), [])).not.toContain('ON-SCREEN CARDS')
    expect(formatDerivedBriefing(baseState(), baseActions())).not.toContain('ON-SCREEN CARDS')
  })
})
```

(`baseState()`/`baseActions()`: reuse the fixture builders from the existing briefing tests; if none exist, build minimal DerivedStateV3/ExposedActions literals the way `__tests__/lib/engines` fixtures do.)

- [ ] **Step 13.2: Implement** — `formatDerivedBriefing(state, actions, activeCards?: ActiveCard[])`; insert directly AFTER the P0-5 pendingConfirmationTools block:

```ts
  // Spec 2026-07-20 §5 (conv cmrrhruba msgs 13-39: the model talked past a
  // stale phone card + an expired OTP card for 13 turns): the briefing subset
  // that has NO other durable surface — contact-field cards and expired OTP.
  const printable = (activeCards ?? []).filter((c) =>
    c.key.startsWith('data_field:') || (c.key.startsWith('otp:') && c.status === 'expired'))
  if (printable.length > 0) {
    lines.push('ON-SCREEN CARDS:')
    for (const c of printable) lines.push(`- ${c.key} [${c.status.toUpperCase()}] — ${c.hint}`)
  }
```

Orchestrator: where `formatDerivedBriefing(...)` is patched after the gate (~line 648), compute `const briefedCards = await deriveActiveCards(state.conversationId)` (wrap in try/catch → `[]` on failure) and pass as the third argument; also `recordDebugEvent(state, { type: 'cards_briefed', traceId: state.traceId, cards: briefedCards })` so the T14 check has offline evidence. Reducer: add `briefedCards?: {key: string; status: string}[]` to `DebugTurn`, populated from the `cards_briefed` event (mirror how other one-shot events reduce); add the matching payload type in `lib/chat/debug.ts`.

- [ ] **Step 13.3: Run** — the briefing test + `npx vitest run __tests__/lib/chat/` + reducer tests → green.
- [ ] **Step 13.4: Commit** — `feat(prompt): ON-SCREEN CARDS briefing — contact cards + expired OTP become agent-visible (spec §5)`.

---

### Task 14: T11 amendment — constitution + offline net

**Files:**
- Modify: `prisma/seeds/seed-agents.ts` (clause 7, ~line 279-282)
- Modify: `lib/diagnostics/checks-cards.ts` (hasCardTrace extension)
- Test: `__tests__/lib/diagnostics/checks-cards.test.ts`

- [ ] **Step 14.1: Failing check test** — append to checks-cards.test.ts:

```ts
  it('a card reference is LEGAL when the turn\'s briefing listed cards (T11 amendment, spec §5)', () => {
    const e = makeExport({
      messages: [
        { id: 'u', role: 'user', content: 'ce card?', toolCalls: null, toolResults: null, createdAt: 'x' },
        { id: 'a', role: 'assistant', content: 'Poți ignora cardul afișat mai sus — nu mai este necesar.', toolCalls: null, toolResults: null, createdAt: 'x' },
      ] as never,
      turns: [turn(0, { briefedCards: [{ key: 'data_field:phone', status: 'active' }], toolCalls: [] })] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'hallucinated_ui_reference')).toBe(false)
  })
  it('still flags a card reference with neither a tool trace nor briefed cards', () => {
    const e = makeExport({
      messages: [
        { id: 'u', role: 'user', content: 'ok', toolCalls: null, toolResults: null, createdAt: 'x' },
        { id: 'a', role: 'assistant', content: 'Alege pe cardul afișat.', toolCalls: null, toolResults: null, createdAt: 'x' },
      ] as never,
      turns: [turn(0, { toolCalls: [] })] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'hallucinated_ui_reference')).toBe(true)
  })
```

- [ ] **Step 14.2: Implement** — `hasCardTrace` gains a briefed-cards clause:

```ts
const hasCardTrace = (t: { toolCalls: { result?: { success?: boolean; uiAction?: unknown; data?: unknown } }[]; briefedCards?: { key: string }[] }): boolean =>
  (t.briefedCards?.length ?? 0) > 0 ||
  t.toolCalls.some((c) => { /* existing three clauses unchanged */ })
```

Seed clause 7 replacement (`prisma/seeds/seed-agents.ts` — keep the surrounding comment, extend it with `+ 2026-07-20 amendment: briefing-listed cards are referenceable`):

```
'You may reference a card ("cardul afișat", "pe card") when a tool result THIS turn emitted one OR when the ON-SCREEN CARDS briefing lists it. Narrating a card is at most ONE short invite line. For a card the briefing marks EXPIRED or DEFERRED, either resolve it (e.g. offer a code resend) or explicitly tell the customer to ignore it. If neither this turn\'s results nor the briefing shows a card, never claim one exists.',
```

- [ ] **Step 14.3: Reseed + flush** — `npx tsx scripts/reseed-agents.ts`; if the dev server is running, flush the 5-min agent-config cache via the `/api/admin/agents/flush-cache` route (or restart the preview server).
- [ ] **Step 14.4: Run** — diagnostics ring + `npx vitest run` (full) → green.
- [ ] **Step 14.5: Commit** — `feat(constitution): T11 amendment — briefing-listed cards are referenceable; offline net extended`.

---

### Task 15: incident-shape runtime verification script

**Files:**
- Create: `scripts/verify-card-state.ts` (pattern: `scripts/verify-dnt-flow.ts` — stage fixtures via real tools against the dev DB, assert, print `ok/FAIL` per case, exit 1 on any FAIL, clean up its conversation rows)

- [ ] **Step 15.1: Write the script** covering, in one staged conversation each:
  1. `collect_customer_field(declaredAge)` on a fresh conversation → result has NO uiAction, message `declaredAge saved.` (turns 6/10 shape).
  2. Same-args duplicate collect → `disposition: 'replay'`, `data._uiAction` undefined, `data._message === REPLAY_NOTICE` (turn 12 shape).
  3. Email collect with auto-chain conditions → `_autoChain` declared, NO data-field card in the result (turn 8 shape).
  4. Staged OPEN application → `deriveActiveCards` contains `data_field:email` active; + ISSUED quote → `data_field:phone` active; + deferral row → `deferred`; + expired challenge → `otp:email` expired.
  5. Run the diagnostics catalog over the staged conversation's export (`loadConversationExport` + `runDiagnostics`) → ZERO findings for `unsolicited_contact_card`, `stale_card_replayed`, `card_for_committed_fact`, `competing_input_cards`.
- [ ] **Step 15.2: Run** — `npx tsx scripts/verify-card-state.ts` → all cases `ok`, exit 0.
- [ ] **Step 15.3: Commit** — `test(cards): verify-card-state — incident-shape runtime verification (conv cmrrhruba shapes 6/8/10/12)`.

---

### Task 16: full gate + report

- [ ] **Step 16.1:** `npx tsc --noEmit` → clean. `npx tsx scripts/verify-migrations.ts` → green.
- [ ] **Step 16.2:** `npx vitest run` (FULL suite) → green (instrumentation flake rule applies: a sole `__tests__/lib/events/instrumentation.test.ts` failure re-run in isolation counts as PASS).
- [ ] **Step 16.3:** `npm run sims:spec -- 1 1 --only happy-path` → PASS (the funnel still closes end-to-end with the new card rules).
- [ ] **Step 16.4:** Browser pass per Task 12.5 if not already done post-Task-14 reseed (the reseeded constitution + briefing must be live); verify a fresh conversation replaying the user's incident script: „buna ziua" → life insurance → treatment abroad → „am 40" → **no email card**; residency answer → **no phone card**; application start → email card appears; diagnose the new conversation → zero error-severity card findings.
- [ ] **Step 16.5:** Write `docs/superpowers/plans/2026-07-20-card-state-ssot-report.md` — per task: what landed, test evidence (counts), deviations from this plan, the v1 scope notes (presentation-card statuses deferred; briefing subset rule) flagged for the Spec-2 discussion.
- [ ] **Step 16.6:** Final commit `docs(report): card-state SSOT implementation report`; leave the branch local (NO push without an explicit ask).

---

## Self-review (performed at authoring time)

- **Spec coverage:** §1 derivation → T8 (v1 key-scope narrowing documented in T8 header + report); §2 client truth → T10-T12; §3 replay → T5; §4 emission → T6; §5 agent awareness → T13-T14; §6 detection-first → T1-T4 land first; §7 untouched (Spec 2); §8 verification → per-task TDD + T15/T16. Declination fact (§1 Ruling 6) → T7.
- **Known intentional deviations to raise at review:** (a) derived-set v1 excludes presentation-card keys; (b) briefing prints the gap-filling subset only; (c) statuses `resolved`/`superseded` materialize as set-absence.
- **Type consistency:** `ActiveCard`/`ActiveCardStatus` defined in T8 and imported by T9-T13; `ActiveCardEntry` (client mirror) in T11; `REPLAY_NOTICE` exported in T5, consumed in T15; `FIELD_META_FOR_CARDS` exported in T8's supporting change; `briefedCards` added to DebugTurn in T13, consumed in T14.
- **Fixture-scaffold reuse:** where a step says "copy/reuse the builder from <file>", the assertions are complete in this plan and only setup helpers are inherited — the implementer must read that file first (listed per task).
