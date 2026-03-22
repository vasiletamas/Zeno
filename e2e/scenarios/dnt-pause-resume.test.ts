/**
 * E2E Scenario: DNT Pause/Resume
 *
 * Tests that a customer can pause mid-DNT questionnaire and resume later
 * in the same conversation without losing progress or creating duplicate answers.
 *
 * Config: pauseAtTurn 8 triggers the simulator to say "Trebuie sa plec".
 * After a 2-second wait, we send "Am revenit" and verify the flow continues.
 */

import { describe, test, expect } from 'vitest'
import { createTestConversation, sendMessageAndParse } from '../lib/sse-parser'
import { generateCustomerResponse } from '../lib/client-simulator'
import { createConfig } from '../lib/personas'
import { TurnTracker } from '../lib/turn-tracker'
import { verifyDntPauseResume } from '../lib/db-verifier'
import { reportScenario } from '../lib/test-reporter'

describe('E2E: DNT Pause/Resume', () => {
  test('pause mid-DNT and resume without losing answers', async () => {
    const config = createConfig({
      pauseAtTurn: 8,
    })
    const baseUrl = process.env.APP_URL || 'http://localhost:3001'
    const { conversationId, customerId } = await createTestConversation(baseUrl)
    const tracker = new TurnTracker()
    const history: { role: string; content: string }[] = []
    let turnNumber = 0
    let paused = false

    // Send opening message
    let customerMessage = 'Buna, ma intereseaza o asigurare de viata pentru familia mea'

    for (let i = 0; i < 50; i++) {
      turnNumber++
      history.push({ role: 'user', content: customerMessage })

      const startTime = Date.now()
      const parsed = await sendMessageAndParse(conversationId, customerId, customerMessage, baseUrl)
      const durationMs = Date.now() - startTime

      tracker.addTurn({
        turnNumber,
        role: 'assistant',
        content: parsed.content,
        toolsCalled: parsed.toolsCalled,
        uiActionTypes: parsed.uiActions.map((a) => a.type),
        durationMs,
      })

      if (parsed.errors.length > 0) {
        tracker.addError(parsed.errors.join('; '))
      }

      history.push({ role: 'assistant', content: parsed.content })

      // Check if we've reached the end
      const hasPaymentSuccess = parsed.uiActions.some((a) => a.type === 'show_payment_success')
      const hasPolicyIssued = parsed.uiActions.some((a) => a.type === 'show_policy_issued')
      if (hasPaymentSuccess || hasPolicyIssued) break

      // Get last ui_action for simulator
      const lastUiAction =
        parsed.uiActions.length > 0 ? parsed.uiActions[parsed.uiActions.length - 1] : null

      // Generate customer response
      customerMessage = await generateCustomerResponse(
        parsed.content,
        lastUiAction,
        config,
        turnNumber,
        history,
      )

      // If simulator returned the pause message, handle the pause/resume
      if (customerMessage === 'Trebuie sa plec, revin mai tarziu' && !paused) {
        paused = true

        // Send the pause message
        turnNumber++
        history.push({ role: 'user', content: customerMessage })
        const pauseStart = Date.now()
        const pauseParsed = await sendMessageAndParse(
          conversationId,
          customerId,
          customerMessage,
          baseUrl,
        )
        const pauseDuration = Date.now() - pauseStart

        tracker.addTurn({
          turnNumber,
          role: 'assistant',
          content: pauseParsed.content,
          toolsCalled: pauseParsed.toolsCalled,
          uiActionTypes: pauseParsed.uiActions.map((a) => a.type),
          durationMs: pauseDuration,
        })

        history.push({ role: 'assistant', content: pauseParsed.content })

        // Wait 2 seconds to simulate the customer being away
        await new Promise((r) => setTimeout(r, 2000))

        // Resume the conversation
        customerMessage = 'Am revenit, hai sa continuam'
        continue
      }

      if (!customerMessage) break // simulator returns empty = done
    }

    // Verify conversation flow
    tracker.assertNoErrors()
    tracker.assertTurnCount(10, 50)

    // Verify DB state — all DNT answers saved, no duplicates
    const result = await verifyDntPauseResume(conversationId)
    reportScenario('DNT Pause/Resume', tracker, result.passed)

    expect(result.passed).toBe(true)
    for (const check of result.checks) {
      expect(
        check.passed,
        `${check.name}: expected ${JSON.stringify(check.expected)}, got ${JSON.stringify(check.actual)}`,
      ).toBe(true)
    }
  })
})
