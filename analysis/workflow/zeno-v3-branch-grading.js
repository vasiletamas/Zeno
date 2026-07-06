export const meta = {
  name: 'zeno-v3-branch-grading',
  description: 'Review and grade three model branches (Opus 4.8, Fable 5, Codex) that executed the same Zeno v3 plan',
  phases: [
    { title: 'Rubric', detail: 'extract per-package checklists from the 26-package plan' },
    { title: 'Adherence', detail: 'per branch x block: which packages were actually implemented' },
    { title: 'Quality', detail: 'architecture + test-suite quality per branch' },
    { title: 'Correctness', detail: 'bug hunt in core flows per branch' },
    { title: 'Verify', detail: 'adversarial refutation of major findings' },
    { title: 'HeadToHead', detail: 'side-by-side deep dives on pivotal packages' },
    { title: 'Hygiene', detail: 'commit history discipline' },
  ],
}

const WT = '/tmp/claude-0/-home-user-Zeno/e93e4b60-4cc8-5022-86c6-b497c69cc145/scratchpad/worktrees'
const MAIN = '/home/user/Zeno'
const PLAN = MAIN + '/docs/superpowers/plans/2026-06-12-zeno-v3-transformation-plan.md'
const BASE = '9a3d7255065371a043b392fc1bdbe186bfa93a33'

const BRANCHES = [
  { key: 'opus', model: 'Claude Opus 4.8', ref: 'origin/zeno-v3-opus', dir: WT + '/opus' },
  { key: 'fable', model: 'Claude Fable 5', ref: 'origin/zeno-v3-fable', dir: WT + '/fable' },
  { key: 'codex', model: 'OpenAI Codex', ref: 'origin/codex/zeno-v3-transformation-507b', dir: WT + '/codex' },
]

const BLOCKS = [
  { id: 'A', title: 'Architecture spine', pkgs: 'A1,A2,A3,A4,A5', start: 63, end: 2066 },
  { id: 'B', title: 'Customer foundation', pkgs: 'B0,B1,B2,B3,B4', start: 2067, end: 3848 },
  { id: 'C', title: 'Decision engines', pkgs: 'C1,C2,C3', start: 3849, end: 5648 },
  { id: 'D', title: 'Money & policy', pkgs: 'D1,D2,D3,D4', start: 5649, end: 7543 },
  { id: 'E', title: 'Content, operators, GDPR, re-engagement', pkgs: 'E1,E2,E3,E4', start: 7544, end: 9770 },
  { id: 'F', title: 'Verification & delivery', pkgs: 'F1,F2,F3,F4,F5', start: 9771, end: 11660 },
]

const CONTEXT = `CONTEXT: Zeno is a Next.js 15 + TypeScript + Prisma/Postgres insurance-sales chat application (LLM-driven funnel: discovery, DNT questionnaire, quotes, payment, policy). An experiment was run: three coding models (Claude Opus 4.8, Claude Fable 5, OpenAI Codex) each independently executed the SAME implementation plan (26 work packages, 199 TDD tasks, blocks A-F) starting from the SAME base commit ${BASE}.
The plan document is at: ${PLAN} (11660 lines).
Full checkouts of each result:
- Opus 4.8:  ${WT}/opus   (branch origin/zeno-v3-opus)
- Fable 5:   ${WT}/fable  (branch origin/zeno-v3-fable)
- Codex:     ${WT}/codex  (branch origin/codex/zeno-v3-transformation-507b)
The base-commit checkout (pre-transformation code) is at ${MAIN}.
RULES: You are STRICTLY READ-ONLY. Never edit/write files, never run npm/npx/vitest/prisma/node, never install anything. You may use Read/Grep/Glob and read-only git commands (git -C <dir> log/show/diff). Exclude node_modules from all searches. Background test processes may be running - ignore them.`

const RUBRIC_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    block: { type: 'string' },
    packages: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          deliverables: { type: 'array', items: { type: 'string' }, description: '5-12 concrete checkable deliverables: prisma models, named tools, named files/modules, invariants, required tests' },
          antiRequirements: { type: 'array', items: { type: 'string' }, description: 'things the plan says must be DELETED/retired' },
        },
        required: ['id', 'title', 'deliverables', 'antiRequirements'],
      },
    },
  },
  required: ['block', 'packages'],
}

const ADHERENCE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    branch: { type: 'string' },
    block: { type: 'string' },
    packages: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['complete', 'mostly-complete', 'partial', 'missing', 'divergent'] },
          evidence: { type: 'string', description: 'concrete file paths / model names / tool names found' },
          gaps: { type: 'string', description: 'what is missing or diverges from the plan; empty string if none' },
        },
        required: ['id', 'status', 'evidence', 'gaps'],
      },
    },
    blockScore0to10: { type: 'number' },
    notes: { type: 'string' },
  },
  required: ['branch', 'block', 'packages', 'blockScore0to10', 'notes'],
}

const QUALITY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    branch: { type: 'string' },
    dimension: { type: 'string' },
    score0to10: { type: 'number' },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    standoutObservations: { type: 'string' },
  },
  required: ['branch', 'dimension', 'score0to10', 'strengths', 'weaknesses', 'standoutObservations'],
}

const CORRECTNESS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    branch: { type: 'string' },
    score0to10: { type: 'number' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          detail: { type: 'string', description: 'concrete failure scenario: inputs/state -> wrong behavior' },
        },
        required: ['title', 'file', 'line', 'severity', 'detail'],
      },
    },
    overallAssessment: { type: 'string' },
  },
  required: ['branch', 'score0to10', 'findings', 'overallAssessment'],
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    refuted: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    explanation: { type: 'string' },
  },
  required: ['refuted', 'confidence', 'explanation'],
}

const H2H_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    topic: { type: 'string' },
    ranking: { type: 'array', items: { type: 'string' }, description: 'branch keys best-first: opus|fable|codex' },
    perBranch: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          branch: { type: 'string' },
          score0to10: { type: 'number' },
          assessment: { type: 'string' },
        },
        required: ['branch', 'score0to10', 'assessment'],
      },
    },
    rationale: { type: 'string' },
  },
  required: ['topic', 'ranking', 'perBranch', 'rationale'],
}

const HYGIENE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    perBranch: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          branch: { type: 'string' },
          score0to10: { type: 'number' },
          commitCount: { type: 'number' },
          assessment: { type: 'string' },
        },
        required: ['branch', 'score0to10', 'commitCount', 'assessment'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['perBranch', 'notes'],
}

// ---- Group 1: rubric -> adherence, pipelined per block ----
const adherenceWork = () => pipeline(
  BLOCKS,
  (block) => agent(
    `${CONTEXT}\n\nTASK: Build a grading rubric for BLOCK ${block.id} (${block.title}; packages ${block.pkgs}) of the plan.\nRead ${PLAN} lines ${block.start}-${block.end} (use Read with offset=${block.start} limit=2000, continue in chunks until line ${block.end}).\nFor EACH package in this block, distill: (a) 5-12 concrete, mechanically checkable deliverables (exact prisma model names, tool names, file/module names, invariants, key tests the plan demands - prefer things one can Grep for), and (b) anti-requirements: code/subsystems the plan orders DELETED or retired. Include binding errata and addendum tasks - they override the main task text. Be faithful to the plan, not to what you think is good design.`,
    { label: `rubric:${block.id}`, phase: 'Rubric', schema: RUBRIC_SCHEMA }
  ),
  (rubric, block) => parallel(BRANCHES.map((b) => () => agent(
    `${CONTEXT}\n\nTASK: Audit how completely the ${b.model} branch implemented BLOCK ${block.id} (${block.title}) of the plan.\nIts full checkout is at ${b.dir}. The pre-transformation base is at ${MAIN} for comparison.\nRUBRIC (extracted from the plan; treat as the checklist):\n${JSON.stringify(rubric, null, 1)}\n\nFor each package: Grep/Glob/Read in ${b.dir} for each deliverable (schema.prisma for models, lib/ + app/ for modules and tools, __tests__/ + e2e/ for tests) and check anti-requirements are actually gone (Grep for the retired names). Classify each package: complete / mostly-complete / partial / missing / divergent (implemented but materially different from plan). Cite concrete evidence paths. Score the block 0-10 for plan adherence x completeness. Be strict: a stub or a TODO is not complete; a deliverable only counts if wired in (imported/used), not just present as a file.`,
    { label: `adherence:${b.key}:${block.id}`, phase: 'Adherence', schema: ADHERENCE_SCHEMA }
  )))
)

// ---- Group 2: architecture + testing quality, 6 independent agents ----
const qualityWork = () => parallel(BRANCHES.flatMap((b) => [
  () => agent(
    `${CONTEXT}\n\nTASK: Grade ARCHITECTURE & CODE QUALITY of the ${b.model} branch at ${b.dir}. Judge the code this model wrote (diff vs base ${BASE} - use git -C ${MAIN} diff --stat ${BASE} ${b.ref} to scope, then read the actual files in ${b.dir}).\nAssess: (1) layering discipline - are decision rules pure modules with prisma-free cores as the plan demands, or tangled into handlers; (2) modularity, naming, file organization of new code in lib/ (engines, gateway, services, tools); (3) consistency of patterns across blocks; (4) error handling and type safety (any-casts, silent catches); (5) dead code / leftover legacy the plan ordered removed; (6) size discipline - are modules focused or god-files. Read at least: the commit gateway, deriveAndExpose/derive-phase engine, one decision engine (eligibility or suitability), the payment flip (accept quote/webhook inbox), and 2-3 tool handlers. Score 0-10. List concrete strengths/weaknesses with file paths.`,
    { label: `arch:${b.key}`, phase: 'Quality', schema: QUALITY_SCHEMA }
  ),
  () => agent(
    `${CONTEXT}\n\nTASK: Grade TEST SUITE QUALITY of the ${b.model} branch at ${b.dir}.\nAssess: (1) breadth - count test files (__tests__, e2e, playwright) and map them to funnel areas; (2) depth - open 6-10 test files across unit (pure rules: derive-phase, eligibility, consent reducer, confirm tokens), real-DB integration (gateway, commits), and the F1 BDD/gherkin traceability harness; judge whether assertions are meaningful (exact envelopes, invariants, edge cases: idempotent replay, concurrency, expiry) or vacuous (toBeDefined, snapshot-only, happy-path-only); (3) do tests test the plan's invariants (e.g. commit order #8, one-active-session constraint, consent halt) or just implementation echoes; (4) hermeticity - do unit tests avoid the network; is the real-DB ring properly separated; (5) any tests that are skipped/commented out to appear green. Score 0-10 with concrete examples (file paths).`,
    { label: `tests:${b.key}`, phase: 'Quality', schema: QUALITY_SCHEMA }
  ),
]))

// ---- Group 3: correctness bug-hunt per branch, then adversarial verify ----
const correctnessWork = () => pipeline(
  BRANCHES,
  (b) => agent(
    `${CONTEXT}\n\nTASK: BUG HUNT in the ${b.model} branch at ${b.dir}. Find real defects in the code this model wrote (not style). Hunt in the highest-risk areas the plan defines:\n(1) commit gateway: pinned operation order, advisory locking, idempotent replay returning the ORIGINAL envelope, conflicting-resubmit rejection, in-transaction ledger row;\n(2) deriveAndExpose / derivePhase: predicate table faithfulness, nextBestAction invariant, exposure re-derivation after each commit round;\n(3) confirm tokens: signing, state-fingerprint binding, materialArgsHash - can a stale/forged/cross-conversation token pass;\n(4) money paths: quote freeze-at-issue, expiry, accept-quote narrow flip, PaymentSchedule, webhook inbox (replay/out-of-order/duplicate events), free-look refunds;\n(5) consent: ConsentEvent as only storage, halt rule enforcement, withdraw paths;\n(6) concurrency/races: double-submit, parallel commits, TOCTOU between derive and execute;\n(7) security: GDPR export/erasure leaking other customers' data, identity claim-and-merge grabbing someone else's profile, magic-link binding.\nRead the actual implementation files deeply. Report each defect with file, line, severity (critical = money/data-loss/security/invariant-break; major = wrong behavior in realistic flows; minor = edge case), and a CONCRETE failure scenario (inputs/state -> wrong outcome). Only report defects you can trace through the code, not speculation. Score overall correctness 0-10.`,
    { label: `bugs:${b.key}`, phase: 'Correctness', schema: CORRECTNESS_SCHEMA }
  ),
  (review, b) => {
    if (!review) return null
    const serious = review.findings.filter((f) => f.severity !== 'minor').slice(0, 6)
    return parallel(serious.map((f) => () => {
      const n = f.severity === 'critical' ? 2 : 1
      return parallel(Array.from({ length: n }, (_, i) => () => agent(
        `${CONTEXT}\n\nTASK: Adversarially VERIFY a claimed defect in the ${b.model} branch at ${b.dir}. A reviewer claims:\nTITLE: ${f.title}\nFILE: ${f.file} (around line ${f.line})\nCLAIM: ${f.detail}\n\nYour job is to try to REFUTE it${i === 1 ? ' (independent second check - do not assume the first checker exists)' : ''}. Read the cited file AND its callers/callees and tests. The claim is refuted if: the scenario is impossible (guarded upstream), the cited behavior is actually correct per the plan (${PLAN}), a test proves the opposite, or the code path is dead. It is confirmed only if you can trace the failing scenario end-to-end through real code. If uncertain, refuted=false only when the trace genuinely holds; default to refuted=true when the claim does not survive scrutiny.`,
        { label: `verify:${b.key}:${f.title.slice(0, 30)}`, phase: 'Verify', schema: VERDICT_SCHEMA }
      ))).then((votes) => {
        const valid = votes.filter(Boolean)
        const confirmed = valid.length > 0 && valid.filter((v) => !v.refuted).length > valid.length / 2
        return { ...f, confirmed, votes: valid }
      })
    })).then((verified) => ({ branch: b.key, review, verified: verified.filter(Boolean) }))
  }
)

// ---- Group 4: head-to-head deep dives on pivotal packages ----
const H2H_TOPICS = [
  { key: 'spine', what: 'Package A1+A2: the pinned Phase vocabulary, DomainSnapshot loader, derivePhase predicate table, deriveAndExpose, and the commit gateway (pinned #8 order, CommitLedger, confirm tokens, idempotent replay). Plan lines 63-1432.' },
  { key: 'engines', what: 'Packages C1+C2: dependency graph + consequence planner/applier, and the canonical eligibility module (one rule source, three evaluation points). Plan lines 3849-5203.' },
  { key: 'money-flip', what: 'Package D2: the coupled flip - disclosures, narrow accept_quote, PaymentSchedule, webhook inbox, policy-at-first-payment, conversation terminality. Plan lines 6251-6887.' },
  { key: 'verification', what: 'Packages F1+F5: the BDD gherkin traceability harness, scenario translation, agent assertion layer, and final validation gauntlet. Plan lines 9783-10713 and 11535-11660.' },
]

const h2hWork = () => parallel(H2H_TOPICS.map((t) => () => agent(
  `${CONTEXT}\n\nTASK: HEAD-TO-HEAD comparison of how the three models implemented one pivotal area:\n${t.what}\nFirst skim the relevant plan section so you know what was asked. Then, for each of the three checkouts (${WT}/opus, ${WT}/fable, ${WT}/codex), locate and READ the core implementation + its tests. Compare on: fidelity to the plan's specific mechanics, correctness under adversarial inputs, clarity/simplicity of the design, and test strength. Rank the three branches best-first, score each 0-10, and justify with concrete file references. Judge the code, not the commit messages.`,
  { label: `h2h:${t.key}`, phase: 'HeadToHead', schema: H2H_SCHEMA }
)))

// ---- Group 5: git hygiene ----
const hygieneWork = () => agent(
  `${CONTEXT}\n\nTASK: Grade GIT/PROCESS HYGIENE of the three branches. In ${MAIN} run read-only git commands against refs origin/zeno-v3-opus (435 commits), origin/zeno-v3-fable (230 commits), origin/codex/zeno-v3-transformation-507b (205 commits), all vs base ${BASE}.\nExamine: git -C ${MAIN} log --oneline --reverse <ref> (sample beginning/middle/end), commit message quality (do they reference plan task IDs like A1.3/B2.5, do they explain WHY), commit granularity (atomic vs dump commits - check a few with git show --stat), TDD ordering evidence (test commits before/with implementation), honesty of final handoff commits (does the branch admit unfinished work - e.g. fable's last commit claims F5 partial/blocked on quota, codex claims F5 complete, opus ends with docs handoff - verify these claims roughly against what exists in each tree), and any force-push artifacts/reverts/churn. Score each branch 0-10.`,
  { label: 'hygiene', phase: 'Hygiene', schema: HYGIENE_SCHEMA }
)

log('Launching review fleet: rubric+adherence (24), quality (6), correctness+verify (3+refuters), head-to-head (4), hygiene (1)')

const [adherence, quality, correctness, headToHead, hygiene] = await parallel([
  adherenceWork,
  qualityWork,
  correctnessWork,
  h2hWork,
  hygieneWork,
])

return { adherence, quality, correctness, headToHead, hygiene }