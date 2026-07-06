/**
 * P0-1 anti-fabrication grounding (pure). Every case is recorded evidence:
 * family-size "2" persisted after five bare "da" replies and life-subtype
 * "simple_protection" fabricated (production-readiness report P0 #1);
 * legitimate enum mapping "din salariu" -> salary_pension and the ratified
 * CONTEXT-HIT confirm-proposal flow must stay writable.
 */
import { describe, it, expect } from 'vitest'
import { isValueGrounded } from '@/lib/engines/anti-fabrication'

const SALARY_OPTIONS = [
  { value: 'salary_pension', label: { en: 'Salary / Pension', ro: 'Salariu / Pensie' } },
  { value: 'other_sources', label: { en: 'Other sources', ro: 'Alte surse' } },
]
const SUBTYPE_OPTIONS = [
  { value: 'simple_protection', label: { en: 'Simple protection', ro: 'Protecție simplă' } },
  { value: 'protection_investment', label: { en: 'Protection + investment', ro: 'Protecție și investiție' } },
]

describe('isValueGrounded — fabrication cases (must block)', () => {
  it('numeric value with no anchor: family "2" after five bare "da" (the original fabrication)', () => {
    const r = isValueGrounded({ value: '2', userMessages: ['da', 'da', 'da', 'da', 'da'], assistantMessages: ['Câți membri are familia ta?'] })
    expect(r.grounded).toBe(false)
  })
  it('enum token whose label words never appeared: simple_protection', () => {
    const r = isValueGrounded({
      value: 'simple_protection', options: SUBTYPE_OPTIONS,
      userMessages: ['da', 'vreau o asigurare de viata'], assistantMessages: ['Ce tip de protecție cauți?'],
    })
    expect(r.grounded).toBe(false)
  })
  it('free-text value invented outright (an email never uttered)', () => {
    const r = isValueGrounded({ value: 'client@example.com', userMessages: ['da', 'continuăm'], assistantMessages: [] })
    expect(r.grounded).toBe(false)
  })
  it('short numeric does not anchor inside a longer number ("2" vs "2000 RON")', () => {
    const r = isValueGrounded({ value: '2', userMessages: ['castig 2000 RON pe luna'], assistantMessages: [] })
    expect(r.grounded).toBe(false)
  })
})

describe('isValueGrounded — legitimate writes (must pass)', () => {
  it('direct mention: the customer typed the number', () => {
    expect(isValueGrounded({ value: '2', userMessages: ['suntem 2 in familie'], assistantMessages: [] })).toMatchObject({ grounded: true, basis: 'customer_words' })
  })
  it('Romanian number word: "doi" grounds "2"', () => {
    expect(isValueGrounded({ value: '2', userMessages: ['suntem doi'], assistantMessages: [] })).toMatchObject({ grounded: true, basis: 'customer_words' })
  })
  it('enum mapping via option label words: "din salariu" grounds salary_pension', () => {
    expect(isValueGrounded({
      value: 'salary_pension', options: SALARY_OPTIONS,
      userMessages: ['din salariu'], assistantMessages: [],
    })).toMatchObject({ grounded: true, basis: 'option_label' })
  })
  it('enum mapping via the value token itself: "employee" inside the reply', () => {
    expect(isValueGrounded({
      value: 'employee', options: [{ value: 'employee', label: { en: 'Employee', ro: 'Angajat' } }],
      userMessages: ['sunt angajat cu carte de munca (employee)'], assistantMessages: [],
    }).grounded).toBe(true)
  })
  it('confirmed proposal (CONTEXT-HIT flow): agent proposed the label, customer affirmed', () => {
    expect(isValueGrounded({
      value: 'simple_protection', options: SUBTYPE_OPTIONS,
      userMessages: ['da'],
      assistantMessages: ['Înțeleg că vrei Protecție simplă — confirmi?'],
    })).toMatchObject({ grounded: true, basis: 'confirmed_proposal' })
  })
  it('boolean write rides the customer affirmation/negation', () => {
    expect(isValueGrounded({ value: 'true', userMessages: ['da'], assistantMessages: ['Ești fumător?'] }).grounded).toBe(true)
    expect(isValueGrounded({ value: 'false', userMessages: ['nu'], assistantMessages: ['Ești fumător?'] }).grounded).toBe(true)
  })
  it('long free text: CNP / name / email direct matches, case- and diacritics-insensitive', () => {
    expect(isValueGrounded({ value: '1960229410015', userMessages: ['CNP-ul meu este 1960229410015'], assistantMessages: [] }).grounded).toBe(true)
    expect(isValueGrounded({ value: 'Ion Simulescu', userMessages: ['ion simulescu'], assistantMessages: [] }).grounded).toBe(true)
    expect(isValueGrounded({ value: 'ion.sim@example.com', userMessages: ['e ion.sim@example.com'], assistantMessages: [] }).grounded).toBe(true)
  })
  it('ISO date grounds against a reformatted customer date (29.02.1996 -> 1996-02-29)', () => {
    expect(isValueGrounded({ value: '1996-02-29', userMessages: ['m-am nascut pe 29.02.1996'], assistantMessages: [] }).grounded).toBe(true)
  })
  it('ISO date grounds against the CNP the customer typed (yymmdd derivation)', () => {
    expect(isValueGrounded({ value: '1996-02-29', userMessages: ['1960229410015'], assistantMessages: [] }).grounded).toBe(true)
  })
  it('a date with NO anchor anywhere stays ungrounded', () => {
    expect(isValueGrounded({ value: '1990-01-01', userMessages: ['da', 'continuăm'], assistantMessages: [] }).grounded).toBe(false)
  })

  it('re-declaring the ALREADY-RECORDED value is not fabrication (run cmr9eli9n: email re-collected 15 turns later)', () => {
    const r = isValueGrounded({
      value: 'ion.sim@example.com', storedValue: 'ion.sim@example.com',
      userMessages: ['da', 'continuam'], assistantMessages: [],
    })
    expect(r).toMatchObject({ grounded: true, basis: 'already_recorded' })
  })
  it('a DIFFERENT value than the stored one still needs its own anchor', () => {
    expect(isValueGrounded({
      value: 'new@example.com', storedValue: 'ion.sim@example.com',
      userMessages: ['da'], assistantMessages: [],
    }).grounded).toBe(false)
  })

  it('a proposal without affirmation stays UNGROUNDED (the agent cannot self-confirm)', () => {
    expect(isValueGrounded({
      value: 'simple_protection', options: SUBTYPE_OPTIONS,
      userMessages: ['cat costa?'],
      assistantMessages: ['Îți recomand Protecție simplă.'],
    }).grounded).toBe(false)
  })
})
