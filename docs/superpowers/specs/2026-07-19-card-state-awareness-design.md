# Card-state awareness — analysis & general design proposal

**Date:** 2026-07-19 · **Trigger:** conv `cmrrhruba0001g40yh3am7peo` (live test) — a stale, still-interactive phone card sat in the chat after the phone was already saved, an expired OTP card sat above it rendered as inert, and the agent talked past both ("alege pe cardul afișat") for 13 straight turns. · **Status:** SUPERSEDED — discussion held 2026-07-20; the approved design (six rulings) is `2026-07-20-card-state-ssot-design.md`. This document remains the evidence/analysis record.

Companion incident report (the emission-side bug): `docs/debug-reports/2026-07-19-cmrrhruba0001g40yh3am7peo.md`.

---

## Part 1 — Why this happened (evidence-verified)

Four independent mechanisms stacked. Each is cited to code that was read, and the two
non-obvious claims were adversarially verified (one against the DB rows byte-for-byte).

### 1.1 Cards are fire-and-forget client decorations, not state

An emitted `uiAction` exists in exactly two places: the live SSE stream, and (incidentally)
the TurnDebug forensic payload. It is never persisted with the message, never re-derived
for the model, and on reload every card type except the pending question/medical-batch
card is lost (`lib/chat/derive-pending-card.ts:1-60`, `app/chat/[id]/page.tsx:47-60`).

Client-side, cards live in `uiActions: Map<assistantMessageId, action>`
(`lib/hooks/use-chat.ts:93-97`). Two consequences:

- **One card per assistant message, silently.** A second ui_action in the same turn
  overwrites the first (`Map.set` on the same msgId). In our conversation, turn 8 emitted
  BOTH a phone card and the OTP card — the phone card was swallowed and never rendered.
  Multi-card turns silently drop cards.
- **Answered = per instance, optimistic.** `markAnswered(message.id)` fires on click
  regardless of server outcome (`components/chat/message-list.tsx:104-114`). An expired-OTP
  submit permanently bricks the card as "answered ✓" even though verification failed —
  the recorded "answered-card dead end" class.

### 1.2 Supersession is positional, not semantic

Only the newest actionable card is interactive; all older cards are force-rendered inert
via `message.id !== lastActionableId` (`message-list.tsx:85-92,112`). This is why the OTP
card in the screenshot is dead (its resend link included), and why superseded-but-never-
answered cards render as **"answered ✓" with an empty value**
(`components/chat/rich/inline-data-form.tsx:213-227`) — a false UI statement. Nothing
anywhere resolves a card because *its underlying fact got committed*; the questionnaire
family alone has a server-side stale-click guard (C1.9 questionCode mismatch → reject +
re-emit current card, `lib/tools/handlers/application-handlers.ts:248-254`).

### 1.3 A replayed write re-emits a card computed against dead state

The still-interactive empty phone card in the screenshot is turn 12's. DB-verified chain:
the model redundantly re-called `collect_customer_field(residency)`; the gateway idempotency
layer found turn 10's fresh applied row (same argsHash) and returned the stored envelope
**verbatim** — including its `show_data_field(phone)` uiAction and "Please provide phone."
directive, computed when phone was genuinely missing (`lib/tools/gateway.ts:226-239,300-301`;
ledger rows `ac3a22c1…`/`cmrrj9gcq…` diff-identical). "A replay never recomputes" is right
for effects — and wrong for cards: **a replay confirms a fact; it must not re-emit a card
whose premise died.** Anchored to a newer message, the zombie card became `lastActionableId`
and stayed interactive until the DNT cards arrived.

### 1.4 The agent is card-blind by construction — and gagged by T11

Durable prompt state mentions on-screen cards in exactly two places, neither of which covers
this incident: the `requires_confirmation` briefing line (confirmation cards only,
`lib/chat/phase-sections-map.ts:120-123`) and the OTP challenge line — which never mentions
the card and **vanishes entirely when the challenge expires**
(`lib/engines/snapshot-loader.ts:32-36`). A `show_data_field` card has zero durable surface.
Meanwhile the T11 constitution rule forbids referencing any card not emitted this turn
(`prisma/seeds/seed-agents.ts:279-282`), and phase-durable questionnaire conduct mandates
"invite the customer to tap the card" (`lib/chat/context-loaders.ts:827`). Squeezed between
the two, with no way to see, name, or clear the real blockers, "alege pe cardul afișat"
(msgs 21-39) is the model's only legal utterance — aimed at cards it cannot verify exist.

Plus the emission-side bug from the companion report: the unconditional contact-ladder
auto-advance (`lib/tools/handlers/data-handlers.ts:227-261`) emitted the unsolicited cards
in the first place (turns 6, 10; checker now flags all three instances).

---

## Part 2 — General design: cards are derived state, not events

**Principle (matches the Zeno doctrine that recorded state is the only source of truth):
a card is a projection of a pending domain fact, not a message decoration.** The server
must be able to answer at any moment: *"what inputs is the customer currently being asked
for, and what is the status of each?"* — exactly as `deriveState` answers "what phase are
we in". Everything below falls out of that one move.

### A. `deriveActiveCards(conversationId)` — the SSOT

Generalize the existing `derivePendingCard` precedent (which already rebuilds question
cards from domain state on reload) to derive the FULL card set every turn:

| semantic key | derived from | statuses |
|---|---|---|
| `data_field:<field>` | field requested (ladder position / explicit ask) ∧ not in profile | active / resolved / superseded |
| `otp:<channel>` | VerificationChallenge unexpired+unconsumed | active / expired / resolved |
| `question:<code>` | engine next-question walk (exists today) | active / resolved / superseded |
| `confirm:<tool>` | latest ledger outcome = requires_confirmation (exists today) | active / resolved |
| `payment / acceptance / upload / review` | their domain rows (session, quote, request) | active / resolved / expired |

Rules that replace today's accidents:

- **Semantic resolution:** a fact committed by ANY path (card, prose, another instance,
  document extraction) resolves every card instance with that key. No more zombie phone card.
- **Expiry is a status, not a disappearance:** an expired OTP derives `expired` +
  re-send affordance — for the client AND the briefing (fixes both dead ends at once).
- **Live ui_actions become hints:** the SSE event stays for immediacy, but the client
  reconciles against derived state; reload gets full parity for every card type.

### B. Client renders card state truthfully

- ✓ answered only when the underlying commit applied (from the action's server result /
  derived state) — kill optimistic `markAnswered`; a rejected/expired submit re-enables.
- `superseded`/`resolved` render as "no longer needed" (muted), never as fake-✓.
- `expired` renders the re-send button ENABLED (today it dies with positional supersession).
- Anchoring moves off "one card per message id": the active set is rendered from state;
  transcript position is presentation, not identity. (Also fixes the same-turn Map overwrite.)

### C. Agent briefing: an ACTIVE CARDS section

Every turn, the situational briefing lists the derived set:

```
ON-SCREEN CARDS: phone input — STALE (phone already saved; tell the customer to ignore it)
                 OTP entry for m***@… — EXPIRED (offer to resend; do not ask for the code)
```

- Amend T11: the model may reference any card **the briefing lists** (the briefing is the
  evidence); `hallucinated_ui_reference`'s card-trace test extends to briefing-listed cards.
- Conduct rules: never re-ask in prose what an active card asks; on stale/expired, either
  refresh via the owning tool or explicitly release the customer from the card.
- No new `dismiss_card` tool: with cards derived from facts, closure = resolving the fact
  (or expiry). Agent-driven "closing" falls out of C+A; a dismissal tool would re-introduce
  card state the engine can't derive. (Revisit only if a real case emerges.)

### D. Deterministic hygiene, independent of A-C (can ship first)

1. **Gateway replay strips presentation:** on `idempotencyDisposition='replay'`, drop
   `uiAction`/`data._uiAction` and card-directive `_message`s from the returned envelope
   (effects replay; cards don't). Fixes 1.3 outright.
2. **Ladder gate** (companion report): non-ladder saves emit no card; email auto-chain
   turns let the OTP card own the turn.
3. **Reject-side truth for submits:** GUI action submits get answered-state from the
   commit outcome (B depends on this; it is a small, self-contained contract change).

### E. Diagnostics ratchets (offline nets; catalog only grows)

- `stale_card_replayed` — replayed envelope carrying a uiAction (fires on turn 12 today).
- `card_for_committed_fact` — a show_data_field emitted for a field already in the profile
  at emission time (fires on turn 12; distinct check from `unsolicited_contact_card`, landed).
- `competing_input_cards` — >1 input-type uiAction in one turn (fires on turn 8; the client
  silently dropped one).
- Fix `questionnaire_answer_fabricated` false-positive: gui-actor commits are grounded by
  the card, not the prose (this conversation's turn-12 warn on the masked phone number).

---

## Suggested discussion order

1. Accept/adjust the core principle (A) — everything else is downstream.
2. D1 (replay strips cards) + D2 (ladder gate): small, deterministic, independently shippable.
3. B's contract change (answered-state from outcome) — touches the ⟦action⟧ path.
4. C's T11 amendment — constitution + check change, needs the A surface to exist.
5. E ratchets — land with whichever piece makes each one true.
