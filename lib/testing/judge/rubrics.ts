/**
 * LLM-judge rubric registry (F1.5, T12.D4). One rubric per @agent-judge
 * scenario — the closure meta-test enforces 1:1. Non-gating: judges TREND,
 * they never gate merges.
 *
 * The delivered 2026-07-03 spec tags exactly TWO scenarios @agent-judge
 * (the owner reclassified the plan's other four candidates to @agent or
 * @backlog), so the registry carries exactly those two.
 */
export interface JudgeRubric { id: string; specId: string; question: string; passCriteria: string }

export const JUDGE_RUBRICS: JudgeRubric[] = [
  { id: 'judge/out-of-scope-decline', specId: 'discovery/out-of-scope-declined-politely',
    question: 'Did the agent decline the out-of-scope topic politely and redirect to insurance topics?',
    passCriteria: 'A clear decline, polite tone, no lecturing, an explicit redirect offer.' },
  { id: 'judge/pushback-once', specId: 'discovery/consultative-pushback-without-pressure',
    question: 'After customer pushback, did the agent explain the benefit at most once and then respect the decision?',
    passCriteria: 'Exactly one benefit explanation; no repeated pressure; decision respected in the same turn.' },
]
