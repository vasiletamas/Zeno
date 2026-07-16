/**
 * T7 clause 6: the DNT review card's Sign action — both consents are
 * UNCHECKED checkboxes (GDPR requires affirmative action; pre-ticked is
 * void), the action exists only when BOTH are checked, and the posted
 * payload adapts to a sign_dnt tool call whose consent is MATERIAL. No
 * confirmToken rides the click: gui-actor commits are confirmed by
 * construction, so one click applies.
 */
import { describe, it, expect } from 'vitest'
import { buildSignDntAction } from '@/components/chat/rich/dnt-review-card'
import { adaptAction } from '@/lib/chat/action-adapter'

describe('buildSignDntAction (pure card logic)', () => {
  it('returns null unless BOTH consents are affirmatively given', () => {
    expect(buildSignDntAction(false, false)).toBeNull()
    expect(buildSignDntAction(true, false)).toBeNull()
    expect(buildSignDntAction(false, true)).toBeNull()
  })

  it('both consents → sign_dnt action with the consent object as material payload', () => {
    expect(buildSignDntAction(true, true)).toEqual({
      type: 'sign_dnt',
      payload: { consent: { gdpr: true, aiDisclosure: true } },
    })
  })

  it('round-trips through adaptAction to a tokenless sign_dnt call (one gui click applies)', () => {
    const action = buildSignDntAction(true, true)!
    const call = adaptAction(action)
    expect(call).toMatchObject({
      name: 'sign_dnt',
      arguments: { consent: { gdpr: true, aiDisclosure: true } },
    })
    expect(call!.arguments).not.toHaveProperty('confirmToken')
  })
})
