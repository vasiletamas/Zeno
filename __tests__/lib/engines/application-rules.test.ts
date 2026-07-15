import { it, expect } from 'vitest'
import { canTransition, applicationExposure } from '@/lib/engines/application-rules'

it('status machine: COMPLETED and CANCELLED are terminal; cancel ≠ complete', () => {
  expect(canTransition('OPEN', 'CANCELLED')).toBe(true)
  expect(canTransition('OPEN', 'COMPLETED')).toBe(true) // only generate_quote drives this in practice
  expect(canTransition('COMPLETED', 'OPEN')).toBe(false) // modify_quote reopen structurally impossible (T5.D6)
  expect(canTransition('CANCELLED', 'OPEN')).toBe(false)
  expect(canTransition('REFERRED', 'OPEN')).toBe(true) // underwriter approval re-entry (M5)
})

it('questionnaire is exposed only under a valid covering DNT (T5.D1 ordering flip, engine-enforced)', () => {
  const base = { application: { exists: true, status: 'OPEN' as const, tier: null, level: null, addon: null, answersComplete: false, hasAnswers: false }, dntValidForProduct: false }
  const noDnt = applicationExposure(base)
  expect(noDnt.blocked.find(b => b.action === 'write_question_answer')).toMatchObject({ reason: 'requires_consent' })
  expect(applicationExposure({ ...base, dntValidForProduct: true }).available).toContain('write_question_answer')
})

it('selection incompleteness is a generate_quote blocked-reason, NOT a subphase (#10)', () => {
  const s = applicationExposure({ application: { exists: true, status: 'OPEN', tier: 'standard', level: null, addon: false, answersComplete: true, hasAnswers: true }, dntValidForProduct: true })
  expect(s.available).toContain('select_coverage')
  expect(s.blocked.find(b => b.action === 'generate_quote')).toMatchObject({ reason: 'selection_incomplete', params: { missing: ['level'] } })
})

it('complete answers + full selection expose generate_quote; PAUSED exposes resume only', () => {
  const done = applicationExposure({ application: { exists: true, status: 'OPEN', tier: 'standard', level: 'level_1', addon: false, answersComplete: true, hasAnswers: true }, dntValidForProduct: true })
  expect(done.available).toContain('generate_quote')
  const paused = applicationExposure({ application: { exists: true, status: 'PAUSED', tier: null, level: null, addon: null, answersComplete: false, hasAnswers: false }, dntValidForProduct: true })
  expect(paused.available).toContain('resume_application')
  expect(paused.available).not.toContain('select_coverage')
})

it('modify_answer is exposed on OPEN and PAUSED apps with answers, behind the DNT gate (C1.5, erratum 10)', () => {
  const open = applicationExposure({ application: { exists: true, status: 'OPEN', tier: null, level: null, addon: null, answersComplete: false, hasAnswers: true }, dntValidForProduct: true })
  expect(open.available).toContain('modify_answer')
  // PAUSED: correcting the escalated answer is exactly what un-pauses
  const paused = applicationExposure({ application: { exists: true, status: 'PAUSED', tier: null, level: null, addon: null, answersComplete: false, hasAnswers: true }, dntValidForProduct: true })
  expect(paused.available).toContain('modify_answer')
  // nothing answered yet → nothing to modify
  const fresh = applicationExposure({ application: { exists: true, status: 'OPEN', tier: null, level: null, addon: null, answersComplete: false, hasAnswers: false }, dntValidForProduct: true })
  expect(fresh.available).not.toContain('modify_answer')
  // the T5.D1 DNT gate covers corrections too
  const noDnt = applicationExposure({ application: { exists: true, status: 'OPEN', tier: null, level: null, addon: null, answersComplete: false, hasAnswers: true }, dntValidForProduct: false })
  expect(noDnt.blocked.find(b => b.action === 'modify_answer')).toMatchObject({ reason: 'requires_consent' })
})
