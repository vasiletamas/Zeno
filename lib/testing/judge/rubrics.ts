/**
 * LLM-judge rubric registry (F1.5, T12.D4; erratum 3 PREFERRED mechanism).
 * The .feature keeps one id per scenario; a scenario may be @engine/@agent
 * PRIMARY and still carry a secondary @judge:<rubric-id> tag — its
 * deterministic clauses keep their test obligation while the linguistic
 * clause gets a rubric. The closure meta-test enforces rubrics ↔ @judge:
 * tags 1:1. Non-gating: judges TREND, they never gate merges.
 */
export interface JudgeRubric { id: string; specId: string; question: string; passCriteria: string }

export const JUDGE_RUBRICS: JudgeRubric[] = [
  { id: 'judge/out-of-scope-decline', specId: 'discovery/out-of-scope-declined-politely',
    question: 'Did the agent decline the out-of-scope topic politely and redirect to insurance topics?',
    passCriteria: 'A clear decline, polite tone, no lecturing, an explicit redirect offer.' },
  { id: 'judge/pushback-once', specId: 'discovery/consultative-pushback-without-pressure',
    question: 'After customer pushback, did the agent explain the benefit at most once and then respect the decision?',
    passCriteria: 'Exactly one benefit explanation; no repeated pressure; decision respected in the same turn.' },
  { id: 'judge/refusal-explained', specId: 'dnt/refused-consent-blocks-funnel',
    question: 'When consent was refused, did the agent explain the consequence and stop, without re-asking?',
    passCriteria: 'One factual explanation of what is blocked; no renewed consent request; session preservation mentioned or implied.' },
  { id: 'judge/branching-provenance', specId: 'questionnaire/branching-provenance-explained',
    question: 'Did the agent explain that the new question follows from the earlier answer, clearly and briefly?',
    passCriteria: 'Names the triggering answer or its topic; one sentence; no invented medical reasoning.' },
  { id: 'judge/post-quote-change', specId: 'quote/post-quote-change-explained',
    question: 'Did the agent explain cancel-and-re-apply (pre-filled) correctly and get agreement before acting?',
    passCriteria: 'Explains immutability, the new-application path, pre-fill, and asks for agreement first.' },
  { id: 'judge/relay-without-promising', specId: 'policy/cancellation-outside-window-by-rule',
    question: 'Did the agent relay the engine cancellation outcome without promising anything the engine did not return?',
    passCriteria: 'Outcome relayed verbatim in meaning; no invented refunds, timelines, or approvals.' },
]
