import { describe, it, expect } from 'vitest'
import { detectToolNarration } from '@/lib/chat/tool-narration-detector'

/**
 * Fixtures are verbatim assistant lines pulled from two real conversations
 * (cmpmmpew7000e6g0yo25phwba, cmpmm46bu002d3k0yksgra4dk) that exhibited
 * Pathology 1: the agent narrating its tool use and asking the customer
 * for permission to perform a lookup, instead of just answering.
 */
describe('detectToolNarration', () => {
  // ── Permission-asking: never acceptable in customer-facing text ──
  it('flags asking permission to search the catalog (ConvB turn 7)', () => {
    const r = detectToolNarration(
      'Vrei să caut varianta exactă din catalog ca să-ți explic corect ce acoperă?',
      'ro',
    )
    expect(r.clean).toBe(false)
    expect(r.violations.some((v) => v.category === 'permission')).toBe(true)
  })

  it('flags asking permission to verify eligibility/cost (ConvA turn 9)', () => {
    const r = detectToolNarration(
      'Vrei să verific eligibilitatea, costul sau cum se activează opțiunea?',
      'ro',
    )
    expect(r.clean).toBe(false)
    expect(r.violations.some((v) => v.category === 'permission')).toBe(true)
  })

  it('flags asking permission to run the check now (ConvA turn 37)', () => {
    const r = detectToolNarration('Vrei să fac verificarea pentru Protect acum?', 'ro')
    expect(r.clean).toBe(false)
    expect(r.violations.some((v) => v.category === 'permission')).toBe(true)
  })

  it('flags English permission-asking', () => {
    const r = detectToolNarration('Do you want me to check the catalog for you?', 'en')
    expect(r.clean).toBe(false)
    expect(r.violations.some((v) => v.category === 'permission')).toBe(true)
  })

  // ── Confessing it has not looked something up ──
  it('flags confessing it has not verified yet (ConvB turn 7)', () => {
    const r = detectToolNarration(
      'încă nu am reușit să verific detaliile exacte ale produsului în catalog după nume.',
      'ro',
    )
    expect(r.clean).toBe(false)
    expect(r.violations.some((v) => v.category === 'unchecked')).toBe(true)
  })

  it('flags "nu vreau să inventez ... fără să verific" (ConvA turn 9)', () => {
    const r = detectToolNarration(
      'Nu vreau să inventez detalii despre cum funcționează exact fără să verific produsul corect din catalog.',
      'ro',
    )
    expect(r.clean).toBe(false)
    expect(r.violations.some((v) => v.category === 'unchecked')).toBe(true)
  })

  it('flags English "I have not checked yet"', () => {
    const r = detectToolNarration("I haven't checked the catalog yet.", 'en')
    expect(r.clean).toBe(false)
    expect(r.violations.some((v) => v.category === 'unchecked')).toBe(true)
  })

  // ── Exposing internal mechanics ──
  it('flags exposing the internal variant identifier (ConvA turn 37)', () => {
    const r = detectToolNarration(
      'Nu pot seta produsul exact pentru că identificatorul intern al variantei confirmate nu este disponibil aici.',
      'ro',
    )
    expect(r.clean).toBe(false)
    expect(r.violations.some((v) => v.category === 'internal')).toBe(true)
  })

  // ── Clean controls: must stay clean (no false positives) ──
  it('passes a clean product description', () => {
    const r = detectToolNarration(
      'La Allianz-Țiriac Asigurări S.A. avem Protect — o asigurare de viață cu opțiune de tratament medical în străinătate pentru afecțiuni grave.',
      'ro',
    )
    expect(r.clean).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('passes a clean substantive answer with figures', () => {
    const r = detectToolNarration(
      'Opțiunea de tratament medical în străinătate acoperă afecțiuni grave și include cheltuieli de tratament până la 2.000.000 EUR.',
      'ro',
    )
    expect(r.clean).toBe(true)
  })

  it('passes a clean English answer', () => {
    const r = detectToolNarration(
      'Protect is a life insurance policy that also covers treatment abroad for serious illnesses.',
      'en',
    )
    expect(r.clean).toBe(true)
  })

  it('does not flag a legitimate discovery question', () => {
    const r = detectToolNarration('Ca să-ți arăt pachetul potrivit, câți ani ai?', 'ro')
    expect(r.clean).toBe(true)
  })
})
