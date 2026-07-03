/**
 * Customer Simulation — Conversation Driver
 *
 * Drives a single simulated conversation end-to-end, supporting both
 * scripted scenarios and freeform LLM-generated responses.
 */

import OpenAI from 'openai'
import { prisma } from '@/lib/db'
import {
  createSimulationConversation,
  setSimulationChannel,
  sendSimulationMessage,
} from '@/lib/simulation/sse-client'
import type { Persona, ScriptedScenario, ScenarioStep, ConversationResult, ParsedTurn } from '@/lib/simulation/types'

// ==============================================
// CONSTANTS
// ==============================================

// D2.5 (M9): show_policy_issued died at accept — the policy is issued at
// first successful payment, so payment success IS the terminal surface.
const TERMINAL_UI_ACTIONS = new Set(['show_payment_success'])
const MAX_CONSECUTIVE_ERRORS = 3
const OPENING_MESSAGE = 'Buna ziua, sunt interesat de o asigurare de viata.'

// ==============================================
// PUBLIC INTERFACE
// ==============================================

export interface DriverOptions {
  persona: Persona
  scenario: ScriptedScenario | null  // null = freeform
  runId: string
  baseUrl: string
  answersMap: Record<string, string>
}

// ==============================================
// LLM FALLBACK — lazy singleton
// ==============================================

let openaiClient: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI()
  }
  return openaiClient
}

async function generateLLMResponse(
  persona: Persona,
  agentMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string> {
  try {
    const client = getOpenAI()
    const systemPrompt = `Esti ${persona.name}, un client roman de ${persona.age} ani, ${persona.occupation}.
Personalitate: ${persona.personality}
Motivatii: ${persona.motivations.join(', ')}
Obiectii posibile: ${persona.objectionTypes.join(', ') || 'niciuna'}
Raspunde scurt, natural, in romana. Max 2-3 propozitii.`

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-4),
      { role: 'user', content: `Agentul a spus: "${agentMessage}". Raspunde ca ${persona.name}.` },
    ]

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.8,
      max_tokens: 150,
      messages,
    })

    return completion.choices[0]?.message?.content ?? 'Da'
  } catch {
    return 'Da'
  }
}

// ==============================================
// SCRIPTED STEP MATCHING
// ==============================================

function findMatchingStep(
  scenario: ScriptedScenario,
  turnNumber: number,
  lastTurn: ParsedTurn | null,
  agentMessage: string,
): ScenarioStep | null {
  for (const step of scenario.steps) {
    const { trigger } = step
    if (trigger.type === 'turn' && trigger.number === turnNumber) {
      return step
    }
    if (trigger.type === 'ui_action' && lastTurn) {
      const matched = lastTurn.uiActions.some(a => a.type === trigger.actionType)
      if (matched) return step
    }
    if (trigger.type === 'contains') {
      if (agentMessage.toLowerCase().includes(trigger.text.toLowerCase())) {
        return step
      }
    }
  }
  return null
}

// ==============================================
// DETERMINISTIC ANSWER LOOKUP
// ==============================================

function extractQuestionCode(payload: Record<string, unknown>): string | null {
  // Check nested payload.question.code
  const question = payload.question as Record<string, unknown> | undefined
  if (question && typeof question.code === 'string') return question.code
  // Check flat payload.code
  if (typeof payload.code === 'string') return payload.code
  // Check payload.questionCode
  if (typeof payload.questionCode === 'string') return payload.questionCode
  return null
}

function getDeterministicResponse(
  uiActions: ParsedTurn['uiActions'],
  answersMap: Record<string, string>,
): string | null {
  for (const action of uiActions) {
    switch (action.type) {
      case 'show_question': {
        const code = extractQuestionCode(action.payload)
        if (code && answersMap[code]) return answersMap[code]
        if (code) return 'Da'
        return 'Da'
      }
      case 'show_product_cards':
        return 'Arata-mi mai multe detalii despre primul produs.'
      case 'show_quote':
        return 'Da, accept oferta.'
      case 'show_payment':
        return 'Simulez plata.'
      case 'show_bd_result':
      case 'show_bd_rejected':
        return 'Da, continua.'
    }
  }
  return null
}

// ==============================================
// MAIN DRIVER
// ==============================================

export async function driveConversation(options: DriverOptions): Promise<ConversationResult> {
  const { persona, scenario, runId, baseUrl, answersMap } = options
  const startTime = Date.now()

  const scenarioType = scenario ? 'scripted' : 'freeform'
  const scenarioSlug = scenario?.slug ?? null

  // Step 1+2: Create session and mark as simulation channel
  const { customerId, conversationId } = await createSimulationConversation(baseUrl)
  await setSimulationChannel(conversationId)

  // Step 3: Persist record
  await prisma.simulationConversation.create({
    data: {
      runId,
      conversationId,
      personaSlug: persona.slug,
      scenarioType,
      scenarioSlug,
      status: 'RUNNING',
    },
  })

  // Conversation state
  let turnCount = 0
  let consecutiveErrors = 0
  let lastTurn: ParsedTurn | null = null
  const llmHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
  let finalStatus: 'COMPLETED' | 'FAILED' | 'ABANDONED' = 'COMPLETED'
  let errorMessage: string | null = null

  try {
    // Step 4: Send opening message
    let agentMessage = OPENING_MESSAGE
    let customerMessage = OPENING_MESSAGE

    // The opening turn: we send the opening message and receive agent's first reply
    lastTurn = await sendSimulationMessage(conversationId, customerId, customerMessage, baseUrl)
    turnCount = 1

    // Track in LLM history
    llmHistory.push({ role: 'user', content: customerMessage })
    if (lastTurn.content) {
      llmHistory.push({ role: 'assistant', content: lastTurn.content })
    }

    // Handle errors on opening turn
    if (lastTurn.errors.length > 0) {
      consecutiveErrors++
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw new Error(lastTurn.errors.join('; '))
      }
      // Record as FAILED for single SSE errors
      finalStatus = 'FAILED'
      errorMessage = lastTurn.errors.join('; ')
      await prisma.simulationConversation.update({
        where: { conversationId },
        data: { status: 'FAILED', error: errorMessage, turnCount, durationMs: Date.now() - startTime },
      })
      return {
        conversationId,
        personaSlug: persona.slug,
        scenarioType,
        scenarioSlug,
        status: 'FAILED',
        turnCount,
        durationMs: Date.now() - startTime,
        error: errorMessage,
        lastTurn,
      }
    } else {
      consecutiveErrors = 0
    }

    // Check terminal actions on opening turn
    const hasTerminal = lastTurn.uiActions.some(a => TERMINAL_UI_ACTIONS.has(a.type))
    if (hasTerminal) {
      finalStatus = 'COMPLETED'
      // D2.1 (contradiction #11): sim completion lives on the Simulation*
      // entities only — Conversation is a channel, never a funnel record.
      await prisma.simulationConversation.update({
        where: { conversationId },
        data: { status: 'COMPLETED', turnCount, durationMs: Date.now() - startTime },
      })
      return {
        conversationId,
        personaSlug: persona.slug,
        scenarioType,
        scenarioSlug,
        status: 'COMPLETED',
        turnCount,
        durationMs: Date.now() - startTime,
        error: null,
        lastTurn,
      }
    }

    // Step 5: Main loop
    while (turnCount < persona.maxTurns) {
      agentMessage = lastTurn.content

      // Determine customer response
      let nextMessage: string

      if (scenario) {
        // Scripted mode: try to match a step
        const step = findMatchingStep(scenario, turnCount, lastTurn, agentMessage)

        if (step) {
          if (step.response.type === 'abandon') {
            // ABANDONED: update and return immediately
            finalStatus = 'ABANDONED'
            // D2.1: recorded on the Simulation* entities only (see above)
            await prisma.simulationConversation.update({
              where: { conversationId },
              data: { status: 'ABANDONED', turnCount, durationMs: Date.now() - startTime },
            })
            return {
              conversationId,
              personaSlug: persona.slug,
              scenarioType,
              scenarioSlug,
              status: 'ABANDONED',
              turnCount,
              durationMs: Date.now() - startTime,
              error: null,
              lastTurn,
            }
          } else if (step.response.type === 'message') {
            nextMessage = step.response.text
          } else {
            // action type: use deterministic or fallback
            const det = getDeterministicResponse(lastTurn.uiActions, answersMap)
            nextMessage = det ?? await generateLLMResponse(persona, agentMessage, llmHistory)
          }
        } else {
          // No scripted step matched — use deterministic or LLM fallback
          const det = getDeterministicResponse(lastTurn.uiActions, answersMap)
          nextMessage = det ?? await generateLLMResponse(persona, agentMessage, llmHistory)
        }
      } else {
        // Freeform mode: deterministic first, then LLM
        const det = getDeterministicResponse(lastTurn.uiActions, answersMap)
        nextMessage = det ?? await generateLLMResponse(persona, agentMessage, llmHistory)
      }

      // Send the customer's next message
      const turn = await sendSimulationMessage(conversationId, customerId, nextMessage, baseUrl)
      turnCount++

      // Track history
      llmHistory.push({ role: 'user', content: nextMessage })
      if (turn.content) {
        llmHistory.push({ role: 'assistant', content: turn.content })
      }

      // Handle errors
      if (turn.errors.length > 0) {
        consecutiveErrors++
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          throw new Error(`${MAX_CONSECUTIVE_ERRORS} consecutive errors: ${turn.errors.join('; ')}`)
        }
        // Single error: record as FAILED and exit
        finalStatus = 'FAILED'
        errorMessage = turn.errors.join('; ')
        lastTurn = turn
        break
      } else {
        consecutiveErrors = 0
      }

      lastTurn = turn

      // Update turn count in DB
      await prisma.simulationConversation.update({
        where: { conversationId },
        data: { turnCount },
      })

      // Check for terminal UI actions
      const terminal = turn.uiActions.some(a => TERMINAL_UI_ACTIONS.has(a.type))
      if (terminal) {
        finalStatus = 'COMPLETED'
        break
      }
    }
  } catch (err) {
    finalStatus = 'FAILED'
    errorMessage = err instanceof Error ? err.message : String(err)
  }

  // Step 6+7: Persist final status
  const durationMs = Date.now() - startTime
  await prisma.simulationConversation.update({
    where: { conversationId },
    data: {
      status: finalStatus,
      ...(errorMessage ? { error: errorMessage } : {}),
      turnCount,
      durationMs,
    },
  })

  // D2.1 (contradiction #11): the old Conversation.status bridge died —
  // outcomes live on SimulationConversation; the scorer reads them there.

  // Step 8: Return result
  return {
    conversationId,
    personaSlug: persona.slug,
    scenarioType,
    scenarioSlug,
    status: finalStatus,
    turnCount,
    durationMs,
    error: errorMessage,
    lastTurn,
  }
}
