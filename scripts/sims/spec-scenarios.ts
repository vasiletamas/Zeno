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
}

export const SPEC_SIM_SCENARIOS: SpecSimScenario[] = [
  {
    key: 'happy-path',
    opening: [
      'buna',
      'vreau o asigurare de viata',
      'cel mai mult ma intereseaza accesul la tratament in strainatate',
      'standard nivelul 1 cred ca e cel mai potrivit',
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
    maxTurns: 20,
    asserts: ['noNarrationViolations', 'noFunnelAfterRefusal'],
  },
  {
    key: 'quote-decline',
    opening: ['buna', 'vreau o asigurare de viata', 'da, hai sa facem cererea'],
    answerPolicy: 'valid',
    maxTurns: 60,
    asserts: ['noNarrationViolations', 'noPhaseRegression'],
  },
]
