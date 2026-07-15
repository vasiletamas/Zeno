# =============================================================================
# Zeno — Conversational Sales Agent
# Full Behaviour Specification  (Gherkin / BDD)
#
# Companion to zeno_tool_catalog.md (states, tools, consequences, legality).
# LIVING spec — extend the Scenario Outline Examples tables to add coverage.
# Every scenario is OBSERVABLE BEHAVIOUR at the agent/engine boundary.
#
# Guiding invariant:  "Talk is free, commits are constrained."
#   The agent may say anything; it changes reality ONLY through a legal action
#   the engine exposes, and the engine decides every consequence.
#
# Architecture contract:
#   The agent is a CLIENT of the domain (a conversational frontend). It renders
#   injected state, acts only through exposed operations, owns no business rule,
#   and never narrates a transition the engine did not perform.
#
# Assumptions (see catalog): consent is captured inside sign_dnt; payment
# options are bundled in get_quote_info; one application = one quote.
#
# States: discovery_consultancy -> application(dnt -> questionnaire -> quote-gen)
#         -> quote -> payment -> policy
# =============================================================================


@contract @architecture @regression
Feature: The agent is a client of the domain (no privileged access)

  @id:contract/renders-only-injected-state @agent @backlog
  Scenario: The agent renders only injected state
    When the agent needs to know the current situation
    Then it uses only the state and available_actions injected this turn
    And it never reads hidden engine state directly

  @id:contract/changes-only-through-exposed-operations @engine @backlog
  Scenario: The agent changes reality only through exposed operations
    When the agent intends any change
    Then the change goes through an action present in available_actions
    And the agent has no operation a GUI client could not also call

  @id:contract/failed-commit-surfaced-not-narrated @agent
  Scenario: A commit that fails is surfaced, never narrated as success
    Given the engine returns "rejected" for an attempted commit
    Then the agent tells the customer the action did not complete and why
    And the agent does not claim the change was made

  @id:contract/blocked-action-explained-not-worked-around @agent @backlog
  Scenario: A blocked action is explained, not worked around
    When the customer asks for something in blocked_actions
    Then the agent states the block reason from the engine
    And the agent does not invent an alternative path or fabricate progress

  @id:contract/every-demanded-action-maps-to-exposed-tool @engine @backlog
  Scenario: Every demanded action maps to an exposed tool
    When the engine indicates a next action
    Then a tool exists and is exposed for that action
    And the agent is never instructed to call a tool it does not have

  @id:contract/never-advance-phase-by-narration @agent
  Scenario: The agent never advances a phase by narration
    When no committing action has returned "advance_phase"
    Then the agent does not tell the customer the phase has moved on

  @id:contract/idempotent-on-double-submit @engine
  Scenario: A committing action is idempotent on double-submit
    When the same commit is submitted twice for the same target
    Then the engine applies it once
    And no duplicate effect (e.g. double charge) occurs

  @id:contract/concurrent-gui-and-agent-consistent @engine
  Scenario: Concurrent GUI and agent actions stay consistent
    Given a GUI button and the agent act in the same session
    When both submit operations
    Then the engine serialises them and the resulting state is consistent

  @id:contract/tool-outage-degrades-gracefully @agent @backlog
  Scenario: A tool/endpoint outage degrades gracefully
    Given a required tool is unavailable
    Then the commit returns "unavailable" with {retryable} and state is unchanged
    And the agent does not fabricate a result
    And it retries or offers escalate_to_human


@discovery @consultancy
Feature: Discovery and consultancy

  Background:
    Given Zeno is in the "discovery_consultancy" phase

  @id:discovery/out-of-scope-declined-politely @agent-judge @judge:out-of-scope-decline
  Scenario: Out-of-scope topics are declined politely
    When the customer asks about something unrelated to AZT insurance
    Then Zeno politely declines and steers back to AZT products

  @id:discovery/product-answers-only-from-catalog @agent @backlog
  Scenario: Product questions are answered only from catalog data
    When the customer asks about a product
    Then Zeno uses list_products and get_product_info on the candidate
    And every selling point comes from key_value_product_points or sell_specific_info

  @id:discovery/candidate-set-without-asking @agent @backlog
  Scenario: A candidate product is set without asking the customer
    When the conversation makes clear which product is in focus
    Then Zeno calls set_candidate_product (with addon if one is in discussion)
    And does not ask the customer to approve the candidate
    And every product-scoped read uses the candidate id

  @id:discovery/switching-candidate-updates-cleanly @engine @backlog
  Scenario: Switching the product in focus updates the candidate cleanly
    Given a candidate product is set
    When the customer pivots to a different product
    Then Zeno calls set_candidate_product again
    And no application exists yet, so nothing else must be torn down

  @id:discovery/example-prices-only-from-product-data @agent
  Scenario: Example prices are quoted only from product data
    When the customer asks roughly what it costs
    Then Zeno presents figures from pricing_examples
    And requests any parameter pricing depends on (e.g. age)
    And never computes or invents a price

  @id:discovery/early-eligibility-signal-before-funnel @engine @backlog
  Scenario: Early eligibility signal before the funnel
    Given the product's eligibility_bounds are known
    When the customer's situation falls outside them
    Then Zeno says so before starting an application
    And does not send the customer through a questionnaire that will reject them

  @id:discovery/consultative-pushback-without-pressure @agent-judge @judge:pushback-once
  Scenario: Consultative pushback without pressure
    When the customer is reluctant about a well-suited product
    Then Zeno explains the benefit once and invites reconsideration
    And does not push if the customer remains reluctant

  @id:discovery/starting-application-requires-identity @engine @backlog
  Scenario: Starting an application requires identity
    Given a candidate product is set and the customer is anonymous
    When the customer wants an exact quote or to buy
    Then set_application returns "requires_identity"
    And Zeno routes the customer through identify_customer first

  @id:discovery/starting-application-from-candidate @engine @backlog
  Scenario: Starting an application from the candidate
    Given a candidate product is set and the customer is identified
    When the customer wants an exact quote or to buy
    Then Zeno calls set_application with the candidate product and addons
    And the engine creates an application frozen to that selection
    And the phase advances to "application"


@application @dnt @consent
Feature: DNT - needs analysis, session, and consent gate
  # The DNT is its own session-based needs-analysis sub-flow (new / update
  # session types), separate from the underwriting questionnaire, ending in
  # sign_dnt. DNT questions are flat (no branching, no dependents).

  Background:
    Given Zeno is in the "application" phase

  # ---- state & resume -------------------------------------------------------

  @id:dnt/valid-dnt-lets-questionnaire-begin @engine
  Scenario: A valid DNT covering the product type lets the questionnaire begin
    Given get_dnt_state reports a valid DNT covering the application's product type (home, car, life-simple, or life-with-investment)
    Then sign_dnt and open_dnt_session are not offered
    And the underwriting questionnaire becomes available

  @id:dnt/active-session-resumed-not-restarted @engine
  Scenario: An active DNT session is resumed, not restarted
    Given get_dnt_state reports session_active true with a session id
    Then Zeno continues that session via get_dnt_next_question
    And does not call open_dnt_session

  # ---- starting a new DNT ---------------------------------------------------

  @id:dnt/no-valid-dnt-starts-new-session @engine
  Scenario: No valid DNT and no active session starts a new DNT session
    Given get_dnt_state reports no valid DNT and no active session
    Then the underwriting questionnaire is blocked with reason "requires_consent"
    When Zeno calls open_dnt_session for the customer
    Then a new-type session is created, populated with the DNT questions
    And Zeno proceeds to answer them

  @id:dnt/start-refuses-second-active-session @engine
  Scenario: open_dnt_session refuses to create a second active session
    Given an active DNT session already exists
    When open_dnt_session is called
    Then it returns an error carrying the active session id
    And Zeno resumes that session instead of creating another

  # ---- answering the DNT ----------------------------------------------------

  @id:dnt/walking-questions-one-at-a-time @engine
  Scenario: Walking the DNT questions one at a time
    Given an active DNT session
    When Zeno requests the next step
    Then get_dnt_next_question returns the question, its answers, the answer type, and how many questions remain
    When the customer answers
    Then write_dnt_answer records it and returns the next question

  @id:dnt/last-answer-returns-finish-signal @engine
  Scenario: The last DNT answer returns a finish signal
    Given the final DNT question is answered
    Then write_dnt_answer returns a finish signal
    And sign_dnt becomes available

  @id:dnt/preview-form-without-session @engine
  Scenario: Previewing the full DNT form without starting a session
    When the customer asks what the DNT will ask for
    Then Zeno uses get_dnt_questions to list the questions
    And no session is started

  @id:dnt/reporting-progress @engine @backlog
  Scenario: Reporting DNT progress
    When the customer asks how far along the DNT is
    Then Zeno uses get_dnt_state for the session state, answered and unanswered counts, and the start time

  @id:dnt/changing-answer-just-saves @engine @backlog
  Scenario: Changing a DNT answer just saves the new answer
    Given an active DNT session (new or update type)
    When the customer changes a previous answer
    Then write_dnt_answer saves the new answer for that question
    And there is no consequence and no dependent questions are affected

  # ---- signing --------------------------------------------------------------

  @id:dnt/signing-after-needs-analysis-and-consent @engine @backlog
  Scenario: Signing the DNT after the needs analysis and consent
    Given the DNT session has returned its finish signal
    When the customer gives GDPR and AI-disclosure consent
    Then sign_dnt is called with the session id and consent
    And the engine reads the answers it already holds and signs the DNT
    And the underwriting questionnaire becomes available

  @id:dnt/refused-consent-blocks-funnel @engine @judge:refusal-explained
  Scenario: Refused consent blocks the funnel
    When the customer declines consent at sign_dnt
    Then sign_dnt returns "requires_consent"
    And Zeno explains the funnel cannot continue without it and stops
    And the answered session is preserved

  # ---- renew / update -------------------------------------------------------

  @id:dnt/expired-dnt-updated-and-resigned @engine @backlog
  Scenario: An expired DNT is updated and re-signed
    Given get_dnt_state reports the DNT expired
    When Zeno calls open_dnt_session for that DNT
    Then an update-type session is created, pre-filled with the prior answers and any still-unanswered questions
    And Zeno confirms the remaining questions, then sign_dnt renews the DNT

  @id:dnt/update-refuses-while-new-session-active @engine @backlog
  Scenario: open_dnt_session refuses while a new-type session is active
    Given a new-type DNT session is active
    When open_dnt_session is called
    Then it returns an error
    And Zeno finishes or cancels the new session first

  @id:dnt/dnt-not-covering-product-triggers-fresh-session @engine
  Scenario: A DNT not covering the product type triggers a fresh session
    Given get_dnt_state reports a DNT that does not cover the application's product type
    Then open_dnt_session is offered for the current product type

  # ---- withdrawal -----------------------------------------------------------

  @id:dnt/consent-withdrawn-halts-processing @engine
  Scenario: Consent withdrawn mid-flow halts processing
    Given consent was previously given
    When the customer withdraws consent
    Then Zeno calls withdraw_consent
    And processing halts and Zeno explains the effect


@application @questionnaire
Feature: Underwriting questionnaire

  Background:
    Given Zeno is in the "application" phase with a valid DNT
    And the underwriting questionnaire is available

  @id:questionnaire/questions-one-at-a-time @engine @backlog
  Scenario: Questions are asked one at a time from the engine
    When Zeno needs the next step
    Then it calls get_next_question
    And presents the question, its possible answers, and progress

  @id:questionnaire/answer-recorded-flow-advances @engine @backlog
  Scenario: An answer is recorded and the flow advances
    When the customer answers the current question
    Then write_question_answer returns a confirmation
    And the next question is requested

  @id:questionnaire/branching-provenance-explained @agent @judge:branching-provenance @backlog
  Scenario: A branching question explains why it appears
    Given an answer opens follow-up questions
    Then get_next_question returns them with branching_metadata
    And Zeno tells the customer this question follows from their earlier answer

  @id:questionnaire/invalid-answer-rejected @engine @backlog
  Scenario: An invalid answer is rejected, not accepted
    When the customer gives an out-of-range or invalid answer
    Then write_question_answer returns "rejected" with a reason
    And Zeno asks again rather than recording it

  # Extend this table as the consequence rules grow.
  @id:questionnaire/modify-answer-consequence @engine
  Scenario Outline: Modifying an earlier answer carries its consequence
    Given the application is incomplete
    When the customer changes the answer to "<question>"
    Then modify_answer returns consequence "<consequence>"
    And Zeno surfaces "<surface>" before/after applying
    And a bd_medical answer that makes the addon ineligible returns effect "eligibility_recheck" and the addon removal is surfaced

    Examples:
      | question        | consequence        | surface                                  |
      | a neutral field | applied            | nothing                                  |
      | a branching field | cascade_expand   | new follow-up questions are added        |
      | a gating field  | questions_removed  | some later questions no longer apply     |
      | a dependency    | cascade_invalidate | dependent answers cleared and re-asked   |
      | a sensitive one | requires_confirmation | confirm before applying               |

  @id:questionnaire/refused-mandatory-cannot-bypass @agent @backlog
  Scenario: A refused mandatory question cannot be bypassed
    When the customer refuses a required question
    Then Zeno explains it is required and the application cannot proceed without it
    And does not fabricate or skip the answer

  @id:questionnaire/resuming-incomplete-application @engine @backlog
  Scenario: Resuming an incomplete application
    Given the customer left an incomplete application and returns
    When Zeno re-engages
    Then it calls resume_application and continues at the current question

  @id:questionnaire/cancelling-surfaces-consequences @engine @backlog
  Scenario: Cancelling an application surfaces consequences
    When the customer cancels the application
    Then cancel_application returns a consequences field
    And Zeno explains them and confirms before the terminal action

  @id:questionnaire/all-answered-enables-generation @engine @backlog
  Scenario: All questions answered enables quote generation
    Given every required question is answered
    Then generate_quote becomes available


@application @quote_generation
Feature: Quote generation (deterministic engine)

  Background:
    Given the underwriting questionnaire is fully answered

  @id:quote_generation/successful-quote-completes-application @engine @backlog
  Scenario: A successful quote completes the application
    When generate_quote runs and the customer is eligible
    Then a quote is issued
    And the application is marked completed and becomes immutable
    And the phase advances to "quote"

  # Extend with each real rejection/refer reason.
  @id:quote_generation/can-reject-or-refer-with-reason @engine
  Scenario Outline: Generation can reject or refer with a reason
    When generate_quote runs
    Then it returns "<outcome>" with reason "<reason>"
    And Zeno relays the reason without inventing a price or an approval

    Examples:
      | outcome  | reason              |
      | rejected | compliance_block    |
      | referred | manual_underwriting |

    # @backlog rows = recorded spec<->code divergences (F1.6): the shipped engine emits
    # the specific eligibility reason (ineligible_age_minimum/maximum), and the M10 `pending`
    # path for an external check is unbuilt. F3 folds these back / a later task builds pending.
    @backlog
    Examples:
      | outcome  | reason                 |
      | rejected | ineligible_age         |
      | pending  | pending_external_check |


@quote
Feature: Quote review and acceptance

  Background:
    Given Zeno is in the "quote" phase with an issued quote
    And get_quote_info provides status, validity, premium, coverage and payment_options

  @id:quote/disclosures-precede-acceptance @engine
  Scenario: Mandatory disclosures precede acceptance
    Given the IDD/IPID disclosures are not yet acknowledged
    Then accept_quote is blocked with reason "requires_disclosures"
    When the customer acknowledges the disclosures
    Then acknowledge_disclosures is recorded and accept_quote becomes available

  @id:quote/accept-requires-consent-advances-payment @engine @backlog
  Scenario: Accepting the quote requires express consent then advances to payment
    Given disclosures are acknowledged and the quote is valid
    When the customer chooses a payment option and confirms
    Then accept_quote is called with the chosen option
    And the engine returns "advance_phase" to "payment"

  @id:quote/expired-quote-cannot-be-accepted @engine
  Scenario: An expired quote cannot be accepted
    Given the quote validity has passed
    When the customer tries to accept
    Then accept_quote returns "rejected" with reason "quote_expired"
    And Zeno offers to start a new application (the old one is completed)

  @id:quote/cancelling-quote-terminal @engine @backlog
  Scenario: Cancelling the quote requires consent and is terminal
    When the customer cancels the quote
    Then cancel_quote confirms then closes it
    And buying later requires a new application

  @id:quote/post-quote-change-explained @agent @judge:post-quote-change @backlog
  Scenario: A post-quote change means cancel and re-apply, pre-filled
    Given the application is completed and the customer wants to change an answer
    Then Zeno explains it requires a new application
    And on agreement starts one, pre-filled via get_last_application_info
    And re-confirms every answer including the one being changed before submitting


@payment
Feature: Payment (Stripe handles card entry; Zeno monitors and re-engages)

  Background:
    Given Zeno is in the "payment" phase after an accepted quote

  @id:payment/agent-never-handles-card-data @agent
  Scenario: The agent never handles card data
    When payment is being collected
    Then Zeno hands off to the secure payment UI
    And never asks for or enters card or credential details itself

  @id:payment/declined-payment-retried @engine @backlog
  Scenario: A declined payment is retried
    Given get_payment_status reports the last payment failed
    Then Zeno offers ensure_payment_session

  @id:payment/abandoned-payment-reengaged @engine @backlog
  Scenario: An abandoned payment is re-engaged on return
    Given the customer abandoned payment and returns days later
    When Zeno re-engages
    Then get_open_items surfaces the pending payment
    And Zeno calls ensure_payment_session to let them complete it

  @id:payment/delayed-confirmation-no-double-charge @engine @backlog
  Scenario: A delayed confirmation does not cause a double charge
    Given a payment succeeded but the status still reads pending
    When status is reconciled
    Then the engine treats the payment as paid once
    And no second charge is initiated

  @id:payment/changing-option-rerates-schedule @engine @backlog
  Scenario: Changing the payment option before capture re-rates the schedule
    Given payment has not been captured
    When the customer changes the payment option
    Then change_payment_option returns "re_rating" and a new schedule
    And Zeno confirms the new terms

  @id:payment/first-payment-issues-policy-automatically @engine @backlog
  Scenario: First successful payment issues the policy automatically
    When the first scheduled payment succeeds
    Then the payment module creates the policy in "pending_submission"
    And Zeno describes it as paid and being processed, never as in force until ACTIVE
    And Zeno does not call any issue action itself


@policy
Feature: Policy and post-sale

  Background:
    Given a policy has been issued

  @id:policy/status-and-documents-available @engine @backlog
  Scenario: Policy status and documents are available
    When the customer asks about their policy
    Then Zeno uses get_policy_info

  @id:policy/free-look-cancellation-within-window @engine @backlog
  Scenario: Free-look cancellation within the window
    Given the customer is inside the cooling-off window
    When they request cancellation
    Then request_cancellation confirms then cancels per the free-look rules

  @id:policy/cancellation-outside-window-by-rule @engine @judge:relay-without-promising @backlog
  Scenario: Cancellation outside the window is handled by rule
    Given the cooling-off window has passed
    When the customer requests cancellation
    Then request_cancellation returns the rule-based outcome (rejected or referred)
    And Zeno relays it without promising an outcome the engine did not give


@lifecycle @regression
Feature: Regression guards derived from the failed replay

  @id:lifecycle/never-deadlocks-on-missing-action @engine @backlog
  Scenario: The funnel never deadlocks on a missing action
    Given the engine's next action is a real exposed tool
    When the customer agrees to proceed
    Then Zeno advances by calling that tool
    And never loops by inventing questions to fill a missing action

  @id:lifecycle/one-application-one-quote @engine
  Scenario: One application yields one quote
    Given a quote has been issued for an application
    Then that application accepts no further answers or quotes
    And further changes require a new application

  @id:lifecycle/candidate-single-source-of-product @engine @backlog
  Scenario: The candidate product is the single source of product-in-focus
    When the product in focus changes during discovery
    Then only set_candidate_product records it
    And no second store of the selection can diverge


# =============================================================================
# EXTENSION BACKLOG (turn each into scenarios as the rules firm up)
# =============================================================================
#   @discovery   multiple candidate products explored in parallel
#   @dnt         needs analysis as a multi-step questionnaire (if not single-call)
#   @questionnaire  answer freshness/expiry; duplicate existing policy detected
#   @quote       price/terms changed between view and accept
#   @payment     installment failure after issuance; grace / lapse
#   @compliance  suitability mismatch documented (demands-and-needs warning)
#   @data        GDPR data access / deletion request
#   @i18n        ro/en language switch mid-conversation
# =============================================================================
