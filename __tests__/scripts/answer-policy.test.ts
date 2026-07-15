/**
 * Sim answer policy — post-quote segment (F5.5: disclosures → accept → payment).
 *
 * The happy-path sim stalls after QUOTE ISSUED unless pickAnswer recognizes
 * the disclosure-acknowledgment, quote-acceptance and payment-completion
 * asks. The ordering traps are real transcripts: disclosure asks mention
 * "documentele IPID" (generic /document/ answers "am incarcat buletinul")
 * and "pe email" (the /email/ pattern answers with an email address).
 */
import { describe, it, expect } from 'vitest'
import { pickAnswer } from '@/scripts/sims/answer-policy'

describe('pickAnswer — post-quote segment', () => {
  it('acknowledges the IPID/terms disclosure ask (not the buletin upload answer)', () => {
    const a = pickAnswer(
      'Înainte de acceptare trebuie să citești documentele precontractuale: IPID și Termenii și condițiile. Confirmi că le-ai citit?',
      'valid',
    )
    expect(a).toMatch(/citit/)
    expect(a).not.toMatch(/buletin/)
  })

  it('acknowledges a terms-and-conditions ask without the IPID token', () => {
    const a = pickAnswer('Te rog să confirmi că ai parcurs termenii și condițiile produsului.', 'valid')
    expect(a).toMatch(/citit/)
  })

  it('disclosure ask delivered "pe email" does not answer with an email address', () => {
    const a = pickAnswer('Ți-am trimis documentele IPID și termenii și condițiile pe email. Confirmi că le-ai citit?', 'valid')
    expect(a).not.toMatch(/@/)
    expect(a).toMatch(/citit/)
  })

  it('disclosure gate wins over the acceptance ask when both appear', () => {
    const a = pickAnswer('Înainte să accepți oferta, confirmă că ai citit documentul IPID.', 'valid')
    expect(a).toMatch(/citit/)
    expect(a).not.toMatch(/accept oferta/)
  })

  it('accepts the issued quote and elects the annual frequency in one answer', () => {
    const a = pickAnswer('Perfect! Prima anuală este 1.250 RON. Dorești să accepți oferta?', 'valid')
    expect(a).toMatch(/accept oferta/)
    expect(a).toMatch(/anual/)
  })

  it('reports the payment as completed when the payment window ask arrives', () => {
    const a = pickAnswer('Am deschis fereastra de plată pentru prima rată. Te rog finalizează plata acolo.', 'valid')
    expect(a).toMatch(/finalizat plata/)
  })

  it('frequency-only election still answers anual (existing behavior)', () => {
    expect(pickAnswer('Cum preferi să plătești: anual, semestrial sau trimestrial?', 'valid')).toBe('anual')
  })

  it('identity-document upload ask still answers with the buletin upload (existing behavior)', () => {
    expect(pickAnswer('Te rog să încarci buletinul (carte de identitate) în aplicație.', 'valid')).toBe(
      'am incarcat buletinul in aplicatie',
    )
  })

  it('email-collection ask still answers with an address (existing behavior)', () => {
    expect(pickAnswer('Care este adresa ta de email?', 'valid')).toBe('ion.sim@example.com')
  })

  it('refuse-consent policy still refuses only the signing ask (existing behavior)', () => {
    expect(pickAnswer('Ești de acord să semnezi documentul DNT?', 'refuse-consent')).toMatch(/nu semnez/)
  })
})

describe('pickAnswer — stall patterns from run cmr99s5cb0001ms0e9er0j0ii (2026-07-06)', () => {
  it('answers the full-name ask with a name, never "da" (terminal stall at msg 77-98)', () => {
    expect(pickAnswer('Am nevoie de **numele tău complet** ca să putem continua.', 'valid')).toBe('Ion Simulescu')
    expect(pickAnswer('Perfect — continuăm cu datele necesare pentru cerere. **Nume și prenume**?', 'valid')).toBe('Ion Simulescu')
    expect(pickAnswer('Acum am nevoie de **numele complet**.', 'valid')).toBe('Ion Simulescu')
  })

  it('answers the date-of-birth ask with the CNP-consistent date (CNP 1960229410015 => 1996-02-29)', () => {
    expect(pickAnswer('Următorul câmp este **data nașterii**, în format **AAAA-LL-ZZ**.', 'valid')).toBe('1996-02-29')
  })

  it('answers the phone ask with a number, and it does not collide with the email-sau-telefon channel ask', () => {
    expect(pickAnswer('Care este numărul tău de telefon?', 'valid')).toBe('0722334455')
    expect(pickAnswer('Am nevoie și de **numărul de telefon** pentru profil.', 'valid')).toBe('0722334455')
    expect(pickAnswer('Preferi verificarea prin email sau prin telefon?', 'valid')).toMatch(/verificarea prin email/)
  })

  it('chooses the treatment-abroad variant explicitly (msg 53-63 loop: "baza sau tratament în străinătate")', () => {
    const a = pickAnswer('Am nevoie de alegerea exactă: **baza** sau **tratament în străinătate**?', 'valid')
    expect(a).toMatch(/tratament in strainatate/)
    expect(a).not.toBe('da')
  })

  it('agent ECHO of the chosen variant does not re-trigger the choice answer (run cmr9abb8a echo loop)', () => {
    // Run 2 deadlock: every agent reply acknowledged "păstrăm varianta cu
    // tratament în străinătate" then asked the health question — the pattern
    // must answer the QUESTION (da), not re-elect the variant.
    const a = pickAnswer(
      'Am înțeles — păstrăm varianta cu tratament în străinătate. Ca să putem continua, întrebarea curentă din cerere este: **Confirm că sunt sănătos/sănătoasă și nu am afecțiuni medicale cunoscute care ar afecta această asigurare**',
      'valid',
    )
    expect(a).toBe('da')
  })

  it('BD medical questions answer NU — any-yes-rejects would kill the addon (run cmr9ayiad: eligibility_recheck -> escalation loop)', () => {
    const bdAsks = [
      'Ați fost vreodată diagnosticat(ă) sau tratat(ă) pentru cancer, stări pre-canceroase sau tumori?',
      'Ați fost diagnosticat(ă) sau tratat(ă) pentru afecțiuni cardiovasculare care necesită intervenție chirurgicală?',
      'Ați fost diagnosticat(ă) sau tratat(ă) pentru afecțiuni neurologice care necesită neurochirurgie?',
      'Ați necesitat vreodată sau ați fost evaluat(ă) pentru transplant de organe sau măduvă osoasă?',
      'Aveți afecțiuni medicale cronice aflate în prezent sub tratament?', // contains "afecțiuni medicale" — must NOT hit the health-declaration 'da'
      'Ați fost internat(ă) în ultimele 12 luni din alte motive decât accidente?',
    ]
    for (const ask of bdAsks) expect(pickAnswer(ask, 'valid'), ask).toBe('nu')
  })

  it('BD question bundled with an echo of the previous BD answer still answers NU', () => {
    expect(pickAnswer('Am notat că nu ai avut cancer. Următoarea întrebare: Ați fost diagnosticat(ă) pentru afecțiuni cardiovasculare?', 'valid')).toBe('nu')
  })

  it('the blanket health declaration still answers DA (customer confirms being healthy)', () => {
    expect(pickAnswer('Confirm că sunt sănătos/sănătoasă și nu am afecțiuni medicale cunoscute care ar afecta această asigurare', 'valid')).toBe('da')
  })

  // ---- run cmr9cq7e5 (2026-07-06, first batch-sign run) shadowing bugs ----

  it('the batch-sign SUMMARY confirms despite echoing BD tokens (run cmr9cq7e5 msg 49: summary answered "nu")', () => {
    const a = pickAnswer(
      'Am parcurs toate întrebările medicale. Pe scurt, răspunsurile declarate sunt: - fără istoric de cancer sau tumori - fără afecțiuni cardiovasculare cu indicație chirurgicală. Confirmi declarația medicală?',
      'valid',
    )
    expect(a).toMatch(/^da/)
    expect(a).not.toBe('nu')
  })

  it('re-emitted sign card ask also confirms (run cmr9cq7e5 msg 51: "Fără confirmarea declarației medicale...")', () => {
    const a = pickAnswer('Fără confirmarea declarației medicale, componenta de tratament în străinătate nu poate merge mai departe.', 'valid')
    expect(a).toMatch(/^da/)
  })

  it('channel choice outranks the disclosure ack (run cmr9cq7e5 msg 63: "documentele precontractuale... email sau SMS?")', () => {
    const a = pickAnswer('Documentele precontractuale au fost confirmate. Mai rămâne verificarea identității. Preferi email sau SMS?', 'valid')
    expect(a).toMatch(/email/)
    expect(a).not.toMatch(/citit/)
  })

  it('the email-ADDRESS request outranks the OTP pattern (run cmr9cq7e5 msg 69: verification never started)', () => {
    expect(pickAnswer('Spune-mi adresa de email pe care vrei să primești codul de verificare.', 'valid')).toBe('ion.sim@example.com')
  })

  it('channel ask phrased "email sau telefon / pe ce canal" picks email (run cmr9deipd msg 127: 35-turn ack loop)', () => {
    const a = pickAnswer(
      'Documentele precontractuale sunt în regulă. Ca să poți merge la acceptare, mai lipsește verificarea identității printr-un cod trimis pe **email** sau **telefon**. Pe ce canal preferi să-l primești?',
      'valid',
    )
    expect(a).toMatch(/email/)
    expect(a).not.toMatch(/citit/)
  })

  it('agent ECHO "documentele precontractuale au fost confirmate" does not re-trigger the disclosure ack', () => {
    const a = pickAnswer(
      'Mulțumesc — documentele precontractuale au fost confirmate. Oferta ta rămâne: 390 RON/an. Pe ce canal preferi să primești codul?',
      'valid',
    )
    expect(a).not.toMatch(/citit/)
  })

  it('a genuine first disclosure ask still acknowledges (guard must key on past-tense state, not "confirmi")', () => {
    const a = pickAnswer('Îți prezint documentele precontractuale: IPID și Termenii. Confirmi că le-ai citit?', 'valid')
    expect(a).toMatch(/citit/)
  })

  it('the ID-upload ask outranks acceptance (run cmr9cq7e5 msg 71: "un singur pas înainte de acceptarea ofertei")', () => {
    const a = pickAnswer(
      'Mai rămâne un singur pas înainte de acceptarea ofertei: documentul de identitate. Te rog să încarci o poză clară a cărții de identitate pe cardul securizat.',
      'valid',
    )
    expect(a).toBe('am incarcat buletinul in aplicatie')
  })

  it('level confirmation that mentions the already-included variant is a plain confirm (run cmr9abb8a msg 49)', () => {
    const a = pickAnswer(
      'Da — varianta cu tratament în străinătate este inclusă. Mai lipsește un singur detaliu: Nivelul I. Continui cu Standard, Nivelul I?',
      'valid',
    )
    expect(a).toBe('da')
  })

  it('picks email when asked to choose the verification channel (msg 69-75 loop: "email sau SMS")', () => {
    const a = pickAnswer('Preferi verificarea prin **email** sau prin **SMS**?', 'valid')
    expect(a).toMatch(/email/)
    expect(a).not.toMatch(/@/)
    expect(a).not.toMatch(/accept oferta/)
  })

  it('channel choice outranks the acceptance pattern when the ask mentions the quote', () => {
    const a = pickAnswer('Pentru acceptarea ofertei este necesară verificarea. Poți alege: **email** - **SMS**', 'valid')
    expect(a).toMatch(/email/)
    expect(a).not.toMatch(/accept oferta/)
  })

  it('OTP ask outranks the email pattern (msg 83-88 loop: "codul de verificare pe email")', () => {
    expect(pickAnswer('Am trimis codul de verificare pe email. Spune-mi codul din 6 cifre când îl ai.', 'valid')).toBe(
      'am dat click pe linkul din email',
    )
  })

  it('plain email-collection ask still gets the address (guard for the reorder)', () => {
    expect(pickAnswer('Care este adresa ta de email?', 'valid')).toBe('ion.sim@example.com')
  })
})
