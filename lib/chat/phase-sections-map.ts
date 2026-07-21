import type { Phase, AppSubphase, DerivedStateV3, ExposedActions } from '@/lib/engines/domain-types'
import { maskVerificationTarget } from '@/lib/customer/verification-service'
import type { ActiveCard } from './derive-active-cards'

// TARGET map (A4.3, T10.D4). Every removal from the A1 content-preserving map
// carries its 'retired because X' note in
// docs/superpowers/notes/2026-06-zeno-prompt-section-inventory.md:
// the workflow-instructions section retired (dead machine, row 14); coachingBriefing off
// the QUOTE surfaces (row 7); productContext/complianceGuidance off
// PAYMENT/POLICY, replaced by the dedicated per-state sections (rows 6, 9 —
// the compliance CHECKER still runs there).
const ALWAYS = ['agentIdentity', 'constraints', 'stateGrounding', 'catalogOverview', 'situationalBriefing']
// Task 3.3 (D3): customerMemory survives the phase transition — the
// returning-customer block (PREFERENCE + RISK_FACTOR first) rides
// APPLICATION and QUOTE, not just DISCOVERY; the fast path still excludes
// it (FAST_PATH_GATE), so questionnaire latency is unchanged.
const BY_PHASE: Record<Phase, string[]> = {
  DISCOVERY: ['discoveryConduct', 'capabilityManifest', 'customerContext', 'customerMemory', 'agentKnowledge', 'productContext', 'coachingBriefing'],
  APPLICATION: [], // subphase-driven
  // discoveryConduct (E1): pricing/catalog guardrails still bind on QUOTE.
  // customerMemory (Task 3.3, D3): returning-customer block rides QUOTE too.
  QUOTE: ['discoveryConduct', 'productContext', 'complianceGuidance', 'customerMemory'],
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
  DNT: ['dntContext', 'complianceGuidance', 'customerMemory'],
  QUESTIONNAIRE: ['questionnaireContext', 'complianceGuidance', 'customerMemory'],
  QUOTE_GENERATION: ['productContext', 'complianceGuidance', 'customerMemory'],
}
export function getRequiredSectionsFor(phase: Phase, subphase: AppSubphase | null): string[] {
  const extras = phase === 'APPLICATION' && subphase ? BY_SUBPHASE[subphase] : BY_PHASE[phase]
  return [...new Set([...ALWAYS, ...extras])]
}

/**
 * Task 1.2 (D2): the derived (phase, subphase) IS the questionnaire step —
 * the workflowStepCode input died with the workflow machine, so the
 * orchestrator maps the engine state to the loader's step vocabulary here.
 */
export function workflowStepCodeFor(phase: Phase, subphase: AppSubphase | null): 'application_fill' | 'dnt_questionnaire' | null {
  if (phase !== 'APPLICATION') return null
  if (subphase === 'QUESTIONNAIRE') return 'application_fill'
  if (subphase === 'DNT') return 'dnt_questionnaire'
  return null
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

// T8: "standard/level_1 + addon" — the advisory config the customer
// converged on when they committed; empty string when none was recorded.
function intentConfigSummary(config: { tier?: string; level?: string; addon?: boolean } | null): string {
  if (!config) return ''
  const base = [config.tier, config.level].filter(Boolean).join('/')
  return `${base}${config.addon ? (base ? ' + addon' : 'addon') : ''}`
}

/**
 * T8 (design 2026-07-15 §3.2/§4): the intent briefing lines.
 * - Same-session and fresh (≤ 7 days): the customer already committed — the
 *   do-not-re-ask directive plus the next action.
 * - Cross-session or older than 7 days: never silently assume — the renewal
 *   script, anchored in recorded data (daysAgo, product, config) and the
 *   CURRENT missing preconditions (funnel progress is monotonic, so what is
 *   missing now was also missing at capture; the capture itself records no
 *   precondition snapshot).
 */
function formatIntentLine(state: DerivedStateV3): string | null {
  const intent = state.intent
  if (!intent) return null
  const cfg = intentConfigSummary(intent.config)
  const cfgSuffix = cfg ? ` (${cfg})` : ''
  const capturedDate = intent.capturedAt.slice(0, 10)
  const daysAgo = Math.floor((Date.now() - new Date(intent.capturedAt).getTime()) / 86_400_000)
  if (intent.sameSession && daysAgo <= 7) {
    return `Active intent: ${intent.goal} ${intent.productCode}${cfgSuffix} — captured ${capturedDate}. The customer has already committed; do NOT re-ask readiness ("Ești gata să continuăm?" is a defect) — proceed to the next step yourself; the only legitimate pauses are the cards (signatures, OTP, upload, acceptance, payment). Next: ${state.nextBestAction}.`
  }
  const missingNow = state.objective.missingPreconditions.map((b) => `${b.action} (${b.reason})`).join(', ')
  const missingThen = missingNow || 'câțiva pași'
  const nowText = missingNow || 'totul este pregătit'
  return `Active intent (${intent.sameSession ? 'stale' : 'from a previous conversation'}, ${daysAgo} days old): ${intent.goal} ${intent.productCode}${cfgSuffix} — captured ${capturedDate}. Do not silently assume it still holds — RENEW WITH CONTEXT: ask ONE question anchored in the recorded state, e.g. "Acum ${daysAgo} zile te interesa ${intent.productCode}${cfgSuffix} — lipsea ${missingThen}; acum ${nowText}. Continuăm?" — then proceed on a yes, or call set_purchase_intent with {renounce: true} if they decline.`
}

export function formatDerivedBriefing(state: DerivedStateV3, actions: ExposedActions, activeCards?: ActiveCard[]): string {
  const lines: string[] = []
  lines.push(`Phase: ${state.phase}${state.subphase ? '/' + state.subphase : ''}`)
  // T8: momentum first — the intent line precedes the objective so the
  // do-not-re-ask directive frames everything below it.
  const intentLine = formatIntentLine(state)
  if (intentLine) lines.push(intentLine)
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
  // Spec 2026-07-20 §5 (conv cmrrhruba msgs 13-39: the model talked past a
  // stale phone card + an expired OTP card for 13 turns): the briefing subset
  // that has NO other durable surface — contact-field cards and expired OTP.
  // ACTIVE otp keeps the Verification line below, confirm:* keeps P0-5 above,
  // question:* keeps the DNT-code line — printing them here would duplicate.
  //
  // DEFERRED entries are NOT on screen: the derivation gives them no uiAction
  // and message-list filters them out, so they must never appear under the
  // ON-SCREEN heading — telling the customer to "ignore" a card that does not
  // render is the very T11 fabrication this section exists to prevent. They
  // ride their own suppression line instead (the fact still matters: it is why
  // the ask is absent).
  const briefable = (activeCards ?? []).filter((c) =>
    c.key.startsWith('data_field:') || (c.key.startsWith('otp:') && c.status === 'expired'))
  const onScreen = briefable.filter((c) => c.status !== 'deferred')
  const deferred = briefable.filter((c) => c.status === 'deferred')
  if (onScreen.length > 0) {
    lines.push('ON-SCREEN CARDS:')
    for (const c of onScreen) lines.push(`- ${c.key} [${c.status.toUpperCase()}]: ${c.hint}`)
  }
  for (const c of deferred) {
    lines.push(`DECLINED (no card on screen): ${c.key} — ${c.hint}`)
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
  // The re-ask lapse (2026-07-06 battery): show what is ON FILE, not just
  // what is missing — the model occasionally re-asked a collected field when
  // it could only see the needs list.
  const knownFields = Object.keys(state.identity.fields ?? {}).filter((f) => state.identity.fields[f] !== undefined)
  if (knownFields.length > 0) {
    lines.push(`Identity on file: ${knownFields.join(', ')} — these are already recorded; do NOT ask the customer for them again and do NOT re-collect them.`)
  }
  // Task 1.1 (D5): the endgame that killed the recorded sale — while a code
  // is in flight the ONE correct move is confirming the digits the customer
  // supplies; a re-send silently invalidates the code they are reading.
  if (state.identity.pendingChallenge) {
    const pc = state.identity.pendingChallenge
    const to = pc.target ? maskVerificationTarget(pc.channel, pc.target) : `the customer's ${pc.channel}`
    const attempts = pc.attemptsRemaining !== undefined && pc.attemptsRemaining < 5 ? ` ${pc.attemptsRemaining} attempts remaining.` : ''
    lines.push(`Verification: code sent via ${pc.channel} to ${to}, awaiting the 6-digit code.${attempts} When the customer supplies digits, call confirm_channel_verification with them. Do NOT resend — a new send invalidates the code already in their inbox; only if the customer explicitly asks for a new code, call start_channel_verification with resend: true.`)
  }
  if (state.phase === 'QUOTE' && state.quote) lines.push(`Quote valid until: ${state.quote.validUntil.slice(0, 10)}`)
  if (state.phase === 'PAYMENT') lines.push(`Payment status: ${state.schedule.lastPaymentStatus ?? 'pending'}`)
  if (state.flagsForReview.length > 0) lines.push(`Flags for review: ${state.flagsForReview.join(', ')}`)
  lines.push(`Available actions: ${actions.available.join(', ')}`)
  if (actions.blocked.length > 0) {
    lines.push('Blocked actions:')
    for (const b of actions.blocked) lines.push(`- ${b.action} (${b.reason}${b.params ? ' ' + JSON.stringify(b.params) : ''})`)
    lines.push('If the customer asks for a blocked action, explain WHY using the reason above. NEVER work around a blocked action or invent an alternative path.')
    // Task 1.3 (D8): the loop-breaker's explain-and-escalate instruction.
    if (actions.blocked.some((b) => b.reason === 'repeated_failure')) {
      lines.push('A tool above is blocked after repeated failures on our side: do NOT attempt it again this conversation. Apologize, say plainly that something went wrong at our end, and offer to retry later or hand off to a human colleague (escalate_to_human).')
    }
  }
  return lines.join('\n')
}
