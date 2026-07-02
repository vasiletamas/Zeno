import type { Phase, AppSubphase, DerivedStateV3, ExposedActions } from '@/lib/engines/domain-types'

// TARGET map (A4.3, T10.D4). Every removal from the A1 content-preserving map
// carries its 'retired because X' note in
// docs/superpowers/notes/2026-06-zeno-prompt-section-inventory.md:
// the workflow-instructions section retired (dead machine, row 14); coachingBriefing off
// the QUOTE surfaces (row 7); productContext/complianceGuidance off
// PAYMENT/POLICY, replaced by the dedicated per-state sections (rows 6, 9 —
// the compliance CHECKER still runs there).
const ALWAYS = ['agentIdentity', 'constraints', 'stateGrounding', 'catalogOverview', 'situationalBriefing']
const BY_PHASE: Record<Phase, string[]> = {
  DISCOVERY: ['capabilityManifest', 'customerContext', 'customerMemory', 'agentKnowledge', 'productContext', 'coachingBriefing'],
  APPLICATION: [], // subphase-driven
  QUOTE: ['productContext', 'complianceGuidance'],
  PAYMENT: ['paymentContext'],
  POLICY: ['policyContext'],
}
const BY_SUBPHASE: Record<AppSubphase, string[]> = {
  DNT: ['dntContext', 'complianceGuidance'],
  QUESTIONNAIRE: ['questionnaireContext', 'complianceGuidance'],
  QUOTE_GENERATION: ['productContext', 'complianceGuidance'],
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
  // Sub-stage facts (A4.4): one load-bearing number per stage.
  if (state.phase === 'APPLICATION' && state.subphase === 'DNT') lines.push(`DNT remaining: ${state.dnt.totalCount - state.dnt.answeredCount}`)
  if (state.phase === 'QUOTE' && state.quote) lines.push(`Quote valid until: ${state.quote.validUntil.slice(0, 10)}`)
  if (state.phase === 'PAYMENT') lines.push(`Payment status: ${state.schedule.lastPaymentStatus ?? 'pending'}`)
  if (state.flagsForReview.length > 0) lines.push(`Flags for review: ${state.flagsForReview.join(', ')}`)
  lines.push(`Available actions: ${actions.available.join(', ')}`)
  if (actions.blocked.length > 0) {
    lines.push('Blocked actions:')
    for (const b of actions.blocked) lines.push(`- ${b.action} (${b.reason}${b.params ? ' ' + JSON.stringify(b.params) : ''})`)
    lines.push('If the customer asks for a blocked action, explain WHY using the reason above. NEVER work around a blocked action or invent an alternative path.')
  }
  return lines.join('\n')
}
