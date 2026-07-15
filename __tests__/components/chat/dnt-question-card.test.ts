import { describe, it, expect } from 'vitest'
import { adaptAction } from '@/lib/chat/action-adapter'
import { cnpChecksumHint } from '@/components/chat/rich/dnt-cnp-hint'

// Task 2.1 (D1): DNT questions render as cards — the tap posts the EXACT
// questionCode + option VALUE through the gui actor, killing the
// LLM-transcription fabrication class deterministically (same rationale as
// C1.9 for questionnaire cards).

describe('DNT card answer → gui-actor write_dnt_answer', () => {
  it('an option tap posts the exact questionCode + option value (never the label)', () => {
    const tc = adaptAction({
      type: 'answer_question',
      payload: { answer: 'employee', questionId: 'q1', questionCode: 'DNT_OCCUPATION', groupType: 'dnt' },
    })
    expect(tc?.name).toBe('write_dnt_answer')
    expect(tc?.arguments).toEqual({ questionCode: 'DNT_OCCUPATION', value: 'employee' })
  })

  it('a boolean tap posts the normalized value', () => {
    const tc = adaptAction({
      type: 'answer_question',
      payload: { answer: 'true', questionId: 'q2', questionCode: 'DNT_MINOR_CHILDREN', groupType: 'dnt' },
    })
    expect(tc?.arguments).toEqual({ questionCode: 'DNT_MINOR_CHILDREN', value: 'true' })
  })

  it('a multi-select posts comma-joined option values (validateAnswer splits on comma)', () => {
    const tc = adaptAction({
      type: 'answer_question',
      payload: { answer: ['salary', 'investments'], questionId: 'q3', questionCode: 'DNT_INCOME_SOURCE', groupType: 'dnt' },
    })
    expect(tc?.arguments).toEqual({ questionCode: 'DNT_INCOME_SOURCE', value: 'salary,investments' })
  })

  it('the answer_dnt legacy action shape maps identically', () => {
    const tc = adaptAction({ type: 'answer_dnt', payload: { questionCode: 'DNT_FAMILY_SIZE', value: '2' } })
    expect(tc?.name).toBe('write_dnt_answer')
    expect(tc?.arguments).toEqual({ questionCode: 'DNT_FAMILY_SIZE', value: '2' })
  })
})

describe('DNT_CNP client-side checksum hint (server stays the boundary)', () => {
  it('flags a checksum-invalid CNP with a hint', () => {
    expect(cnpChecksumHint('1960229410016', 'ro')).toMatch(/CNP/)
    expect(cnpChecksumHint('1234567890123', 'en')).toMatch(/CNP/)
  })
  it('accepts a checksum-valid CNP', () => {
    expect(cnpChecksumHint('1960229410015', 'ro')).toBeNull()
  })
  it('non-13-digit input gets the hint too', () => {
    expect(cnpChecksumHint('12345', 'ro')).toMatch(/13/)
  })
})
