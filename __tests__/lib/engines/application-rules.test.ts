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
  const base = { application: { exists: true, status: 'OPEN' as const, tier: null, level: null, addon: null, answersComplete: false }, dntValidForProduct: false }
  const noDnt = applicationExposure(base)
  expect(noDnt.blocked.find(b => b.action === 'save_application_answer')).toMatchObject({ reason: 'requires_consent' })
  expect(applicationExposure({ ...base, dntValidForProduct: true }).available).toContain('save_application_answer')
})

it('selection incompleteness is a generate_quote blocked-reason, NOT a subphase (#10)', () => {
  const s = applicationExposure({ application: { exists: true, status: 'OPEN', tier: 'standard', level: null, addon: false, answersComplete: true }, dntValidForProduct: true })
  expect(s.available).toContain('select_coverage')
  expect(s.blocked.find(b => b.action === 'generate_quote')).toMatchObject({ reason: 'selection_incomplete', params: { missing: ['level'] } })
})

it('complete answers + full selection expose generate_quote; PAUSED exposes resume only', () => {
  const done = applicationExposure({ application: { exists: true, status: 'OPEN', tier: 'standard', level: 'level_1', addon: false, answersComplete: true }, dntValidForProduct: true })
  expect(done.available).toContain('generate_quote')
  const paused = applicationExposure({ application: { exists: true, status: 'PAUSED', tier: null, level: null, addon: null, answersComplete: false }, dntValidForProduct: true })
  expect(paused.available).toContain('resume_application')
  expect(paused.available).not.toContain('select_coverage')
})
