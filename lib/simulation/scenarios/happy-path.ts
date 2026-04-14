import type { ScriptedScenario } from '../types'

const happyPath: ScriptedScenario = {
  slug: 'happy-path',
  name: 'Happy Path — Full Purchase',
  personaSlug: 'quick-buyer',
  steps: [
    { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Buna, vreau o asigurare de viata pentru familie. Am 33 de ani, casatorita, 2 copii.' } },
    { trigger: { type: 'contains', text: 'Protect' }, response: { type: 'message', text: 'Da, sunt interesata. Ce trebuie sa fac?' } },
    { trigger: { type: 'contains', text: 'boli grave' }, response: { type: 'message', text: 'Da, ma intereseaza si clauza pentru boli grave.' } },
  ],
}

export default happyPath
