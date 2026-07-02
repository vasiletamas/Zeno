import type { Phase, AppSubphase, DerivedStateV3, ExposedActions } from '@/lib/engines/domain-types'

const ALWAYS = ['agentIdentity', 'constraints', 'stateGrounding', 'catalogOverview', 'situationalBriefing', 'workflowInstructions']
const BY_PHASE: Record<Phase, string[]> = {
  DISCOVERY: ['capabilityManifest', 'customerContext', 'customerMemory', 'agentKnowledge', 'productContext', 'coachingBriefing'], // old DISCOVERY ∪ old SELECTION
  APPLICATION: [], // subphase-driven
  QUOTE: ['productContext', 'coachingBriefing', 'complianceGuidance'], // old QUOTE set
  PAYMENT: ['productContext', 'complianceGuidance'], // old CLOSING set until A4 adds paymentContext
  POLICY: ['productContext', 'complianceGuidance'], // old CLOSING set until A4 adds policyContext
}
const BY_SUBPHASE: Record<AppSubphase, string[]> = {
  DNT: ['complianceGuidance'], // heir of old CONSENT
  QUESTIONNAIRE: ['questionnaireContext', 'complianceGuidance'],
  QUOTE_GENERATION: ['productContext', 'coachingBriefing', 'complianceGuidance'], // old QUOTE (ready-to-generate)
}
export function getRequiredSectionsFor(phase: Phase, subphase: AppSubphase | null): string[] {
  const extras = phase === 'APPLICATION' && subphase ? BY_SUBPHASE[subphase] : BY_PHASE[phase]
  return [...new Set([...ALWAYS, ...extras])]
}
export function formatDerivedBriefing(state: DerivedStateV3, actions: ExposedActions): string {
  const lines: string[] = []
  lines.push(`Phase: ${state.phase}${state.subphase ? '/' + state.subphase : ''}`)
  lines.push(`Next best action: ${state.nextBestAction}`)
  if (state.product) lines.push(`Product: ${state.product.code}`)
  if (state.selection.tier) lines.push(`Selection: tier ${state.selection.tier}${state.selection.level ? ', level ' + state.selection.level : ''}${state.selection.addon ? ', add-on included' : ''}`)
  if (state.application && state.application.missingCodes.length > 0) lines.push(`Remaining questions: ${state.application.missingCodes.slice(0, 5).join(', ')}${state.application.missingCodes.length > 5 ? ', …' : ''}`)
  lines.push(`Available actions: ${actions.available.join(', ')}`)
  if (actions.blocked.length > 0) {
    lines.push('Blocked actions:')
    for (const b of actions.blocked) lines.push(`- ${b.action} (${b.reason}${b.params ? ' ' + JSON.stringify(b.params) : ''})`)
    lines.push('If the customer asks for a blocked action, explain WHY using the reason above. NEVER work around a blocked action or invent an alternative path.')
  }
  return lines.join('\n')
}
