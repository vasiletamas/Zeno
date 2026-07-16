import { describe, it, expect } from 'vitest'
import { getRegisteredToolNames, getToolDefinition } from '@/lib/tools/registry'

// update_customer_profile retired in B0.1; record_gdpr_consent +
// acknowledge_ai_disclosure retired in B1.1 (capture folds into sign_dnt);
// withdraw_consent added in B1.4; start_dnt_questionnaire retired in B2.4;
// open_dnt_session + write_dnt_answer added in B2.5; save_dnt_answer retired in B2.6;
// resolve_referral + resolve_work_item added in E2.4 (operator queue, actor-gated);
// start/confirm_channel_verification added in B3.5 (identity);
// request_document_upload added in B3.7 (document pipeline);
// B4: start_application→set_application, select_coverage added,
// set_answer/change_selection/switch_product retired (T5.D2/T5.D3);
// C1: save_application_answer→write_question_answer + modify_answer added
// (ADD-1); check_bd_eligibility retired (ADD-2 — bd rule = ELIGIBILITY edges);
// C3: acknowledge_suitability_warning added (C3.4);
// D1: cancel_quote added, modify_quote retired (D1.5/D1.7 — T13.D2);
// D2: acknowledge_disclosures added (D2.3); D3: ensure_payment_session
// replaces initiate_payment, change_payment_option added (D3.3/D3.4);
// D4: mark_submitted/activate_policy/cancel_submission (operator, D4.2) +
// request_cancellation (free-look, D4.5)
// F5.5/T6.D3 deviation (2026-07-06): sign_medical_declarations added — the
// batch affirmation of the CONFIRM_ALWAYS medical answers (sign_dnt precedent);
// T10 (2026-07-16): write_medical_batch added — the ONE-card bulk BD write
// ("none of these apply" + toggles), per-question consequences in one commit
const COMMITS = ['set_candidate_product', 'open_dnt_session', 'write_dnt_answer', 'sign_dnt', 'set_application', 'write_question_answer', 'write_medical_batch', 'modify_answer', 'select_coverage', 'resume_application', 'cancel_application', 'acknowledge_suitability_warning', 'sign_medical_declarations', 'generate_quote', 'accept_quote', 'cancel_quote', 'acknowledge_disclosures', 'ensure_payment_session', 'change_payment_option', 'collect_customer_field', 'escalate_to_human', 'withdraw_consent', 'resolve_referral', 'resolve_work_item', 'mark_submitted', 'activate_policy', 'cancel_submission', 'request_cancellation', 'start_channel_verification', 'confirm_channel_verification', 'request_document_upload']

describe('tool kind classification', () => {
  it('every registered tool carries a kind', () => {
    for (const name of getRegisteredToolNames()) expect(['read', 'commit', 'internal']).toContain(getToolDefinition(name)?.kind)
  })
  it('the 31 committing tools are kind=commit', () => {
    for (const name of COMMITS) expect(getToolDefinition(name)?.kind, name).toBe('commit')
  })
  it('the retired mutators are gone', () => {
    for (const name of ['set_answer', 'change_selection', 'switch_product', 'start_application', 'modify_quote']) expect(getToolDefinition(name)).toBeUndefined()
  })
  it('no registered tool is kind=internal anymore (the two stubs died in A5.ADD-1)', () => {
    for (const name of getRegisteredToolNames()) expect(getToolDefinition(name)?.kind).not.toBe('internal')
  })
  it('every kind=read tool declares sideEffects: false (partition + missing_consequences integrity)', () => {
    // partitionToolCalls keys on sideEffects===false, NOT on kind: a read
    // without the flag executes in the writing partition and every success
    // becomes a missing_consequences error (no ledger row can ever back it).
    // Found live: get_next_question flagged 4x in run cmr99s5cb (2026-07-06).
    for (const name of getRegisteredToolNames()) {
      const def = getToolDefinition(name)
      if (def?.kind === 'read') expect(def.sideEffects, name).toBe(false)
    }
  })
  it('the six static-confirm commits require confirmation (gateway-owned two-step)', () => {
    for (const t of ['accept_quote', 'sign_dnt', 'cancel_application', 'cancel_quote', 'change_payment_option', 'request_cancellation']) {
      expect(getToolDefinition(t)?.requiresConfirmation, t).toBe(true)
    }
  })
  it('P2-15: no LLM-facing schema of a confirmable commit offers confirmToken — the CARD owns the round-trip, the model never resends', () => {
    for (const t of ['accept_quote', 'sign_dnt', 'cancel_application', 'cancel_quote', 'change_payment_option', 'request_cancellation', 'sign_medical_declarations']) {
      expect(JSON.stringify(getToolDefinition(t)?.parameters), t).not.toContain('confirmToken')
    }
  })
  it('P2-15: no confirmable commit description tells the model to re-call with the token', () => {
    for (const t of ['accept_quote', 'sign_dnt', 'cancel_application', 'cancel_quote', 'change_payment_option', 'request_cancellation', 'sign_medical_declarations', 'write_question_answer', 'modify_answer']) {
      expect(getToolDefinition(t)?.description ?? '', t).not.toMatch(/re-?call with the token|resend with (the )?confirmToken/i)
    }
  })
})
