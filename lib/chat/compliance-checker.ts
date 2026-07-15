import { gateway } from '@/lib/llm/gateway'
import { logInfo, logWarn } from '@/lib/errors/logger'
import type { Message } from '@/lib/llm/providers/types'
import type { Phase, AppSubphase } from '@/lib/engines/domain-types'

/**
 * Task 5.2 (D10): the ledger-verified facts the judge is grounded on —
 * findings these facts disprove are deterministically suppressed.
 */
export interface ComplianceRecordedFacts {
  gdprProcessing: boolean
  aiDisclosure: boolean
  dntSigned: boolean
  dntValidUntil: string | null
}

export interface ComplianceCheckInput {
  messages: Message[]
  customerProfile: Record<string, unknown> | null
  phase: Phase
  recordedFacts?: ComplianceRecordedFacts
  language?: 'en' | 'ro'
}

export interface ComplianceCheckResult {
  passed: boolean
  gaps: string[]
  suggestions: string[]
  /** Task 5.2: gaps the recorded facts disproved — logged, never surfaced. */
  suppressed?: string[]
}

const PASS_RESULT: ComplianceCheckResult = {
  passed: true, gaps: [], suggestions: [],
}

const PRESENTATION_RULES = [
  'PHASE: DISCOVERY (pre-application). The customer is browsing the catalog or exploring products. No application has been started.',
  'Evaluate this insurance conversation against the pre-application compliance rules ONLY.',
  'Check ONLY: (1) AI nature disclosed when context warrants, (2) insurer disclosed on first product mention, (3) GDPR data consent obtained before any PII collection, (4) no fabricated product, price, or inventory claims.',
  'Do NOT flag the following — they belong to the application phase and are enforced by the DNT process:',
  '  - missing needs assessment',
  '  - missing suitability assessment',
  '  - insufficient informed consent (beyond what is required for AI/insurer/GDPR disclosure)',
  'Respond with JSON only: { "passed": boolean, "gaps": string[], "suggestions": string[] }',
]

const APPLICATION_RULES = [
  'PHASE: APPLICATION. The customer has started an application; the DNT and/or questionnaire is in progress.',
  'Evaluate this insurance conversation for full IDD and GDPR compliance.',
  'Check: (1) needs identification before recommendation, (2) suitability assessment, (3) disclosure of role and insurer, (4) informed consent, (5) GDPR data consent.',
  'Respond with JSON only: { "passed": boolean, "gaps": string[], "suggestions": string[] }',
]

/**
 * Which pinned Phases trigger the compliance check at all. Typed
 * Record<Phase, boolean> so adding/renaming a Phase is a compile error here
 * — the trigger can never silently disable again (dual-vocabulary pathology).
 */
export const COMPLIANCE_RELEVANT_BY_PHASE: Record<Phase, boolean> = {
  DISCOVERY: false, APPLICATION: true, QUOTE: true, PAYMENT: true, POLICY: true,
}

/**
 * Rule-set selection keyed on the pinned Phase. DISCOVERY maps to the NARROW
 * pre-application rule set so the over-flagging pathology stays fixed; every
 * other Phase gets the full IDD/GDPR rule set.
 */
export function rulesForPhase(phase: Phase): string[] {
  return phase === 'DISCOVERY' ? PRESENTATION_RULES : APPLICATION_RULES
}

/**
 * Task 5.2 (D10): judge cadence — run at (phase, subphase) TRANSITIONS, not
 * every turn. A stable QUESTIONNAIRE stretch pays zero judge latency; the
 * first observed turn (no prior) always runs (fail-open toward checking).
 */
export function shouldRunComplianceCheck(
  prev: { phase: Phase; subphase: AppSubphase | null } | null,
  cur: { phase: Phase; subphase: AppSubphase | null },
): boolean {
  return prev === null || prev.phase !== cur.phase || prev.subphase !== cur.subphase
}

/**
 * Deterministic suppression (Task 5.2): a finding the recorded facts
 * disprove never reaches the prompt or the anomaly stream — the 26/26
 * "GDPR consent missing" false positives over a SIGNED consent ledger.
 */
const SUPPRESSION_RULES: { fact: (f: ComplianceRecordedFacts) => boolean; pattern: RegExp; reason: string }[] = [
  { fact: (f) => f.gdprProcessing, pattern: /gdpr|data consent|consent.*(personal data|pii)|(personal data|pii).*consent/i, reason: 'gdpr_processing consent is GRANTED in the ledger' },
  { fact: (f) => f.aiDisclosure, pattern: /\bai\b.*(disclos|nature|assistant)|disclos.*\bai\b/i, reason: 'ai_disclosure is acknowledged in the ledger' },
  { fact: (f) => f.dntSigned, pattern: /needs (identification|assessment|analysis)|suitability/i, reason: 'the needs analysis (DNT) is SIGNED' },
]

export function suppressDisprovenGaps(
  gaps: string[],
  facts: ComplianceRecordedFacts,
): { kept: string[]; suppressed: string[] } {
  const kept: string[] = []
  const suppressed: string[] = []
  for (const gap of gaps) {
    const rule = SUPPRESSION_RULES.find((r) => r.fact(facts) && r.pattern.test(gap))
    if (rule) {
      suppressed.push(gap)
      logInfo({ layer: 'compliance', category: 'compliance_suppressed', message: 'Judge finding disproved by recorded facts — suppressed', context: { gap, reason: rule.reason } })
    } else {
      kept.push(gap)
    }
  }
  return { kept, suppressed }
}

function renderRecordedFacts(f: ComplianceRecordedFacts): string {
  return [
    'RECORDED SYSTEM FACTS (ledger-verified — treat these as TRUE; do NOT flag gaps they disprove):',
    `- GDPR processing consent: ${f.gdprProcessing ? 'GRANTED (recorded in the consent ledger)' : 'not recorded'}`,
    `- AI disclosure: ${f.aiDisclosure ? 'ACKNOWLEDGED (recorded)' : 'not recorded'}`,
    `- Needs analysis (DNT): ${f.dntSigned ? `SIGNED${f.dntValidUntil ? `, valid until ${f.dntValidUntil.slice(0, 10)}` : ''}` : 'not signed'}`,
  ].join('\n')
}

/**
 * Execute the compliance checker agent.
 * Fail-open: any error returns passing result (guardrail, not gate).
 *
 * Phase-aware: the rule set narrows in DISCOVERY so we stop flagging
 * premature concerns. See
 * docs/superpowers/specs/2026-05-26-zeno-phase-model-design.md.
 */
export async function executeComplianceCheck(
  input: ComplianceCheckInput,
): Promise<ComplianceCheckResult> {
  try {
    const contextParts: string[] = [...rulesForPhase(input.phase)]

    // Task 5.2 (D10): ground the judge in the recorded facts and pin the
    // output language to the conversation's (the flip-flopping killer).
    if (input.recordedFacts) contextParts.push(renderRecordedFacts(input.recordedFacts))
    contextParts.push(`Write every gap and suggestion in ${input.language === 'en' ? 'English' : 'Romanian'} — the conversation language — regardless of the transcript's mixed languages.`)

    if (input.customerProfile) {
      contextParts.push(`Customer profile: ${JSON.stringify(input.customerProfile)}`)
    }

    const systemMessage: Message = { role: 'user', content: contextParts.join('\n') }
    const messages: Message[] = [systemMessage, ...input.messages.slice(-10)]

    const response = await gateway.call('compliance-checker', { messages })

    if (!response.content) return { ...PASS_RESULT }
    const parsed = parseComplianceResponse(response.content)
    if (!input.recordedFacts || parsed.gaps.length === 0) return parsed
    const { kept, suppressed } = suppressDisprovenGaps(parsed.gaps, input.recordedFacts)
    return {
      passed: kept.length === 0 ? true : parsed.passed,
      gaps: kept,
      suggestions: parsed.suggestions,
      suppressed,
    }
  } catch (err: unknown) {
    logWarn({
      layer: 'orchestrator',
      category: 'compliance_checker',
      message: 'Compliance checker failed, defaulting to pass',
      error: err,
    })
    return { ...PASS_RESULT }
  }
}

function parseComplianceResponse(content: string): ComplianceCheckResult {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { ...PASS_RESULT }

    const parsed = JSON.parse(jsonMatch[0])
    return {
      passed: parsed.passed === true,
      gaps: Array.isArray(parsed.gaps)
        ? parsed.gaps.filter((g: unknown) => typeof g === 'string')
        : [],
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.filter((s: unknown) => typeof s === 'string')
        : [],
    }
  } catch {
    return { ...PASS_RESULT }
  }
}
