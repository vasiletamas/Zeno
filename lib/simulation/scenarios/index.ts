import type { ScriptedScenario } from '../types'
import happyPath from './happy-path'
import bdClausePath from './bd-clause-path'
import priceObjectionConversion from './price-objection-conversion'
import abandonMidQuestionnaire from './abandon-mid-questionnaire'
import quoteModification from './quote-modification'
import escalation from './escalation'

export const ALL_SCENARIOS: ScriptedScenario[] = [
  happyPath,
  bdClausePath,
  priceObjectionConversion,
  abandonMidQuestionnaire,
  quoteModification,
  escalation,
]

const scenarioMap = new Map(ALL_SCENARIOS.map(s => [s.slug, s]))

export function getScenario(slug: string): ScriptedScenario | undefined {
  return scenarioMap.get(slug)
}
