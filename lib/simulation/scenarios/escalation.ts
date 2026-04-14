import type { ScriptedScenario } from '../types'

const escalation: ScriptedScenario = {
  slug: 'escalation',
  name: 'Escalation — Request Human Agent',
  personaSlug: 'confused-customer',
  steps: [
    { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Buna ziua, am 55 de ani si vreau o asigurare dar nu ma pricep deloc la astea.' } },
    { trigger: { type: 'turn', number: 3 }, response: { type: 'message', text: 'Nu inteleg, puteti sa imi explicati mai simplu?' } },
    { trigger: { type: 'turn', number: 5 }, response: { type: 'message', text: 'Tot nu inteleg. Pot sa vorbesc cu cineva la telefon?' } },
    { trigger: { type: 'turn', number: 7 }, response: { type: 'message', text: 'Vreau sa vorbesc cu un om, va rog. Nu ma descurc online.' } },
  ],
}

export default escalation
