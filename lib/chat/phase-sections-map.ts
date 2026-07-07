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
  DISCOVERY: ['discoveryConduct', 'capabilityManifest', 'customerContext', 'customerMemory', 'agentKnowledge', 'productContext', 'coachingBriefing'],
  APPLICATION: [], // subphase-driven
  QUOTE: ['discoveryConduct', 'productContext', 'complianceGuidance'],
  PAYMENT: ['paymentContext'],
  POLICY: ['policyContext'],
}

// E1: the discovery-conduct prose (guardrails 1–6, single-match, product
// knowledge, pacing) binds where products are presented and priced —
// DISCOVERY and QUOTE. On APPLICATION/PAYMENT/POLICY turns it is noise and
// pathology surface. The orchestrator nulls the section content by this
// predicate (the dntContext pattern — content nullness is what excludes,
// requiredSections alone never does).
export function includeDiscoveryConduct(phase: Phase): boolean {
  return phase === 'DISCOVERY' || phase === 'QUOTE'
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
// B1: the objective renders as facts the model reasons over — never as a
// command it obeys. "Next best action: call X" trained the model to follow
// wrong engine hints (D5: re-sent the verification code because the hint said
// set_candidate_product while accept_quote sat blocked on requires_identity).
const GOAL_DESCRIPTIONS: Record<import('@/lib/engines/domain-types').FunnelGoal, string> = {
  payment: 'collect the due installment',
  quote_acceptance: 'get the issued quote accepted',
  quote_generation: 'generate the quote',
  application_completion: 'complete the application (remaining answers and coverage selection)',
  needs_analysis: 'complete the needs analysis (DNT)',
  discovery: 'understand the need and converge on a product',
  post_sale: 'serve the customer post-sale (the sale is closed — no selling)',
}

export function formatDerivedBriefing(state: DerivedStateV3, actions: ExposedActions): string {
  const lines: string[] = []
  lines.push(`Phase: ${state.phase}${state.subphase ? '/' + state.subphase : ''}`)
  lines.push(`Open objective: ${GOAL_DESCRIPTIONS[state.objective.goal]}.`)
  if (state.objective.achievableNow) {
    lines.push(`Achievable now via: ${state.objective.achievableNow}.`)
  } else if (state.objective.missingPreconditions.length > 0) {
    for (const b of state.objective.missingPreconditions) {
      lines.push(`Not yet achievable — ${b.action} is blocked: ${b.reason}${b.params ? ' ' + JSON.stringify(b.params) : ''}. Resolve this precondition first; never push a different funnel commit to get around it.`)
    }
  }
  // P0-5: a confirm card is on screen — override any push toward the tool.
  for (const tool of state.pendingConfirmationTools ?? []) {
    lines.push(`AWAITING CUSTOMER CONFIRMATION: ${tool} — a confirmation card is displayed in the chat; do NOT call ${tool} again yourself, invite the customer to tap Confirm on the card (their tap completes it).`)
  }
  if (state.product) lines.push(`Product: ${state.product.code}`)
  if (state.selection.tier) lines.push(`Selection: tier ${state.selection.tier}${state.selection.level ? ', level ' + state.selection.level : ''}${state.selection.addon ? ', add-on included' : ''}`)
  if (state.application && state.application.missingCodes.length > 0) lines.push(`Remaining questions: ${state.application.missingCodes.slice(0, 5).join(', ')}${state.application.missingCodes.length > 5 ? ', …' : ''}`)
  // Sub-stage facts (A4.4): one load-bearing number per stage.
  if (state.phase === 'APPLICATION' && state.subphase === 'DNT') lines.push(`DNT remaining: ${state.dnt.totalCount - state.dnt.answeredCount}`)
  // Phase-INDEPENDENT: DNT sessions legally run in DISCOVERY too (pre-application),
  // and tool results are not replayed across turns — this line is the model's only
  // durable source for the exact code (2026-07-06 debug report).
  if (state.dnt.sessionActive && state.dnt.pendingCode) lines.push(`DNT current question code: ${state.dnt.pendingCode} — pass this EXACT code to write_dnt_answer for the current answer. To correct an already-answered DNT question, call write_dnt_answer with THAT question's own code instead (answers are write-or-change; get_dnt_questions lists all codes) — never write the correction into the current question.`)
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
