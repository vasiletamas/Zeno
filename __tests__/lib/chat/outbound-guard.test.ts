/**
 * T16 (P3.2): deterministic outbound contradiction guard — pure detector.
 * A false impossibility claim about an AVAILABLE funnel action is lost
 * revenue (class of conv cmrm3fgku00056g0y4eb2hsme messageIndex 58:
 * "calcularea nu poate fi finalizată" while generate_quote was open). This
 * is the ONLINE half of the T13 stale_gate_claim family — it reads the
 * draft BEFORE the customer does; both halves share one lexicon
 * (lib/chat/impossibility-lexicon.ts) so they cannot drift.
 */
import { describe, it, expect } from 'vitest'
import { detectFalseUnavailabilityClaim } from '@/lib/chat/outbound-guard'

describe('detectFalseUnavailabilityClaim', () => {
  // ---- hits: impossibility near a domain keyword of an AVAILABLE action ----

  it('flags the msg-58 shape: "calcularea nu poate fi finalizată" while generate_quote is available', () => {
    const hit = detectFalseUnavailabilityClaim(
      'Din păcate, calcularea nu poate fi finalizată în această conversație.',
      ['generate_quote', 'escalate_to_human'],
      'ro',
    )
    expect(hit).not.toBeNull()
    expect(hit!.action).toBe('generate_quote')
    // claim is the normalized (diacritic-stripped, lowercased) evidence window
    expect(hit!.claim).toContain('calcularea nu poate fi finalizata')
  })

  it('flags an English impossibility claim ("the calculation cannot be completed")', () => {
    const hit = detectFalseUnavailabilityClaim(
      'Unfortunately, the calculation cannot be completed in this conversation.',
      ['generate_quote'],
      'en',
    )
    expect(hit).toMatchObject({ action: 'generate_quote' })
  })

  it('flags a DNT-signing refusal ("analiza nu mai poate fi semnată") while sign_dnt is available', () => {
    const hit = detectFalseUnavailabilityClaim(
      'Analiza de nevoi nu mai poate fi semnată în acest moment.',
      ['sign_dnt'],
      'ro',
    )
    expect(hit).toMatchObject({ action: 'sign_dnt' })
  })

  it('flags a medical-declaration refusal while sign_medical_declarations is available', () => {
    const hit = detectFalseUnavailabilityClaim(
      'Nu pot semna declarațiile medicale în acest moment.',
      ['sign_medical_declarations'],
      'ro',
    )
    expect(hit).toMatchObject({ action: 'sign_medical_declarations' })
  })

  it('flags a payment refusal ("plata nu este posibilă") while ensure_payment_session is available', () => {
    const hit = detectFalseUnavailabilityClaim(
      'Plata nu este posibilă momentan.',
      ['ensure_payment_session'],
      'ro',
    )
    expect(hit).toMatchObject({ action: 'ensure_payment_session' })
  })

  it('flags a verification-code refusal while start_channel_verification is available', () => {
    const hit = detectFalseUnavailabilityClaim(
      'Nu pot trimite codul de verificare acum.',
      ['start_channel_verification'],
      'ro',
    )
    expect(hit).toMatchObject({ action: 'start_channel_verification' })
  })

  // ---- negatives: the guard must NEVER fire on truthful or unrelated prose ----

  it('passes a truthful refusal about a BLOCKED action (generate_quote not in available)', () => {
    expect(detectFalseUnavailabilityClaim(
      'Din păcate, calcularea nu poate fi finalizată încă.',
      ['sign_medical_declarations', 'collect_customer_data'],
      'ro',
    )).toBeNull()
  })

  it('passes a medical-advice refusal — "sfaturi medicale" is no funnel action', () => {
    expect(detectFalseUnavailabilityClaim(
      'Nu pot să-ți dau sfaturi medicale, dar te pot ajuta cu asigurarea.',
      ['generate_quote', 'sign_medical_declarations', 'sign_dnt', 'ensure_payment_session', 'start_channel_verification'],
      'ro',
    )).toBeNull()
  })

  it('passes when the impossibility verb and the domain keyword are far apart (> proximity window)', () => {
    const text = 'Nu pot divulga detalii interne despre proces. ' + 'a'.repeat(120) + ' Oferta rămâne valabilă.'
    expect(detectFalseUnavailabilityClaim(text, ['generate_quote'], 'ro')).toBeNull()
  })

  it('does NOT attribute a medical-declaration refusal to sign_dnt (tight sign_dnt domain)', () => {
    // sign_dnt available, sign_medical_declarations blocked: a truthful
    // "can't sign the medical declarations" must not trigger a sign_dnt repair
    expect(detectFalseUnavailabilityClaim(
      'Nu pot semna declarațiile medicale în acest moment.',
      ['sign_dnt'],
      'ro',
    )).toBeNull()
  })

  it('passes clean prose with domain keywords but no impossibility', () => {
    expect(detectFalseUnavailabilityClaim(
      'Declarațiile sunt semnate — generez oferta acum.',
      ['generate_quote', 'sign_medical_declarations'],
      'ro',
    )).toBeNull()
  })

  it('passes empty text and empty availability', () => {
    expect(detectFalseUnavailabilityClaim('', ['generate_quote'], 'ro')).toBeNull()
    expect(detectFalseUnavailabilityClaim('Calcularea nu poate fi finalizată.', [], 'ro')).toBeNull()
  })
})
