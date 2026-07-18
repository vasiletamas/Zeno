/**
 * Question-aware answer picking for the scripted live sims (verify-advance-flow
 * lineage) — extracted from run-spec-sims.ts so the pattern table is unit-testable
 * (importing the runner executes main()).
 *
 * Enum questions get the EXACT option token where known (the agent passes
 * them through); the refusal policy refuses ONLY the actual signing ask -
 * DNT questions that merely mention consent (marketing, electronic
 * communication) get valid enum answers, otherwise the transcript fills
 * with invalid-option loops the diagnostics rightly flag as stuck.
 *
 * MERGE 2026-07-06: the sales-excellence branch threads three extra inputs —
 * typedCode (the persona READS the live OTP back instead of claiming a link
 * click), verification mode ('link' | 'typed'), and a per-trial mailbox
 * (a shared address claim-merges later trials into the first customer).
 */
import type { SpecSimScenario } from './spec-scenarios'

export function pickAnswer(
  msg: string,
  policy: SpecSimScenario['answerPolicy'],
  typedCode: string | null = null,
  verification: 'link' | 'typed' = 'link',
  email = 'ion.sim@example.com',
): string {
  // markdown emphasis breaks adjacency ("adresa de **email**") — strip it
  const m = msg.toLowerCase().replace(/\*/g, '')
  // Task 4.2 (D7): typed-code verification — a live challenge exists and the
  // agent is talking about the code, so the persona reads it back. Checked
  // FIRST: "ți-am trimis codul pe email" would otherwise match the email rule.
  if (typedCode && /\bcod(ul|uri)?\b|cifre|verificare|verificat/.test(m)) return typedCode
  if (policy === 'refuse-consent' && /(semnez|semnarea|semn[ăa]m|\bsign\b|gdpr|prelucrarea datelor)/.test(m)) {
    return 'nu, nu sunt de acord cu prelucrarea datelor si nu semnez'
  }
  // A refusing persona STAYS refused: the agent's polite re-engagement
  // ("Dacă te răzgândești, te pot ajuta să reiei" / "confirmi în cardul
  // afișat") must never collect the fallback 'da' — that literally
  // re-consents and legitimizes a second sign_dnt attempt.
  if (policy === 'refuse-consent' && /r[ăa]zg[âa]nd|reiei|relu[ăa]|pe viitor|cardul afi[șs]at|confirmi [îi]n card/.test(m)) {
    return 'nu, raman la decizia mea'
  }
  if (/yes_all/.test(m) || /consultan/.test(m)) return 'yes_all'
  if (/marketing/.test(m)) return 'nu'
  if (/electronic|coresponden/.test(m)) return 'da'
  // ---- post-quote segment (F5.5: disclosures -> accept -> payment) ----
  // ORDER IS THE BUG SURFACE here — every rule below is pinned to a live-run
  // shadowing defect in __tests__/scripts/answer-policy.test.ts.
  // Batch-sign summary FIRST: the agent echoes the BD answers ("fără istoric
  // de cancer...") while asking for the ONE signature — the BD 'nu' pattern
  // must not read that as refusing (run cmr9cq7e5 msg 49).
  if (/r[ăa]spunsurile declarate|declara[țt]ia medical[ăa]|declara[țt]iei medicale|confirmi declara/.test(m)) {
    return 'da, confirm toate declaratiile medicale'
  }
  // Channel election BEFORE the disclosure ack: "Documentele precontractuale
  // au fost confirmate... Preferi email sau SMS?" looped the disclosure
  // answer 3x (run cmr9cq7e5 msg 63-67); run cmr9deipd phrased it
  // "email sau telefon. Pe ce canal preferi?" — 35-turn loop.
  if (/email.{0,40}(sms|telefon)|(sms|telefon).{0,40}email|pe ce canal/.test(m)) return 'prefer verificarea prin email'
  // An sms-code ask (the sms transport does not exist) — steer to email.
  if (/(prin|pe) sms/.test(m) && /\bcod/.test(m)) return `nu imi merge sms-ul, trimite codul pe email la ${email}`
  // ID-upload ask BEFORE acceptance: "un singur pas înainte de acceptarea
  // ofertei: documentul de identitate" looped the acceptance answer
  // (run cmr9cq7e5 msg 71-81).
  if (/[îi]ncarc.{0,60}(c[ăa]r[țt]ii de identitate|carte(a)? de identitate|buletin)|documentul de identitate/.test(m)) {
    return 'am incarcat buletinul in aplicatie'
  }
  // Consent to SEND the verification code — AFTER the channel election
  // ("Preferi verificarea prin email sau telefon?" is an election, not a
  // send ask) but BEFORE the email-address rule: "Continuăm cu verificarea
  // adresei de email?" is a yes/no ask, and an acceptance-stuck persona
  // loops there re-collecting known fields (2026-07-06 battery).
  // ...but never when the code was ALREADY sent ("Am trimis codul de
  // verificare pe email") — that ask wants the code/link, not a re-send.
  if (!typedCode && !/trimis/.test(m) && /trimite codul|trimit codul|verificarea? (identit[ăa][țt]ii )?(pe|prin) e?mail|verificarea (adresei de )?e?mail(ului)?/.test(m)) return 'da, trimite codul pe email'
  // Email-ADDRESS request BEFORE the OTP pattern: "Spune-mi adresa de email
  // pe care vrei să primești codul de verificare" got "am dat click" and
  // channel verification never started (run cmr9cq7e5 msg 69). NOT on
  // statements about the address ("adresa de email este verificată") —
  // volunteering it there makes the agent re-store the field.
  if (!/verificat/.test(m) && /adres[ăa]( ta)? de e?mail|ce e?mail|emailul t[ăa]u|\bcare\b.*e?mail|scrie e?mailul/.test(m)) return email
  // Disclosure ack — before the generic /email/ and /document|buletin/
  // patterns ("documentele IPID pe email"), after channel election. The
  // echo-guard: an agent message ASSERTING the docs are already confirmed
  // ("au fost confirmate", "sunt în regulă") is an acknowledgment of OUR ack,
  // not a new ask — re-answering it looped 35 turns in run cmr9deipd.
  if (
    /ipid|precontractual|termeni[i]? [șs]i condi/.test(m)
    && !/(au fost|sunt) confirmate|sunt [îi]n regul[ăa]|e [îi]n regul[ăa]/.test(m)
  ) {
    return 'da, am citit documentele ipid si termenii si conditiile si sunt de acord'
  }
  // BD medical questions BEFORE the health declaration: BD_CHRONIC_CONDITIONS
  // contains "afecțiuni medicale" too, and a 'da' there trips the
  // any-yes-rejects eligibility rule — run cmr9ayiad lost the addon to it and
  // the agent escalated to a human 45 times. The healthy customer says NU.
  if (/cancer|tumori|cardiovascular|neurologic|transplant|cronice|internat|diagnosticat/.test(m)) return 'nu'
  // Health declaration BEFORE the variant choice: the agent echoes "păstrăm
  // varianta cu tratament în străinătate" while asking the medical confirm
  // (run cmr9abb8a: the echo re-triggered the choice answer 12x — deadlock).
  if (/s[ăa]n[ăa]tos|afec[țt]iuni medicale/.test(m)) return 'da'
  // base-vs-addon choice (run cmr99s5cb: six 'da' answers to "baza sau
  // tratament în străinătate?" left the agent guessing, then cancelling).
  // BOTH variants must be named — a mere mention of the chosen addon is the
  // agent acknowledging, not asking.
  if (/baz[ăa]/.test(m) && /str[ăa]in[ăa]tate/.test(m)) return 'vreau varianta cu tratament in strainatate'
  if (/accep/.test(m) && /ofert/.test(m)) return 'da, accept oferta cu plata anuala'
  if (/fereastra de plat|sesiune[a]? de plat|finalizeaz[ăa] plata|efectueaz[ăa] plata|linkul de plat/.test(m)) {
    return 'am finalizat plata in fereastra de plata'
  }
  if (/fum[ăa]tor/.test(m)) return 'nu'
  if (/c[âa]ți ani|ce v[âa]rst[ăa]|v[âa]rsta ta/.test(m)) return '35'
  if (/\bcnp\b/.test(m)) return '1960229410015' // checksum-valid (the old 4-final variant failed collect_customer_field)
  if (/data na[șs]terii|zi de na[șs]tere|aaaa-ll-zz/.test(m)) return '1996-02-29' // MUST match the CNP above (a conflict downgrades identity provenance)
  if (/num[ăa]r(ul)?( t[ăa]u)? de telefon/.test(m)) return '0722334455' // KYC field — the decomposed needs make the agent ask for it
  // "în format românesc, de exemplu 07XXXXXXXX" — the adjacency regex above
  // misses format-phrased asks and the persona answered 'da' forever
  // (2026-07-06 battery: phone never declared, close walled on identity).
  if (/telefon/.test(m) && /num[ăa]r|format|07/.test(m)) return '0722334455'
  if (/cu cine loc|gospod[ăa]r/.test(m)) return 'singur'
  // T28: residency is asked in plain conversation now (the CNP that implied
  // it is never asked by mouth) — AFTER the household rule ("cu cine
  // locuiești" also contains 'locuie').
  if (/rom[âa]nia/.test(m) && /locuie|reziden|domicili/.test(m)) return 'da, locuiesc in Romania'
  if (/sursa|provin/.test(m)) return 'din salariu'
  if (/2000_5000|interval/.test(m)) return 'intre 2000 si 5000'
  if (/venit|salar/.test(m)) return '5000'
  if (/ocupa|profesi|lucrezi/.test(m)) return 'sunt angajat cu carte de munca (employee)'
  if (/copii|dependen/.test(m)) return '0'
  // Seed question text is now "Câți membri are familia ta, inclusiv tu?" —
  // must come AFTER the minors check (that text also contains "membrii").
  if (/membri|famili/.test(m)) return '2'
  if (/tip de protec|protec[țt]ie simpl/.test(m)) return 'simple_protection'
  if (/educa|studii/.test(m)) return 'studii universitare (university)'
  // Handoff-confirmation prose ("un coleg uman te va contacta") — steer back
  // to the close instead of re-triggering the email rule forever.
  if (/coleg uman|te va contacta/.test(m)) return 'nu vreau sa astept un coleg, vreau sa accept oferta aici'
  // Post-verification: the agent says the email is already verified — the
  // next move is the close, never re-sending the address.
  if (/deja verificat/.test(m)) return 'perfect, atunci vreau sa accept oferta'
  // OTP before email: "Am trimis codul de verificare pe email" answered with
  // the email address three times in run cmr99s5cb before this reorder.
  // "codul"/"cele 6 cifre" must hit this rule too — a bare 'da' to a code
  // ask confuses the model into re-asking KYC fields (2026-07-06). Typed
  // mode never claims a link click (a lie that derails the close).
  if (/\bcod(ul|uri)?\b|cifre|verificare|verificat/.test(m)) return verification === 'typed' ? 'da' : 'am dat click pe linkul din email'
  if (/numele|nume [șs]i prenume/.test(m)) return 'Ion Simulescu' // terminal stall of run cmr99s5cb: 'da' saved as the customer name
  if (!/verificat/.test(m) && /email/.test(m)) return email
  if (/document|buletin|carte de identitate/.test(m)) return 'am incarcat buletinul in aplicatie'
  if (/frecven|plat[ăa] anual|trimestrial/.test(m)) return 'anual'
  return 'da'
}
