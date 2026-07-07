/**
 * Scripted live-sim scenario table (F1.9, T12.D4). Each scenario drives
 * handleChatTurn with a fixed opening, then a question-aware answer policy;
 * the recorded ConversationExport is the assertion substrate.
 */
export interface SpecSimScenario {
  key: string
  opening: string[]                        // fixed opening script to convergence
  answerPolicy: 'valid' | 'refuse-consent' // pickAnswer strategy after convergence
  maxTurns: number
  asserts: string[]                        // names of assertion-fn checks run on the export
  /** F5.5: run the world hooks (email click, GUI doc upload, provider
   * settlement) between turns and the discovery->policy DB checks after. */
  fullFunnel?: boolean
  /** P2-14: default true. false = the scripted customer does NOT click
   * confirm cards (a refusing customer never taps "Semnează" — the harness
   * auto-click was signing the DNT the customer had just refused). */
  replayConfirms?: boolean
}

export const SPEC_SIM_SCENARIOS: SpecSimScenario[] = [
  {
    key: 'happy-path',
    opening: [
      'buna',
      'vreau o asigurare de viata',
      'cel mai mult ma intereseaza accesul la tratament in strainatate',
      // run cmr99s5cb: without the explicit addon election the agent quoted
      // base-only, then cancelled the quote to fix the mismatch (QUOTE ->
      // DISCOVERY regression). The customer says it up front.
      'standard nivelul 1, si vreau inclusa si optiunea de tratament in strainatate',
      'da, hai sa facem cererea',
    ],
    answerPolicy: 'valid',
    maxTurns: 100,
    asserts: ['noNarrationViolations', 'noPhaseRegression', 'noPremiumBeforeQuote', 'dntOrder', 'noCardData'],
    fullFunnel: true,
  },
  {
    key: 'dnt-refusal',
    opening: ['buna', 'vreau o asigurare de viata', 'da, hai sa facem cererea'],
    answerPolicy: 'refuse-consent',
    // P2-14: 20 turns hit the cap BEFORE the signing ask — the scenario
    // "passed" without ever emitting the refusal (vacuous). The goal is now
    // a pass criterion, and the budget covers the full DNT walk.
    maxTurns: 40,
    asserts: ['noNarrationViolations', 'noFunnelAfterRefusal'],
    replayConfirms: false,
  },
  {
    key: 'quote-decline',
    opening: ['buna', 'vreau o asigurare de viata', 'da, hai sa facem cererea'],
    answerPolicy: 'valid',
    maxTurns: 60,
    asserts: ['noNarrationViolations', 'noPhaseRegression'],
  },
]
