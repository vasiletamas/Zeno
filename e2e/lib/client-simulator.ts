/**
 * Client Simulator for E2E Tests
 *
 * Hybrid response generator: deterministic for questionnaire answers,
 * LLM-powered for free-form conversation. Uses the OpenAI SDK directly
 * (not our agent gateway) to generate natural Romanian customer responses.
 */

import OpenAI from 'openai'
import type { SimulatorConfig } from './personas'

// ==============================================
// LLM CLIENT (lazy singleton)
// ==============================================

let _openai: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI()
  }
  return _openai
}

// ==============================================
// HELPERS
// ==============================================

/**
 * Extract the question code from a show_question ui_action payload.
 * The code may be at payload.question.code, payload.code, or payload.questionCode.
 */
function extractQuestionCode(
  payload: Record<string, unknown>,
): string | null {
  // payload.question.code (nested)
  if (payload.question && typeof payload.question === 'object') {
    const q = payload.question as Record<string, unknown>
    if (typeof q.code === 'string') return q.code
  }
  // payload.code (flat)
  if (typeof payload.code === 'string') return payload.code
  // payload.questionCode
  if (typeof payload.questionCode === 'string') return payload.questionCode
  return null
}

/**
 * Build the persona system prompt for LLM calls.
 */
function buildPersonaPrompt(config: SimulatorConfig): string {
  const p = config.persona
  return [
    `Esti ${p.name}, ${p.occupation} roman de ${p.age} de ani, casatorit cu ${p.children} copii.`,
    `Venit: ${p.income}/luna. Vorbesti romana natural.`,
    `Raspunsurile tale sunt SCURTE (1-3 propozitii).`,
    `Esti interesat de o asigurare de viata pentru protectia familiei.`,
    `Nu inventezi informatii. Raspunzi natural la intrebarile agentului.`,
  ].join(' ')
}

// ==============================================
// MAIN FUNCTION
// ==============================================

/**
 * Generate a customer response given the agent's last message and UI action.
 *
 * Priority order:
 *  1. show_question       → deterministic from answersMap
 *  2. show_product_cards  → tier/level selection from config
 *  3. show_quote + changeOfMind → "E prea scump..."
 *  4. show_quote          → "Da, accept oferta"
 *  5. show_payment        → "Da, platesc" / "Simulez plata"
 *  6. show_payment_success / show_policy_issued → "" (stop signal)
 *  7. show_bd_result / show_bd_rejected → "Da, continua"
 *  8. Objection injection by turn number
 *  9. Pause at turn
 * 10. Default → LLM call
 */
export async function generateCustomerResponse(
  agentMessage: string,
  uiAction: { type: string; payload: Record<string, unknown> } | null,
  config: SimulatorConfig,
  turnNumber: number,
  conversationHistory: { role: string; content: string }[],
): Promise<string> {
  try {
    // ---- 1. show_question: deterministic answer lookup ----
    if (uiAction?.type === 'show_question') {
      const code = extractQuestionCode(uiAction.payload)
      if (code) {
        const answer = config.behavior.answersMap[code]
        if (answer !== undefined) {
          return answer
        }
      }
      // Code not in map — fall through to LLM
    }

    // ---- 2. show_product_cards: tier + level selection ----
    if (uiAction?.type === 'show_product_cards') {
      const tier = config.behavior.answersMap['PACKAGE_CHOICE'] ?? 'standard'
      const level = config.behavior.answersMap['PREMIUM_LEVEL'] ?? 'level_2'
      const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1)
      const levelLabel = level.replace('level_', 'Nivelul ')
      return `Vreau ${tierLabel} ${levelLabel}`
    }

    // ---- 3/4. show_quote ----
    if (uiAction?.type === 'show_quote') {
      if (config.behavior.changeOfMind?.afterQuote) {
        // First time seeing a quote with changeOfMind enabled — request change
        // Disable the flag so the second quote is accepted
        config.behavior.changeOfMind.afterQuote = false

        // Update the answers map with the new tier/level for subsequent questions
        if (config.behavior.changeOfMind.newTier) {
          config.behavior.answersMap['PACKAGE_CHOICE'] = config.behavior.changeOfMind.newTier
        }
        if (config.behavior.changeOfMind.newLevel) {
          config.behavior.answersMap['PREMIUM_LEVEL'] = config.behavior.changeOfMind.newLevel
        }

        return 'E prea scump, vreau varianta mai ieftina'
      }
      return 'Da, accept oferta'
    }

    // ---- 5. show_payment ----
    if (uiAction?.type === 'show_payment') {
      return 'Simulez plata'
    }

    // ---- 6. show_payment_success / show_policy_issued → stop ----
    if (
      uiAction?.type === 'show_payment_success' ||
      uiAction?.type === 'show_policy_issued'
    ) {
      return ''
    }

    // ---- 7. show_bd_result / show_bd_rejected ----
    if (
      uiAction?.type === 'show_bd_result' ||
      uiAction?.type === 'show_bd_rejected'
    ) {
      return 'Da, continua'
    }

    // ---- 8. Objection injection ----
    if (config.behavior.objections) {
      const objection = config.behavior.objections.find(
        (o) => o.turn === turnNumber,
      )
      if (objection) {
        return objection.text
      }
    }

    // ---- 9. Pause at turn ----
    if (config.behavior.pauseAtTurn === turnNumber) {
      return 'Trebuie sa plec, revin mai tarziu'
    }

    // ---- 10. Default: LLM call ----
    return await callLLM(agentMessage, config, conversationHistory)
  } catch (error) {
    // Simulator should never throw — return safe default
    console.warn('[client-simulator] Error generating response, returning default:', error)
    return 'Da'
  }
}

// ==============================================
// LLM CALL
// ==============================================

async function callLLM(
  agentMessage: string,
  config: SimulatorConfig,
  conversationHistory: { role: string; content: string }[],
): Promise<string> {
  const openai = getOpenAI()
  const personaPrompt = buildPersonaPrompt(config)

  // Use last 4 messages for context (keep costs low)
  const recentHistory = conversationHistory.slice(-4).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  const userPrompt = `Agentul de asigurari a spus: "${agentMessage.slice(0, 500)}". Raspunde scurt ca ${config.persona.name}.`

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // cheapest available, reliable fallback
      temperature: 0.7,
      max_tokens: 150,
      messages: [
        { role: 'system', content: personaPrompt },
        ...recentHistory,
        { role: 'user', content: userPrompt },
      ],
    })
    return response.choices[0]?.message?.content || 'Da'
  } catch (error) {
    console.warn('[client-simulator] LLM call failed, returning default:', error)
    return 'Da'
  }
}
