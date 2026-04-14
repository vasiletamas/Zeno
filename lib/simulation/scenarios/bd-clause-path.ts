import type { ScriptedScenario } from '../types'

const bdClausePath: ScriptedScenario = {
  slug: 'bd-clause-path',
  name: 'BD Clause — Critical Illness Rider',
  personaSlug: 'professional',
  steps: [
    { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Buna ziua, sunt interesat de o asigurare completa cu protectie pentru boli grave. Am 42 de ani, director IT.' } },
    { trigger: { type: 'contains', text: 'Protect' }, response: { type: 'message', text: 'Vreau varianta cea mai completa, inclusiv BD. Care sunt acoperirile exacte?' } },
    { trigger: { type: 'contains', text: 'addon' }, response: { type: 'message', text: 'Da, vreau addon-ul pentru tratament medical in strainatate.' } },
    { trigger: { type: 'contains', text: 'intrebari medicale' }, response: { type: 'message', text: 'Sunt sanatos, nu am probleme medicale. Sa continuam.' } },
  ],
}

export default bdClausePath
