import type { ScriptedScenario } from '../types'

const quoteModification: ScriptedScenario = {
  slug: 'quote-modification',
  name: 'Quote Modification — Change Package',
  personaSlug: 'young-parent',
  steps: [
    { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Buna, sunt Maria, 32 de ani, 2 copii. Vreau o asigurare de viata.' } },
    { trigger: { type: 'contains', text: 'pachet' }, response: { type: 'message', text: 'Vreau sa vad pachetul Optim, nivelul 2.' } },
    { trigger: { type: 'ui_action', actionType: 'show_quote' }, response: { type: 'message', text: 'E prea scump, pot sa schimb la Standard nivel 1?' } },
  ],
}

export default quoteModification
