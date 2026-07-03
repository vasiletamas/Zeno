/**
 * Branching provenance (C1.7, T13.D1): the structured branching_metadata a
 * next-question payload carries so the agent can explain WHY a question
 * appeared — which edge fired, on which gate value — without paraphrasing
 * from memory. Pure over the typed dependency graph.
 */
import { edgeSatisfied, nodeValue, type DependencyEdge, type EdgePredicate, type GraphFacts, type NodeKey } from './dependency-graph'

export interface BranchingMetadata {
  triggeredBy: {
    nodeKey: NodeKey
    questionCode?: string                     // when the gate is an answer node
    questionText?: { en: string; ro: string } // localized gate text — agent must not paraphrase from memory
    matchedValue: string
    kind: 'VISIBILITY' | 'ELIGIBILITY'
    predicate: EdgePredicate
  }[]
  addedByLastCommit: boolean
  groupCode: string
  groupName: { en: string; ro: string }
}

export function buildBranchingMetadata(args: {
  graph: DependencyEdge[]
  questionCode: string
  facts: GraphFacts
  questionTexts: Record<string, { en: string; ro: string }>
  lastCommitQuestionsAdded: string[]
  groupCode: string
  groupName: { en: string; ro: string }
}): BranchingMetadata {
  const subject: NodeKey = `answer:${args.questionCode}`
  const triggeredBy = args.graph
    .filter(e => e.subjectKey === subject && (e.kind === 'VISIBILITY' || e.kind === 'ELIGIBILITY') && edgeSatisfied(e, args.facts))
    .map(e => {
      const gateCode = e.dependsOnKey.startsWith('answer:') ? e.dependsOnKey.slice('answer:'.length) : undefined
      return {
        nodeKey: e.dependsOnKey,
        questionCode: gateCode,
        questionText: gateCode ? args.questionTexts[gateCode] : undefined,
        matchedValue: nodeValue(e.dependsOnKey, args.facts) ?? '',
        kind: e.kind as 'VISIBILITY' | 'ELIGIBILITY',
        predicate: e.predicate,
      }
    })
  return {
    triggeredBy,
    addedByLastCommit: args.lastCommitQuestionsAdded.includes(args.questionCode),
    groupCode: args.groupCode,
    groupName: args.groupName,
  }
}
