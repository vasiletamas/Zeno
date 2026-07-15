# Design: Questionnaire UX Standard (T12)

**Status:** ruling (autonomous run, pre-made by the user); governs T7, T9, T10, T11 and every future questionnaire.
**Scope:** ONE uniform interaction model for ALL questionnaires — DNT, application, medical, future products.
**Grounding:** every anchor below verified from source at main @ c1fd5609 (recon 2026-07-15).

## The seven clauses

### 1. Entry cards auto-emit deterministically
Anything that opens a questionnaire emits the first question card in the SAME commit's result. Precedent: `open_dnt_session` → `uiAction: dntQuestionCard(next, progress)` (dnt-handlers.ts:275). Gap closed by T9: the application side has NO entry emission (`set_application` emits nothing; `get_next_question` is a data-only read) — the entry card rides the `select_coverage` commit that completes the coverage selection, and `resume_application` emits the card for its `nextQuestion`. Prose-only entry is a defect class.

### 2. Questions render ONLY on cards
The model's prose is at most one short transition line. The conduct instruction is embedded in EVERY questionnaire tool `_message` (server-owned, not prompt-owned), canonical wording extending dnt-handlers.ts:435:

> A question card is shown to the customer with all the options — NEVER list the options in prose (no "Opțiuni:" lists) and never repeat the question text; invite the customer to answer on the card in ONE short line.

The application family's "Answer saved. N questions remaining." (application-handlers.ts:353) gains the same line (T9). Enforcement is by construction (shared module, below), detection by diagnostics.

### 3. Card click primary, typed fallback, everything ledgered, rejects re-emit
- Card click posts the SAME write tool the model would call (`answer_question` → `write_dnt_answer`/`write_question_answer`, action-adapter.ts:56-74), actor `gui`, addressed by `questionCode` so stale clicks reject precisely.
- Typed answers go through the same tool with the grounding guard (agent actor only).
- A validation/grounding REJECT re-emits the SAME question card by threading it through the rejection envelope: handlers put the card in `data._uiAction` on `success:false` returns — the gateway spreads rejection `data` (gateway.ts:438) and the executor lifts `_uiAction` regardless of outcome (executor.ts:132). (This threading existed on the deleted opus branch; reimplemented by T9.)

### 4. Navigation: any answered question can be revisited
Rides existing invalidation semantics: `modify_answer`/`write_dnt_answer` upsert; the consequence planner returns `invalidations`/`questionsAdded`/`questionsRemoved`; sensitivity `CONFIRM_ON_MODIFY`/`CONFIRM_ALWAYS` requires confirmation ONLY when a prior value existed (consequence-planner.ts:91-97 — first writes are free, per the T6.D3 ruling). No new machinery.

### 5. Completion ALWAYS auto-emits a review/summary card
The commit that answers the LAST question carries the review card in its result — never model-initiated. DNT: `show_dnt_review` (all session Q→A + consent checkboxes + Sign) (T7). Application/medical: `show_medical_review` (declarations + Sign) (T11). The completion `_message` says the card is already shown and forbids the model from calling the sign tool itself or referencing cards that were not emitted.

### 6. Exactly ONE confirmation — the click on the review card
**Ruling (single-confirmation principle):** the signature/confirm click on the auto-appearing review card is the ONLY confirmation. No prose confirms, no "are you ready?", no confirmation-on-confirmation.

Mechanism: **GUI-actor commits are confirmed by construction.** The gateway's confirm gate (`requiresConfirmation` static or handler-conditional, gateway.ts:315-332/413-427) applies only to `actor === 'agent'`. A GUI post originates from a card that rendered exactly the args being committed — the click IS the human confirmation, equivalent in safety to the confirmToken round-trip (which binds argsHash + state fingerprint precisely to prevent AGENT self-confirmation). Evidence for the change: the live test's sign_dnt needed prose consent + confirm card + click (msgs 33-38) and sign_medical_declarations deadlocked on a card that never existed (msg 54-56).

Required consents are UNCHECKED checkboxes on the same card gating the button (GDPR requires affirmative action; pre-ticked is void). The card posts consent values as material args (`sign_dnt {consent:{gdpr,aiDisclosure}}`).

Replay/legality are untouched: ONE_SHOT replay class, exposure wall, in-lock re-checks all still apply to GUI commits.

### 7. The model narrates only
One invite line for an emitted card; regulated wording stays server-side (cards, `_message`s). The constitution gains: a card may be referenced ONLY when a tool result THIS turn emitted one (T11), enforced offline by `hallucinated_ui_reference`.

## The shared module (standard holds by construction)

`lib/tools/handlers/questionnaire-cards.ts` — used by BOTH dnt-handlers and application-handlers:

```ts
export const CONDUCT_LINE: string                    // clause 2 wording
export function questionCard(groupType, next, progress): UiAction | undefined   // unifies dntQuestionCard + application inline card; branches to show_medical_batch for BD_* (T10)
export function savedMessage(groupType, next, progress): string                 // embeds CONDUCT_LINE
export function rejectReemit(data, card): Record<string, unknown>              // clause 3 rejection threading
export function buildDntReviewCard(sessionId, db): Promise<UiAction>            // clause 5 (T7)
export function buildMedicalReviewCard(state): UiAction                         // clause 5 (T11)
```

A future questionnaire that uses this module gets the standard for free; one that bypasses it fails the parity ratchet (`ui-action-registry` + diagnostics `unrendered_ui_action`, `hallucinated_ui_reference`).

## Reload parity (T22 coordination)
Live and reloaded renderings must match: the pending card is re-derived server-side on `/chat/[id]` load (`derivePendingCard` over the domain snapshot: DNT pendingCode → dnt card; application next question → application/medical-batch card) and past interactions render as human chips (⟦action⟧ labels), never `[Action: *]`.

## Medical batch (T10, ruling: option c)
The six BD_* conditions render as ONE card (`show_medical_batch`): primary action "Niciuna dintre acestea nu mi se aplică", per-condition toggles for exceptions. Writes go through `write_medical_batch` — one gateway commit applying the per-question consequence plans sequentially on `context.db` (flag/escalation parity with the sequential path), ledgered once with targetRef `app_answers_batch:<applicationId>`. The signed affirmation stays `sign_medical_declarations` over the SAME revision hash (medical-declarations.ts:19-25) — the batch card answers, the review card confirms; clause 6 still yields exactly one confirmation.
