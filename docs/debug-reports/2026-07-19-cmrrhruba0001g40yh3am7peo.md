# Diagnosis — unsolicited email card during discovery (conv `cmrrhruba0001g40yh3am7peo`)

**Date:** 2026-07-19 · **Branch:** `main` (post live-test hardening T1–T30) · **Source:** live browser session, reported by the operator ("asked my age, then whether I live in Romania — but an email card appeared, apparently unrelated")

## What happened

Discovery was going well: Protect presented, TREATMENT_ABROAD_BD interest bound (`set_candidate_product` addon `BD`), age asked conversationally. Then:

- **Turn 6** (user: „am 40"): the agent called `collect_customer_field(declaredAge=40)` — exactly what the tool description instructs. The handler saved the age, then **auto-advanced the contact ladder**: result message `"declaredAge saved. Please provide email."` + `uiAction show_data_field(field=email)`. The model's prose (correctly) continued discovery — „Locuiești în România?" — but the email card was already emitted and rendered. The customer saw a contact demand unrelated to the question asked.
- **Turn 10** (user: „da locuiesc in romania"): same mechanism, second instance — `collect_customer_field(residency=Romania)` returned `"residency saved. Please provide phone."` + a **phone** card.
- **Turn 8** (related wrinkle, not the flagged class): the customer filled the email card; the email save (a genuine ladder field) emitted the **phone card** *and* the T19 auto-chain emitted the **OTP card** in the same turn — two competing cards at once. The `_message` on that path says "a code-entry card is shown" while the result's own `uiAction` is the phone card.

Ledger: the only commit in turn 6 is `collect_customer_field → field:declaredAge` (applied, fresh, 07:54:29Z) — no email/verification commit exists before turn 8, so the card could only have come from that result's uiAction. Confirmed independently by an adversarial verify pass that re-read the TurnDebug row from the DB (single tool call in the turn; card present in both `result.uiAction` and `data._uiAction`; turns 0/2/4 emitted zero uiActions, so no stale-card replay).

## Where (file:line)

- `lib/tools/handlers/data-handlers.ts:22` — T28 narrowed `FIELD_ORDER` to `['email','phone']`, with the comment (lines 18–21) that declaredAge "is NOT a ladder card".
- `lib/tools/handlers/data-handlers.ts:227-261` — steps 3/4 of `collectCustomerField`: after **any** applied save, compute the first missing ladder field and return the `Please provide <next>` message + `show_data_field` card. **No gate checks that the SAVED field is itself a ladder member.** (No downstream gate exists either: exposure is `exposedWhen: always` in `lib/engines/derive-and-expose.ts:197`; the gateway wraps the card verbatim, `lib/tools/gateway.ts:493`; the orchestrator emits any present uiAction unconditionally, `lib/chat/orchestrator.ts:1022-1027`.)
- `lib/tools/registry.ts:1184-1191` — the tool description explicitly instructs recording declaredAge via `collect_customer_field`, so the model's call was designed behavior, not model error.

## Why

Root cause class: **`handler-bug`** (latent defect introduced by T28's data-minimization change).

Pre-T28, the ladder covered the whole profile, so "any save advances to the next card" was coherent. T28 (P5.1) shrank the ladder to the contact pair and deliberately created **mid-conversation non-ladder saves** (declaredAge asked conversationally; residency asked in plain conversation pre-quote — the exact two saves this conversation made), but the unconditional auto-advance in steps 3/4 was never gated on ladder membership. Design intent is unambiguous in three places (plan `docs/plans/2026-07-15-implementation-plan.md:300` "SETTABLE but not in the collection ladder"; findings doc T28 "pre-acceptance collection shrinks to phone+email ONLY"; the registry description itself). Nothing intends a contact card after an arbitrary profile save — and no test pins the current behavior (the only `nextField` assertions in the suite live in a stale pre-T28 recorded fixture no test reads those fields from).

The model then did the *right* thing conversationally (asked residency — an eligibility fact) while the handler pushed an unrelated demand — surface contradiction between prose and card, plus a premature contact ask that undercuts T28's own data-minimization posture.

## Concrete fix (not yet applied — pending decision)

1. **Gate the auto-advance on ladder membership**: in `collectCustomerField`, emit the `Please provide <next>` message + `show_data_field` card **only when `FIELD_ORDER.includes(field)`** (i.e., ladder progression: email→phone). Non-ladder saves return plain `"<field> saved."` with no card. Verified against the suite: no existing test pins the current behavior; gating breaks nothing.
2. **(Related, turn-8 class) Let the OTP card own the chained turn**: when the email save declares the T19 `_autoChain`, suppress the phone card in that result — the auto-chained `start_channel_verification` emits `show_otp_entry`, and two simultaneous input cards compete. The `_message` on that path already pretends only the code-entry card exists; make the card behavior match. Ladder resumes naturally on the next applied collect.

## Prevention (ratchet — landed)

- **New deterministic check `unsolicited_contact_card`** (`lib/diagnostics/checks-ui.ts`, catalog-registered, TDD): flags any `collect_customer_field` call whose `args.field` is not a ladder member but whose result carries a `show_data_field` card. Severity `error`. Fires on turns 6 and 10 of this conversation; silent on legitimate ladder progression, cardless saves, and failed collects. Ladder membership imports `FIELD_ORDER` from the handler — one source of truth.
- Candidate follow-up check (deferred until fix 2's design is settled): `competing_input_cards` — two+ input-type uiActions (`show_data_field`/`show_otp_entry`/`show_question`) emitted in one turn. Turn 8 is the incident exemplar.
