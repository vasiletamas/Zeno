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
  /**
   * Task 4.2 (D7): how the channel challenge is completed. 'link' (default)
   * = the world hook clicks the REAL /api/auth/verify route; 'typed' = the
   * hook is disabled and the persona types the code from the mock-email
   * seam — the AGENT must call confirm_channel_verification with it.
   */
  verification?: 'link' | 'typed'
  /**
   * Task 2.2 (D1): 'cards' makes the persona TAP the DNT question cards
   * (synthetic gui-actor write_dnt_answer with the card's exact code+value)
   * instead of typing answers for the agent to transcribe.
   */
  dnt?: 'cards'
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
    // Task 2.2 (D1): the headline DNT-card flow — every answer lands via a
    // card tap (gui actor), the agent narrates without enumerating options.
    key: 'dnt-card-flow',
    opening: ['buna', 'vreau o asigurare de viata', 'da, hai sa facem cererea'],
    answerPolicy: 'valid',
    maxTurns: 45,
    asserts: ['noNarrationViolations', 'noDntOptionEnumeration'],
    dnt: 'cards',
  },
  {
    // Task 2.3 (D1): typed-fallback parity — same flow as dnt-card-flow but
    // the persona TYPES every answer (flaky-UI customer); the agent
    // transcribes to exact option values and the signed facts must be
    // identical to the card path's.
    key: 'dnt-typed-flow',
    opening: ['buna', 'vreau o asigurare de viata', 'da, hai sa facem cererea'],
    answerPolicy: 'valid',
    maxTurns: 45,
    asserts: ['noNarrationViolations', 'noDntOptionEnumeration'],
  },
  {
    // Task 4.2 (D7): the recorded-conversation shape — quote issued, code
    // sent, customer TYPES the digits; the agent must confirm them (D5's
    // engine fix) instead of re-sending. No link-click world hook.
    key: 'verification-typed-code',
    opening: [
      'buna',
      'vreau o asigurare de viata',
      // neutral interest: the foreign-treatment opener makes the agent
      // upsell the addon post-quote, detouring the run into the legal
      // cancel-and-rebuild path — this scenario is about VERIFICATION.
      'vreau sa imi protejez familia daca mi se intampla ceva',
      'standard nivelul 1 cred ca e cel mai potrivit',
      'da, hai sa facem cererea',
    ],
    answerPolicy: 'valid',
    maxTurns: 100,
    // noPremiumBeforeQuote deliberately absent: stating labeled EXAMPLE
    // premiums from pricing_examples pre-quote is prompt-legal, and this
    // scenario's job is the VERIFICATION path, not pricing hygiene.
    asserts: ['noNarrationViolations', 'noPhaseRegression'],
    fullFunnel: true,
    verification: 'typed',
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
