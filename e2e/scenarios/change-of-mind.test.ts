/**
 * E2E Scenario: Change of Mind
 *
 * Tests the flow where a customer initially selects Optim Level 3 (most expensive),
 * sees the quote, decides it's too expensive, and changes to Standard Level 1 (cheaper).
 *
 * Verifies: two quotes exist (first EXPIRED, second ACCEPTED with different premium).
 */

import { describe, test, expect } from 'vitest'
import { createTestConversation, sendMessageAndParse } from '../lib/sse-parser'
import { generateCustomerResponse } from '../lib/client-simulator'
import { createConfig } from '../lib/personas'
import { TurnTracker } from '../lib/turn-tracker'
import { verifyChangeOfMind } from '../lib/db-verifier'
import { reportScenario } from '../lib/test-reporter'

describe('E2E: Change of Mind', () => {
  test('customer changes tier after seeing first quote', async () => {
    const config = createConfig({
      answersMap: {
        PACKAGE_CHOICE: 'optim',
        PREMIUM_LEVEL: 'level_3',
      },
      changeOfMind: {
        afterQuote: true,
        newTier: 'standard',
        newLevel: 'level_1',
      },
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

    // Verify DB state — two quotes with different premiums
    const result = await verifyChangeOfMind(conversationId)
    reportScenario('Change of Mind', tracker, result.passed)

    expect(result.passed).toBe(true)
    for (const check of result.checks) {
      expect(
        check.passed,
        `${check.name}: expected ${JSON.stringify(check.expected)}, got ${JSON.stringify(check.actual)}`,
      ).toBe(true)
    }
  })
})
