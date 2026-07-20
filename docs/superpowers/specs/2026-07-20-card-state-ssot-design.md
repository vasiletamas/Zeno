# Card-state SSOT — approved design

**Date:** 2026-07-20 · **Status:** APPROVED (user rulings 2026-07-20, six decision points) ·
**Evidence base:** `docs/superpowers/specs/2026-07-19-card-state-awareness-design.md` (incident
analysis, conv `cmrrhruba0001g40yh3am7peo`) and
`docs/debug-reports/2026-07-19-cmrrhruba0001g40yh3am7peo.md`.

**Principle (Ruling 1):** a card is a projection of a pending domain fact, not a message
decoration. The server can answer at any moment: *what inputs is the customer being asked
for, and what is each one's status?* — the same doctrine as `deriveState`.

---

## 1. `deriveActiveCards(conversationId)` — the single source of truth

A pure derivation over domain state (profile, VerificationChallenge, questionnaire engine,
CommitLedger, quote/payment/document rows), computed at turn end and on conversation load.
Extends the existing precedents (`lib/chat/derive-pending-card.ts`, ledger-based
`pendingConfirmationTools`) to the FULL card set.

Each card: **semantic key** + **status**.

| key | active when | other statuses |
|---|---|---|
| `data_field:email` | APPLICATION start reached (DNT eligible/open) ∧ email missing ∧ not deferred | resolved / deferred |
| `data_field:phone` | quote exists ∧ phone missing ∧ not deferred | resolved / deferred |
| `otp:<channel>` | challenge unexpired ∧ unconsumed | expired (renders resend) / resolved |
| `question:<code>` | engine next-question walk (as today) | resolved / superseded |
| `confirm:<tool>` | latest ledger outcome = requires_confirmation (as today) | resolved |
| `payment` / `acceptance` / `upload` / `review` | their domain rows | resolved / expired |

Rules:
- **Semantic resolution:** a fact committed by ANY path (card, prose, another instance,
  document extraction) resolves every instance with that key.
- **Ladder timing (Ruling 2, amended):** email activates at APPLICATION start — it is the
  session's identity anchor, ahead of the DNT investment. Phone activates at QUOTE
  (servicing contact). DISCOVERY is contact-free. Volunteered values accepted anytime
  (T28 rule unchanged). A customer refusal is recorded as a **declination fact** (e.g.
  profile-service deferral mark) which derives the card to `deferred` — no card tools.
- **Expiry is a status**, never a disappearance.
- Live `ui_action` SSE events remain as immediacy hints; the derived set is authoritative.

## 2. Client renders derived truth (Ruling 5)

- Submit: card → `submitting…` (locked, no ✓). Turn end: orchestrator emits the freshly
  derived card set (`cards_state` SSE event); client reconciles — applied → resolved-✓,
  rejected/expired → back to `active` with the server reason.
- `expired` OTP renders the resend button ENABLED. `superseded`/`resolved`-unanswered
  render "no longer needed" — never fake-✓ (kills `answeredValue ?? value` empty-✓).
- Optimistic `markAnswered` on click is removed. Positional `lastActionableId`
  supersession and the one-card-per-message `Map` anchoring are retired; the active set
  renders from state (transcript position = presentation only). Reload = full parity for
  every card type (replaces the single-card `derivePendingCard` client seed).

## 3. Replay hygiene (Ruling 4)

`writeReplayRow` (lib/tools/gateway.ts) returns effects verbatim but STRIPS presentation:
`uiAction`/`data._uiAction` dropped; card-directive `_message` replaced with a neutral
"already recorded — no change" notice. Any card still genuinely needed re-appears from the
derived set, so nothing is lost.

## 4. Emission hygiene

- `collectCustomerField` auto-advance (message + card) fires ONLY when the saved field is
  itself a ladder member (`FIELD_ORDER.includes(field)`); non-ladder saves return
  "`<field>` saved." with no card.
- When the email auto-chain fires, the OTP card owns the turn — no simultaneous phone card.

## 5. Agent awareness (Rulings 1+6)

- Situational briefing gains **ON-SCREEN CARDS**: every unresolved card, status, conduct
  hint (`stale → tell the customer to ignore it`, `expired → offer resend`,
  `active → the card owns this input; don't re-ask in prose`).
- T11 amended (seed constraint + `hallucinated_ui_reference` card-trace test): referencing
  a briefing-listed card is legal; referencing a card neither briefing-listed nor emitted
  this turn stays forbidden — hallucination net intact.
- **No card-manipulation tools.** The agent resolves facts; cards follow. Refusals are
  recorded facts (see §1).

## 6. Diagnostics — detection first, at plan start (Ruling 3)

Land before the fixes; red findings on unfixed defects are correct information:
- `stale_card_replayed` — replay-disposition envelope carrying a uiAction (fires on turn 12).
- `card_for_committed_fact` — show_data_field emitted for a field already in the profile
  at emission time (fires on turn 12).
- `competing_input_cards` — >1 input-type uiAction in one turn (fires on turn 8).
- `questionnaire_answer_fabricated`: exempt gui-actor commits whose value matches the card
  submit (fixes the masked-phone false-positive at turn 12).
- (`unsolicited_contact_card` already landed 2026-07-19.)

## 7. Out of scope — Spec 2: identity-continuity (sequenced after this)

Verify-before-reveal (engine filters stored personal data OUT of the prompt for
recognized-unverified sessions; OTP unlock), confirm-stored-data ("I have 40 from last
time — keep or update?"), resume-and-close objective briefing. Depends on this spec's
derived-card substrate and on the corrected funnel query (open shadowing bug). Verify-
before-reveal GATES the other two.

## 8. Verification posture

Every behavior change: failing test first (unit/integration). End-to-end: a scripted sim
replaying the incident shape (non-ladder save → no card; replay → no card; expired OTP →
resend path; prose-committed fact resolves its card) + a browser pass on the live dev
server. Full suite green before any push; no push without an explicit ask.
