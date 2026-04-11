const CHARS_PER_TOKEN: Record<string, number> = {
  en: 4,
  ro: 3,
}

const DEFAULT_CHARS_PER_TOKEN = 4

export function estimateTokens(text: string, language: 'en' | 'ro' = 'en'): number {
  if (!text) return 0
  const charsPerToken = CHARS_PER_TOKEN[language] ?? DEFAULT_CHARS_PER_TOKEN
  return Math.ceil(text.length / charsPerToken)
}

export interface BudgetParams {
  modelContextWindow: number
  systemPromptTokens: number
  toolDefinitionTokens: number
  outputReservation: number
  safetyMargin?: number
}

export function calculateMessageBudget(params: BudgetParams): number {
  const margin = params.safetyMargin ?? 0.10
  const available =
    params.modelContextWindow -
    params.systemPromptTokens -
    params.toolDefinitionTokens -
    params.outputReservation

  if (available <= 0) return 0
  return Math.floor(available * (1 - margin))
}
