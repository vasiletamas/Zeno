/**
 * T11 clause 6: the medical review card's Sign action — NO checkboxes (the
 * consents were captured at DNT; the click IS the affirmation), and the
 * posted payload adapts to a tokenless sign_medical_declarations call.
 * gui-actor commits are confirmed by construction, so one click applies.
 */
import { describe, it, expect } from 'vitest'
import { buildSignMedicalAction } from '@/components/chat/rich/medical-review-card'
import { adaptAction } from '@/lib/chat/action-adapter'

describe('buildSignMedicalAction (pure card logic)', () => {
  it('posts sign_medical_declarations with an EMPTY payload — the click is the only affirmation', () => {
    expect(buildSignMedicalAction()).toEqual({ type: 'sign_medical_declarations', payload: {} })
  })

  it('round-trips through adaptAction to a tokenless sign_medical_declarations call (one gui click applies)', () => {
    const call = adaptAction(buildSignMedicalAction())
    expect(call).toMatchObject({ name: 'sign_medical_declarations', arguments: {} })
    expect(call!.arguments).not.toHaveProperty('confirmToken')
  })
})
