# Zeno — Tool Catalog & State Machine

Living spec. **R** = read (ambient; may be injected rather than called). **C** = commit (the engine validates and returns a consequence). The engine computes `available_actions` / `blocked_actions` every turn and exposes a tool **only when its "Exposed when" condition holds** — otherwise the tool appears in `blocked_actions` with the reason shown. The agent can only (a) talk and (b) call an exposed action; it never decides a business rule and never changes state except through a commit.

## Assumptions (correct these if wrong)

- **No standalone CONSENT phase.** GDPR + AI-disclosure consent is captured inside `sign_dnt`. `sign_dnt` is the **sole consent-capturing commit**; it appends **ConsentEvent** rows (`gdpr_processing`, `ai_disclosure`).
- **DNT is the first gate of @application** and blocks the underwriting questionnaire until valid.
- The **DNT is a session-based needs-analysis sub-flow** (`new` / `update` session types) ending in `sign_dnt(consent)`. DNT questions use **visibility-only** branching (no consequence machinery — a hidden question is simply not asked, it never invalidates or cascades).
- **Payment options are bundled in `get_quote_info`** — there is no separate `list_available_payment_options`.
- **One application → one quote.** In-place edits only while incomplete; post-quote changes = cancel + new application, pre-filled from the old.
- **`candidate_product` is the sole owner** of product-in-focus; the application freezes a snapshot at creation.

## Commit result taxonomy

Every commit returns a `CommitResult`: one **outcome** + zero or more **effects**.

### Commit outcomes (exactly one per commit)

| Outcome | Meaning |
|---|---|
| `applied` | committed, nothing to surface |
| `rejected` | illegal/invalid move; state unchanged; carries a `reason` |
| `referred` | sent to manual underwriting |
| `pending` | operation recorded, result unknown (external check / settlement gap); re-exposed when resolved |
| `unavailable` | infrastructure failure; state unchanged; `{retryable, retryAfter?}`; **NEVER narrated as a business rejection** |
| `requires_confirmation` | not applied until the user confirms |
| `requires_identity` | blocked until the customer is identified |
| `requires_consent` | blocked until DNT/consent exists |
| `requires_disclosures` | blocked until IDD/IPID docs acknowledged |

### Commit effects (zero or more per commit)

| Effect | Meaning |
|---|---|
| `advance_phase` | moves the state machine forward |
| `re_rating` | premium/schedule will change or changed |
| `cascade_invalidate` | later answers cleared, must be re-asked |
| `cascade_expand` | new questions added to the flow |
| `questions_removed` | downstream questions no longer apply |
| `eligibility_recheck` | may become conditional or ineligible |
| `terminal` | closes the application / quote / policy |

## Cross-cutting tools (available wherever their condition holds)

The actor is **server-resolved** from the session — it is never a caller-supplied argument, so no tool carries a caller-supplied identity input.

| Tool | Type | Inputs | Returns | Exposed when |
|---|---|---|---|---|
| `get_customer_profile` | R | — | prior profile + prior apps/quotes summary | always |
| `get_open_items` | R | — | open applications / unaccepted quotes / pending payments | returning user has open items |
| `identify_customer` | C | auth handoff | identity established | anonymous + a funnel action needs identity |
| `withdraw_consent` | C | scope | consent revoked, processing halted | a consent exists |
| `escalate_to_human` | C | reason, context | handoff confirmation | always |

`get_open_items` returns `{kind, refId, age, nextAction}` per item — **`nextAction` is required** so each open item maps to a currently-exposed tool.

---

> Phase headings below are **documentation grouping** ONLY — exposure is computed by predicates over the full customer+conversation snapshot, NOT the phase table.

## @discovery_consultancy

| Tool | Type | Inputs | Returns | Consequences | Exposed when |
|---|---|---|---|---|---|
| `list_products` | R | filter? (insuranceType) | products[id,name,type, addons[id,name,short_desc]] | — | always |
| `get_product_info` | R | product_id (=candidate) | key_value_product_points, sell_specific_info, **pricing_examples** (variation by parameter), **eligibility_bounds** (e.g. age min/max), addons[] | — | candidate set |
| `get_product_addon_info` | R | product_id, addon_id | sell_specific_addon_info, pricing_examples | — | candidate addon in focus |
| `set_candidate_product` | C | product_id, addon_ids[]? | candidate set | `applied` | always (agent-inferred, no user approval) |
| `set_application` | C | product_id, addon_ids[] | application created (frozen snapshot of candidate) | `advance_phase`→@application | candidate set |

Notes: example pricing is **read from `pricing_examples`**, never computed by the agent. `eligibility_bounds` lets Zeno give an **early eligibility signal** before sending the user into a questionnaire.

**Identity hard gate:** a **verified** channel is required at **accept_quote**, *not* at `set_application`. At `set_application` only a **soft** channel-verification offer is made (the application can proceed unverified); documents are per-product `verificationRequirements` checked before `ensure_payment_session`.

---

## @application

### DNT + consent gate (first; blocks the questionnaire)

The DNT is a session-based needs analysis. Only one session can be active at a time. Questions use **visibility-only** branching (a hidden question is simply not asked). The surface is pinned to **six** tools — three reads, three commits.

| Tool | Type | Inputs | Returns | Consequences | Exposed when |
|---|---|---|---|---|---|
| `get_dnt_state` | R | — | valid:bool, valid_until, products_covered (by type) + **active-session summary** (answered/unanswered counts, started_at) | — | product in focus OR customer has any Dnt |
| `get_dnt_questions` | R | — | full list of DNT questions (preview, no session) | — | product in focus OR customer has any Dnt |
| `get_dnt_next_question` | R | — | next question, answers, answer_type, questions_remaining | — | a session is active + a question pending |
| `open_dnt_session` | C | — | session_id (engine **decides new vs update**; new is populated with questions, update is pre-filled with prior answers) | `applied` · **error-with-active-id** if a session is active | open application lacking valid DNT for its product type, OR customer DNT **expired/expiring** within config window — **renewal needs NO application** |
| `write_dnt_answer` | C | question_id, answer_id, answer_content | next question \| finish signal | `applied` | active session + pending question |
| `sign_dnt` | C | consent{gdpr, ai_disclosure} | DNT signed (engine reads the session's answers) | `applied` · `requires_consent` (if refused) | session finished |

`open_dnt_session` absorbs both creation and amendment — the **engine decides new vs update**, and returns **error-with-active-id** if a session is already active. `get_dnt_state` **absorbs the active-session summary** (no separate session-details read). Answers are re-written in place via `write_dnt_answer` (no separate modify tool).

### Underwriting questionnaire (legal only when DNT valid)

| Tool | Type | Inputs | Returns | Consequences | Exposed when |
|---|---|---|---|---|---|
| `get_next_question` | R | application_id | question \| no_question_needed; possible_answers; answered_count; total_count; branching_metadata? | — | DNT valid, questionnaire incomplete |
| `write_question_answer` | C | application_id, question_id, answer | confirmation | `applied` · `cascade_expand` · `rejected`(invalid/out_of_range) | a current question is pending |
| `modify_answer` | C | application_id, question_id, new_answer | `<consequences>` | `cascade_invalidate` · `questions_removed` · `cascade_expand` · `requires_confirmation` | **application incomplete only** |
| `resume_application` | R | application_id | current position / question | — | an incomplete application exists |
| `get_last_application_info` | R | identity | prior answers for pre-fill | — | a prior completed application exists |
| `cancel_application` | C | application_id | `<consequences>` | `requires_confirmation` → `terminal` | an active application exists |

### Quote generation (legal only when all questions answered)

| Tool | Type | Inputs | Returns | Consequences | Exposed when |
|---|---|---|---|---|---|
| `generate_quote` | C | application_id | quote \| rejection | `advance_phase`→@quote · `rejected`(ineligible/compliance) · `referred`(manual underwriting) | questionnaire 100% answered |

Notes: `generate_quote` is the **deterministic** engine — it issues, rejects-with-reason, or refers to a human underwriter. **Compliance/eligibility live here, never in the LLM.** Issuing a quote **completes the application** (immutable thereafter).

---

## @quote

| Tool | Type | Inputs | Returns | Consequences | Exposed when |
|---|---|---|---|---|---|
| `get_quote_info` | R | quote_id | status, validity/expiry, premium, coverage, **payment_options**, disclosures_required | — | a quote exists |
| `acknowledge_disclosures` | C | quote_id | disclosures recorded | `applied` | IDD/IPID docs not yet acknowledged |
| `accept_quote` | C | quote_id, payment_option | hands off to payment module | `requires_confirmation` → `advance_phase`→@payment · `rejected`(quote_expired) · `requires_identity` (channel not verified) | disclosures acknowledged, quote not expired, **verified** channel present |
| `cancel_quote` | C | quote_id | quote closed | `requires_confirmation` → `terminal` | a quote exists |

Notes: `accept_quote` is the **identity hard gate** — it requires a **verified** channel (a soft verification offer was made earlier at `set_application`); it also requires **express consent** (`requires_confirmation`) and is **idempotent** (double-submit causes no double effect). To change anything after a quote, the application is already complete → **cancel + new application** pre-filled from the old.

---

## @payment  (the payment PROVIDER owns card entry; Zeno monitors and re-engages — never touches credentials)

<!-- F3 fold-back, critic note #10: "Stripe" below is shorthand for the
     configured provider — the implementation ships three (mock, PayU,
     Stripe) selected via PAYMENT_PROVIDER; the contract is provider-
     agnostic: card entry is ALWAYS the provider UI's, never Zeno's. -->

| Tool | Type | Inputs | Returns | Consequences | Exposed when |
|---|---|---|---|---|---|
| `get_payment_status` | R | application_id | schedule, status (pending/paid/failed/abandoned), next_due, failures | — | in @payment |
| `ensure_payment_session` | C | application_id | payment session/link (handoff to Stripe UI); response carries `mode: started \| resumed \| retried` | `applied` · `unavailable` | a schedule with a due / failed / abandoned installment |
| `change_payment_option` | C | application_id, payment_option | new schedule | `re_rating` · `requires_confirmation` | payment not yet captured |

Notes: `ensure_payment_session` is the **single payment-recovery commit** (T8.D4) — it subsumes the former separate resume / retry tools; the engine picks the right `mode` (started/resumed/retried). **`issue_policy` is a system effect** fired by the payment module on the first successful payment — **not an agent tool**. Issue = **create the policy in `pending_submission`**; the agent describes it as paid and being processed, **never as in force until ACTIVE**. Zeno's role here is recovery: detect failure/abandonment, re-engage (including a returning user after days), call `ensure_payment_session`.

---

## @policy

| Tool | Type | Inputs | Returns | Consequences | Exposed when |
|---|---|---|---|---|---|
| `get_policy_status` | R | policy_id | status (**pending_submission** / **submitted** / active / lapsed / cancelled), schedule | — | a policy exists |
| `get_policy_documents` | R | policy_id | policy doc + IPID + terms | — | a policy exists |
| `request_cancellation` | C | policy_id, reason | cancellation outcome | `requires_confirmation` → `terminal` (in free-look window; automatic full **refund** executed by the payment module — free-look / pre-activation) · `rejected`/`referred` (outside) | a policy exists |

Notes: the lifecycle runs `pending_submission` → `submitted` → `active` → (`lapsed` / `cancelled`). A first successful payment creates the policy in **`pending_submission`** (paid + being processed), not in force; it is only **ACTIVE** once submission completes. Cancelling within the free-look / pre-activation window triggers an **automatic full refund** executed by the payment module.

---

## Engine invariants (not tools — properties the engine guarantees)

- `available_actions` / `blocked_actions` (with reasons) are **computed by the engine and injected every turn**.
- Every commit returns a consequence; a failed commit returns `rejected` with a reason, and **the agent surfaces it — it never narrates success**.
- The agent **never states a price absent from state** (`pricing_examples` or a quote) and **never advances a phase by narration** — only a commit's `advance_phase` does that.
- **Compliance and eligibility are deterministic** decisions inside `generate_quote` (and `request_cancellation`), never LLM judgments.
- A non-AI GUI client could call the identical operations and produce identical transitions (the **swap test**); the only agent-specific surface is conversation.
