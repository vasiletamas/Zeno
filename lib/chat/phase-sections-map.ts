import type { DerivedState, Phase } from '@/lib/chat/derive-state'

/**
 * Deterministic phase → required prompt sections. Replaces the reasoning gate's
 * section selection. The alwaysInclude sections are always present; phaseSpecific
 * adds per-phase sections. All keys must exist in prompt-builder's SECTION_REGISTRY.
 */
export function getRequiredSectionsForPhase(phase: Phase): string[] {
  const alwaysIncluded = [
    'agentIdentity',
    'constraints',
    'stateGrounding',
    'catalogOverview',
    'situationalBriefing',
    'workflowInstructions',
  ]
  const phaseSpecific: Record<Phase, string[]> = {
    DISCOVERY: ['capabilityManifest', 'customerContext', 'customerMemory', 'agentKnowledge'],
    SELECTION: ['productContext', 'coachingBriefing', 'customerContext'],
    CONSENT: ['complianceGuidance'],
    QUESTIONNAIRE: ['questionnaireContext', 'complianceGuidance'],
    QUOTE: ['productContext', 'coachingBriefing', 'complianceGuidance'],
    CLOSING: ['productContext', 'complianceGuidance'],
  }
  return [...new Set([...alwaysIncluded, ...phaseSpecific[phase]])]
}

/**
 * Deterministic replacement for the gate's situational briefing. Surfaces the
 * derived phase + next best action (+ selection / remaining questions) so the
 * model is grounded in where the conversation is and what to do next. The
 * "=== SITUATIONAL ANALYSIS ===" header is added by the section renderer.
 */
export function formatDerivedBriefing(state: DerivedState): string {
  const lines: string[] = []
  lines.push(`Phase: ${state.phase}`)
  lines.push(`Next best action: ${state.nextBestAction}`)
  if (state.product) lines.push(`Product: ${state.product.code}`)
  if (state.selection.tier) {
    const parts = [`tier ${state.selection.tier}`]
    if (state.selection.level) parts.push(`level ${state.selection.level}`)
    if (state.selection.addon) parts.push('add-on included')
    lines.push(`Selection: ${parts.join(', ')}`)
  }
  if (state.application.exists && state.application.missing.length > 0) {
    const shown = state.application.missing.slice(0, 5).join(', ')
    const more = state.application.missing.length > 5 ? ', …' : ''
    lines.push(`Remaining questions: ${shown}${more}`)
  }
  return lines.join('\n')
}
