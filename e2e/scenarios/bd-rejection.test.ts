/**
 * E2E Scenario: BD Rejection
 *
 * Tests the flow when a customer has a medical condition (cancer history = true)
 * that causes the BD addon to be rejected. The sale should continue
 * with the base product only (no addon).
 */

import { describe, test, expect } from 'vitest'
import { createTestConversation, sendMessageAndParse } from '../lib/sse-parser'
import { generateCustomerResponse } from '../lib/client-simulator'
import { createConfig } from '../lib/personas'
import { TurnTracker } from '../lib/turn-tracker'
import { verifyBdRejection } from '../lib/db-verifier'
import { reportScenario } from '../lib/test-reporter'

describe('E2E: BD Rejection', () => {
  test('medical rejection leads to base-only sale', async () => {
    const config = createConfig({
      bdAnswers: { BD_CANCER_HISTORY: 'true' },
    })
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

      if (!customerMessage) break
    }

    // Verify conversation flow
    tracker.assertNoErrors()
    tracker.assertTurnCount(10, 50)

    // Verify DB state — BD rejection specific
    const result = await verifyBdRejection(conversationId)
    reportScenario('BD Rejection', tracker, result.passed)

    expect(result.passed).toBe(true)
    for (const check of result.checks) {
      expect(
        check.passed,
        `${check.name}: expected ${JSON.stringify(check.expected)}, got ${JSON.stringify(check.actual)}`,
      ).toBe(true)
    }
  })
})
