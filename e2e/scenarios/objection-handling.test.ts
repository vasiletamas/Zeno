/**
 * E2E Scenario: Objection Handling
 *
 * Tests that the agent properly handles customer objections during the sales flow.
 * Three objections are injected at specific turn numbers:
 *   - Turn 4:  Price objection ("mi se pare cam scump")
 *   - Turn 12: Needs to think ("trebuie sa vorbesc cu sotia")
 *   - Turn 18: Trust issue ("nu prea am incredere in asigurari")
 *
 * Verifies that the agent calls get_objection_strategy for each and
 * the conversation continues to completion.
 */

import { describe, test, expect } from 'vitest'
import { createTestConversation, sendMessageAndParse } from '../lib/sse-parser'
import { generateCustomerResponse } from '../lib/client-simulator'
import { createConfig } from '../lib/personas'
import { TurnTracker } from '../lib/turn-tracker'
import { verifyObjectionHandling } from '../lib/db-verifier'
import { reportScenario } from '../lib/test-reporter'

describe('E2E: Objection Handling', () => {
  test('3 objection types triggered and handled', async () => {
    const config = createConfig({
      objections: [
        { turn: 4, text: 'Hmm, mi se pare cam scump tot ce imi spui...' },
        { turn: 12, text: 'Trebuie sa vorbesc cu sotia mea inainte sa decidem' },
        { turn: 18, text: 'Sincer, nu prea am incredere in companiile de asigurari...' },
      ],
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

    // Verify that get_objection_strategy was called
    tracker.assertToolCalled('get_objection_strategy')
    tracker.assertTurnCount(10, 50)

    // Verify DB state — at least 3 distinct objection types handled
    const result = await verifyObjectionHandling(conversationId, 3)
    reportScenario('Objection Handling', tracker, result.passed)

    expect(result.passed).toBe(true)
    for (const check of result.checks) {
      expect(
        check.passed,
        `${check.name}: expected ${JSON.stringify(check.expected)}, got ${JSON.stringify(check.actual)}`,
      ).toBe(true)
    }
  })
})
