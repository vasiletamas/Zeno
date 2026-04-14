import type { ScriptedScenario } from '../types'

const abandonMidQuestionnaire: ScriptedScenario = {
  slug: 'abandon-mid-questionnaire',
  name: 'Abandon Mid-Questionnaire',
  personaSlug: 'abandoner',
  steps: [
    { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Salut, vreau sa vad ce asigurari aveti. Am 27 de ani.' } },
    { trigger: { type: 'contains', text: 'intreb' }, response: { type: 'message', text: 'OK dar nu dureaza mult, nu?' } },
    { trigger: { type: 'turn', number: 6 }, response: { type: 'message', text: 'Stai, trebuie sa plec. Revin mai tarziu.' } },
    { trigger: { type: 'turn', number: 7 }, response: { type: 'abandon' } },
  ],
}

export default abandonMidQuestionnaire
