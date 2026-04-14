import type { ScriptedScenario } from '../types'

const priceObjectionConversion: ScriptedScenario = {
  slug: 'price-objection-conversion',
  name: 'Price Objection → Conversion',
  personaSlug: 'price-objector',
  steps: [
    { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Buna, vreau sa vad cat costa o asigurare de viata. Am 37 de ani, profesoara, 1 copil.' } },
    { trigger: { type: 'contains', text: 'RON' }, response: { type: 'message', text: 'E cam scump... nu aveti ceva mai ieftin?' } },
    { trigger: { type: 'contains', text: 'nivel' }, response: { type: 'message', text: 'Hmm, tot mi se pare mult. Chiar merita?' } },
    { trigger: { type: 'contains', text: 'protectie' }, response: { type: 'message', text: 'OK, hai sa vedem varianta standard, nivelul 1. Cea mai ieftina.' } },
    { trigger: { type: 'ui_action', actionType: 'show_quote' }, response: { type: 'message', text: 'Bon, accept. Hai sa facem.' } },
  ],
}

export default priceObjectionConversion
