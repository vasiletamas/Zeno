/**
 * E2E Scenario: Happy Path — Full Sale
 *
 * Tests the complete sales flow:
 * discovery -> DNT questionnaire -> application -> BD check -> quote -> payment -> policy
 *
 * Uses the default persona (Ion Popescu) with all default answers.
 * All BD medical answers are "false" so the addon is approved.
 */

import { describe, test, expect } from 'vitest'
import { createTestConversation, sendMessageAndParse } from '../lib/sse-parser'
import { generateCustomerResponse } from '../lib/client-simulator'
import { createConfig } from '../lib/personas'
import { TurnTracker } from '../lib/turn-tracker'
import { verifyHappyPath } from '../lib/db-verifier'
import { reportScenario } from '../lib/test-reporter'

describe('E2E: Happy Path', () => {
  test('full sale end-to-end', async () => {
    const config = createConfig()
    const baseUrl = process.env.APP_URL || 'http://localhost:3001'
    const { conversationId, customerId } = await createTestConversation(baseUrl)
    const tracker = new TurnTracker()
    const history: { role: string; content: string }[] = []
    let turnNumber = 0

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

      if (!customerMessage) break // simulator returns empty = done
    }

    // Verify conversation flow
    tracker.assertNoErrors()
    tracker.assertTurnCount(10, 50)

    // Verify DB state
    const result = await verifyHappyPath(conversationId)
    reportScenario('Happy Path — Full Sale', tracker, result.passed)

    expect(result.passed).toBe(true)
    for (const check of result.checks) {
      expect(
        check.passed,
        `${check.name}: expected ${JSON.stringify(check.expected)}, got ${JSON.stringify(check.actual)}`,
      ).toBe(true)
    }
  })
})
