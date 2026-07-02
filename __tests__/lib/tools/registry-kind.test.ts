import { describe, it, expect } from 'vitest'
import { getRegisteredToolNames, getToolDefinition } from '@/lib/tools/registry'

const COMMITS = ['set_candidate_product', 'switch_product', 'update_customer_profile', 'record_gdpr_consent', 'acknowledge_ai_disclosure', 'start_dnt_questionnaire', 'save_dnt_answer', 'sign_dnt', 'start_application', 'save_application_answer', 'set_answer', 'resume_application', 'cancel_application', 'change_selection', 'generate_quote', 'accept_quote', 'modify_quote', 'check_bd_eligibility', 'initiate_payment', 'collect_customer_field', 'escalate_to_human']
const INTERNAL = ['profile_extractor', 'summarizer']

describe('tool kind classification', () => {
  it('every registered tool carries a kind', () => {
    for (const name of getRegisteredToolNames()) expect(['read', 'commit', 'internal']).toContain(getToolDefinition(name)?.kind)
  })
  it('the 21 committing tools are kind=commit (check_bd_eligibility included — it mutates includesAddon)', () => {
    for (const name of COMMITS) expect(getToolDefinition(name)?.kind, name).toBe('commit')
  })
  it('background internals are kind=internal and never gateway-routed', () => {
    for (const name of INTERNAL) expect(getToolDefinition(name)?.kind, name).toBe('internal')
  })
  it('accept_quote and sign_dnt require confirmation (gateway-owned two-step)', () => {
    expect(getToolDefinition('accept_quote')?.requiresConfirmation).toBe(true)
    expect(getToolDefinition('sign_dnt')?.requiresConfirmation).toBe(true)
  })
})
