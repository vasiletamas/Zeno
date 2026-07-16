/**
 * T10 clause 3: the medical batch card's actions — the primary button posts
 * ALL SIX No ("Niciuna dintre acestea nu mi se aplică"), the toggles post the
 * mixed exceptions, and both adapt to ONE tokenless gui write_medical_batch
 * call (gui-actor commits are confirmed by construction).
 */
import { describe, it, expect } from 'vitest'
import { buildMedicalBatchAction } from '@/components/chat/rich/medical-batch-card'
import { adaptAction } from '@/lib/chat/action-adapter'

const CONDITIONS = [
  { code: 'BD_CANCER_HISTORY', question: { en: 'a', ro: 'a' }, value: null },
  { code: 'BD_CARDIOVASCULAR', question: { en: 'b', ro: 'b' }, value: null },
  { code: 'BD_NEUROLOGICAL', question: { en: 'c', ro: 'c' }, value: null },
]

describe('buildMedicalBatchAction (pure card logic)', () => {
  it('no overrides → every condition posts "false" (the "none of these apply" primary)', () => {
    expect(buildMedicalBatchAction(CONDITIONS, {})).toEqual({
      type: 'medical_batch',
      payload: {
        answers: {
          BD_CANCER_HISTORY: 'false',
          BD_CARDIOVASCULAR: 'false',
          BD_NEUROLOGICAL: 'false',
        },
      },
    })
  })

  it('toggled exceptions post "true", the rest default "false" (Continuă with mixed values)', () => {
    const action = buildMedicalBatchAction(CONDITIONS, { BD_CARDIOVASCULAR: true })
    expect(action.payload.answers).toEqual({
      BD_CANCER_HISTORY: 'false',
      BD_CARDIOVASCULAR: 'true',
      BD_NEUROLOGICAL: 'false',
    })
  })

  it('round-trips through adaptAction to a tokenless write_medical_batch call (one gui click applies)', () => {
    const call = adaptAction(buildMedicalBatchAction(CONDITIONS, { BD_NEUROLOGICAL: true }))
    expect(call).toMatchObject({
      name: 'write_medical_batch',
      arguments: { answers: { BD_CANCER_HISTORY: 'false', BD_CARDIOVASCULAR: 'false', BD_NEUROLOGICAL: 'true' } },
    })
    expect(call!.arguments).not.toHaveProperty('confirmToken')
  })
})
