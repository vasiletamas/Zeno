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
// (ADD-1); check_bd_eligibility retired (ADD-2 — bd rule = ELIGIBILITY edges)
const COMMITS = ['set_candidate_product', 'open_dnt_session', 'write_dnt_answer', 'sign_dnt', 'set_application', 'write_question_answer', 'modify_answer', 'select_coverage', 'resume_application', 'cancel_application', 'generate_quote', 'accept_quote', 'modify_quote', 'initiate_payment', 'collect_customer_field', 'escalate_to_human', 'withdraw_consent', 'resolve_referral', 'resolve_work_item', 'start_channel_verification', 'confirm_channel_verification', 'request_document_upload']

describe('tool kind classification', () => {
  it('every registered tool carries a kind', () => {
    for (const name of getRegisteredToolNames()) expect(['read', 'commit', 'internal']).toContain(getToolDefinition(name)?.kind)
  })
  it('the 22 committing tools are kind=commit', () => {
    for (const name of COMMITS) expect(getToolDefinition(name)?.kind, name).toBe('commit')
  })
  it('the B4-retired mutators are gone', () => {
    for (const name of ['set_answer', 'change_selection', 'switch_product', 'start_application']) expect(getToolDefinition(name)).toBeUndefined()
  })
  it('no registered tool is kind=internal anymore (the two stubs died in A5.ADD-1)', () => {
    for (const name of getRegisteredToolNames()) expect(getToolDefinition(name)?.kind).not.toBe('internal')
  })
  it('accept_quote, sign_dnt and cancel_application require confirmation (gateway-owned two-step)', () => {
    expect(getToolDefinition('accept_quote')?.requiresConfirmation).toBe(true)
    expect(getToolDefinition('sign_dnt')?.requiresConfirmation).toBe(true)
    expect(getToolDefinition('cancel_application')?.requiresConfirmation).toBe(true) // B4.5
  })
})
