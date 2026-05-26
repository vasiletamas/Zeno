import { gateway } from '@/lib/llm/gateway'
import { logWarn } from '@/lib/errors/logger'
import type { Message } from '@/lib/llm/providers/types'
import type { ConversationPhase } from './phase'

export interface ComplianceCheckInput {
  messages: Message[]
  workflowStepCode: string | null
  customerProfile: Record<string, unknown> | null
  phase: ConversationPhase
}

export interface ComplianceCheckResult {
  passed: boolean
  gaps: string[]
  suggestions: string[]
}

const PASS_RESULT: ComplianceCheckResult = {
  passed: true, gaps: [], suggestions: [],
}

const PRESENTATION_RULES = [
  'PHASE: PRESENTATION (pre-application). The customer is browsing the catalog or exploring products. No application has been started.',
  'Evaluate this insurance conversation against the PRESENTATION-phase compliance rules ONLY.',
  'Check ONLY: (1) AI nature disclosed when context warrants, (2) insurer disclosed on first product mention, (3) GDPR data consent obtained before any PII collection, (4) no fabricated product, price, or inventory claims.',
  'Do NOT flag the following — they belong to the application phase and are enforced by the DNT process:',
  '  - missing needs assessment',
  '  - missing suitability assessment',
  '  - insufficient informed consent (beyond what is required for AI/insurer/GDPR disclosure)',
  'Respond with JSON only: { "passed": boolean, "gaps": string[], "suggestions": string[] }',
].join('\n')

const APPLICATION_RULES = [
  'PHASE: APPLICATION. The customer has started an application; the DNT and/or questionnaire is in progress.',
  'Evaluate this insurance conversation for full IDD and GDPR compliance.',
  'Check: (1) needs identification before recommendation, (2) suitability assessment, (3) disclosure of role and insurer, (4) informed consent, (5) GDPR data consent.',
  'Respond with JSON only: { "passed": boolean, "gaps": string[], "suggestions": string[] }',
].join('\n')

/**
 * Execute the compliance checker agent.
 * Fail-open: any error returns passing result (guardrail, not gate).
 *
 * Phase-aware: the rule set narrows in presentation phase so we stop
 * flagging premature concerns. See
 * docs/superpowers/specs/2026-05-26-zeno-phase-model-design.md.
 */
export async function executeComplianceCheck(
  input: ComplianceCheckInput,
): Promise<ComplianceCheckResult> {
  try {
    const rules = input.phase === 'presentation' ? PRESENTATION_RULES : APPLICATION_RULES
    const contextParts: string[] = [rules]

    if (input.workflowStepCode) {
      contextParts.push(`Current workflow step: ${input.workflowStepCode}`)
    }
    if (input.customerProfile) {
      contextParts.push(`Customer profile: ${JSON.stringify(input.customerProfile)}`)
    }

    const systemMessage: Message = { role: 'user', content: contextParts.join('\n') }
    const messages: Message[] = [systemMessage, ...input.messages.slice(-10)]

    const response = await gateway.call('compliance-checker', { messages })

    if (!response.content) return { ...PASS_RESULT }
    return parseComplianceResponse(response.content)
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
