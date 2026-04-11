import { gateway } from '@/lib/llm/gateway'
import { logWarn } from '@/lib/errors/logger'
import type { Message } from '@/lib/llm/providers/types'

export interface ComplianceCheckInput {
  messages: Message[]
  workflowStepCode: string | null
  customerProfile: Record<string, unknown> | null
}

export interface ComplianceCheckResult {
  passed: boolean
  gaps: string[]
  suggestions: string[]
}

const PASS_RESULT: ComplianceCheckResult = {
  passed: true, gaps: [], suggestions: [],
}

/**
 * Execute the compliance checker agent.
 * Fail-open: any error returns passing result (guardrail, not gate).
 */
export async function executeComplianceCheck(
  input: ComplianceCheckInput,
): Promise<ComplianceCheckResult> {
  try {
    const contextParts: string[] = [
      'Evaluate this insurance conversation for IDD and GDPR compliance.',
      'Check: (1) needs identification before recommendation, (2) suitability assessment, (3) disclosure of role and insurer, (4) informed consent, (5) GDPR data consent.',
      'Respond with JSON only: { "passed": boolean, "gaps": string[], "suggestions": string[] }',
    ]

    if (input.workflowStepCode) {
      contextParts.push(`Current workflow step: ${input.workflowStepCode}`)
    }
    if (input.customerProfile) {
      contextParts.push(`Customer profile: ${JSON.stringify(input.customerProfile)}`)
    }

    const systemMessage: Message = {
      role: 'user',
      content: contextParts.join('\n'),
    }

    const messages: Message[] = [
      systemMessage,
      ...input.messages.slice(-10),
    ]

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
