import { describe, it, expect } from 'vitest'
import { medicalAnswersHash, medicalDeclarationsExposure, medicalDeclarationsBlockQuote } from '@/lib/engines/medical-declarations'

describe('medicalAnswersHash — signature currency is recomputed, never cleared', () => {
  const refs = [
    { questionCode: 'BD_CANCER_HISTORY', revisionId: 'rev-1' },
    { questionCode: 'BD_TRANSPLANT', revisionId: 'rev-2' },
  ]
  it('is order-insensitive (canonical sort by question code)', () => {
    expect(medicalAnswersHash(refs)).toBe(medicalAnswersHash([...refs].reverse()))
  })
  it('changes when an answer gets a new revision (modify => unsigned again)', () => {
    const modified = [refs[0], { questionCode: 'BD_TRANSPLANT', revisionId: 'rev-3' }]
    expect(medicalAnswersHash(modified)).not.toBe(medicalAnswersHash(refs))
  })
  it('changes when the declaration set itself changes', () => {
    expect(medicalAnswersHash(refs.slice(0, 1))).not.toBe(medicalAnswersHash(refs))
  })
})

describe('medicalDeclarationsExposure — sign_medical_declarations legality', () => {
  it('no sensitive questions in the visible set: not exposed, no blocked reason', () => {
    expect(medicalDeclarationsExposure(undefined)).toEqual({ exposed: false, blockedReason: null })
    expect(medicalDeclarationsExposure({ requiredCodes: [], answeredCodes: [], signed: false })).toEqual({ exposed: false, blockedReason: null })
  })
  it('unanswered declarations: blocked medical_declarations_incomplete', () => {
    expect(medicalDeclarationsExposure({ requiredCodes: ['BD_CANCER_HISTORY', 'BD_TRANSPLANT'], answeredCodes: ['BD_CANCER_HISTORY'], signed: false }))
      .toEqual({ exposed: false, blockedReason: 'medical_declarations_incomplete' })
  })
  it('all answered, unsigned: exposed', () => {
    expect(medicalDeclarationsExposure({ requiredCodes: ['BD_CANCER_HISTORY'], answeredCodes: ['BD_CANCER_HISTORY'], signed: false }))
      .toEqual({ exposed: true, blockedReason: null })
  })
  it('already signed at the current revisions: blocked already_signed', () => {
    expect(medicalDeclarationsExposure({ requiredCodes: ['BD_CANCER_HISTORY'], answeredCodes: ['BD_CANCER_HISTORY'], signed: true }))
      .toEqual({ exposed: false, blockedReason: 'already_signed' })
  })
})

describe('medicalDeclarationsBlockQuote — the generate_quote gate', () => {
  it('blocks only when sensitive answers exist and are unsigned', () => {
    expect(medicalDeclarationsBlockQuote(undefined)).toBe(false)
    expect(medicalDeclarationsBlockQuote({ requiredCodes: [], answeredCodes: [], signed: false })).toBe(false)
    expect(medicalDeclarationsBlockQuote({ requiredCodes: ['BD_CANCER_HISTORY'], answeredCodes: ['BD_CANCER_HISTORY'], signed: false })).toBe(true)
    expect(medicalDeclarationsBlockQuote({ requiredCodes: ['BD_CANCER_HISTORY'], answeredCodes: ['BD_CANCER_HISTORY'], signed: true })).toBe(false)
  })
})
