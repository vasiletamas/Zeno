export type Language = 'ro' | 'en'

/**
 * Flat UI strings plus the nested per-ReasonCode map (A3.ADD-3/M6 GUI leg):
 * the engine emits snake_case reason codes, never prose — these are the
 * customer-safe bilingual renderings the GUI shows for blocked/rejected
 * commits. Every member of REASON_CODES must have an entry (pinned by test).
 */
interface TranslationTable {
  reasonCodes: Record<string, string>
  [key: string]: string | Record<string, string>
}

export const translations: Record<Language, TranslationTable> = {
  ro: {
    reasonCodes: {
      no_product_in_focus: 'Mai întâi alegem produsul potrivit pentru tine.',
      no_open_application: 'Nu există încă o aplicație deschisă.',
      application_already_open: 'Există deja o aplicație în curs.',
      application_paused: 'Aplicația este în pauză — o putem relua oricând.',
      requires_consent: 'Avem nevoie mai întâi de acordul tău.',
      dnt_not_signed: 'Analiza de nevoi trebuie semnată mai întâi.',
      dnt_incomplete: 'Mai sunt întrebări de completat în analiza de nevoi.',
      dnt_expired: 'Analiza de nevoi a expirat — o refacem rapid.',
      questionnaire_incomplete: 'Mai sunt întrebări de completat înainte de ofertă.',
      selection_incomplete: 'Mai întâi alegem pachetul și nivelul.',
      quote_already_issued: 'Există deja o ofertă activă.',
      no_issued_quote: 'Nu există încă o ofertă generată.',
      quote_expired: 'Oferta a expirat — generăm una nouă.',
      quote_already_accepted: 'Oferta a fost deja acceptată.',
      requires_confirmation: 'Este nevoie de confirmarea ta pentru acest pas.',
      requires_identity: 'Avem nevoie de câteva date de identificare mai întâi.',
      requires_disclosures: 'Mai întâi trebuie parcurse informările obligatorii.',
      already_applied: 'Acest pas a fost deja finalizat.',
      stale_confirm_token: 'Confirmarea a expirat — te rugăm să reiei pasul.',
      invalid_args: 'Datele trimise nu sunt valide.',
      handler_rejected: 'Operațiunea nu a putut fi finalizată.',
      temporarily_unavailable: 'Serviciul este momentan indisponibil. Încearcă din nou în scurt timp.',
      degraded_mode: 'Funcționăm momentan în mod limitat.',
      no_policy: 'Nu există încă o poliță emisă.',
      payment_not_pending: 'Nu există o plată în așteptare.',
      permission_denied: 'Nu ai permisiunea pentru această acțiune.',
      not_exposed: 'Această acțiune nu este disponibilă în acest moment.',
    },
    // Hero section
    hero_headline: 'Dacă mâine primești un diagnostic grav, ai fi pregătit?',
    hero_subtitle:
      'Acces la tratament în cele mai bune clinici din lume. De la 45 lei pe lună. Asigurare Allianz-Țiriac.',
    cta_button: 'Află în 3 minute',
    trust_badge: 'Produs Allianz-Țiriac',

    // Benefits
    benefit_1_title: 'Fără examen medical',
    benefit_1_desc: 'Protecție simplă, fără birocrație',
    benefit_2_title: 'Tratament global',
    benefit_2_desc: 'Acces la clinici de top din întreaga lume',
    benefit_3_title: 'Activ din prima zi',
    benefit_3_desc: 'Protecție imediată pentru familia ta',

    // How it works
    how_title: 'Cum funcționează?',
    how_step_1: 'Vorbești cu Zeno (5 min)',
    how_step_2: 'Alegi protecția potrivită',
    how_step_3: 'Ești protejat din acel moment',

    // Footer
    footer_legal:
      'Zeno este operat de [company], agent de asigurare Allianz-Țiriac.',
    footer_asf: 'Reglementat de ASF.',
    footer_copyright: '© 2026 Zeno. Toate drepturile rezervate.',

    // Chat UI
    chat_placeholder: 'Scrie un mesaj...',
    chat_new_messages: 'Mesaje noi',
    chat_error: 'A apărut o eroare. Te rog încearcă din nou.',
    chat_typing: 'Zeno se gândește...',

    // B2: Product cards
    product_card_select: 'Alege acest plan',
    product_card_recommended: 'Recomandat',

    // B2: Quote card
    quote_card_title: 'Oferta ta',
    quote_card_coverages: 'Acoperiri incluse:',
    quote_card_valid_until: 'Valabila pana la:',
    quote_card_accept: 'Accepta oferta',
    quote_card_modify: 'Modifica',

    // B2: Question card
    question_progress: 'Intrebarea {answered} din {total}',
    question_continue: 'Continua',
    question_submit: 'Trimite',
    question_type_placeholder: 'Scrie raspunsul...',
    question_number_placeholder: 'Introdu un numar',

    // B2: BD result card
    bd_result_continue: 'Da, continua',
    bd_result_decline: 'Nu, multumesc',
    bd_result_answered: 'Raspuns inregistrat',

    // B2: Policy issued card
    policy_congratulations: 'Felicitari!',
    policy_activating: 'Polita ta se activeaza.',
    policy_total_coverage: 'Acoperire totala',
    policy_email_confirmation: 'Vei primi confirmarea pe email in urmatoarele ore.',

    // B2: Inline data form
    data_form_save: 'Salveaza',
    data_form_cnp_error: 'CNP-ul trebuie sa contina exact 13 cifre',
    data_form_email_error: 'Adresa de email nu este valida',
    data_form_phone_error: 'Numarul de telefon nu este valid',
    data_form_invalid: 'Valoarea introdusa nu este valida',
    data_form_too_short: 'Minim {min} caractere',
    data_form_too_long: 'Maxim {max} caractere',

    // B4: Customer dashboard
    dashboard_title: 'Contul meu',
    dashboard_logout: 'Deconectare',
    dashboard_no_policies: 'Nu ai polite active',
    dashboard_no_policies_desc: 'Vorbeste cu Zeno pentru a obtine o polita de asigurare.',
    dashboard_your_policy: 'Polita ta',
    dashboard_total_coverage: 'Acoperire totala',
    dashboard_next_payment: 'Urmatoarea plata',
    dashboard_documents: 'Documente',
    policy_pending: 'Polita ta este in curs de activare',
    policy_active: 'Activa',
    action_chat: 'Vorbeste cu Zeno',
    action_download: 'Descarca polita',
    action_referral: 'Recomanda un prieten',
    document_policy: 'Polita PDF',
    document_dnt: 'Raport suitabilitate (DNT)',
    document_receipt: 'Chitanta plata',
    document_unavailable: 'Disponibil dupa activare',
    magic_link_sent: 'Verifica email-ul. Am trimis un link de acces.',
    magic_link_button: 'Trimite link de acces',
    magic_link_sending: 'Se trimite...',
    magic_link_error: 'Nu am putut trimite link-ul. Incearca din nou.',
  },
  en: {
    reasonCodes: {
      no_product_in_focus: 'Let’s pick the right product for you first.',
      no_open_application: 'There is no open application yet.',
      application_already_open: 'An application is already in progress.',
      application_paused: 'The application is paused — we can resume anytime.',
      requires_consent: 'We need your consent first.',
      dnt_not_signed: 'The needs analysis must be signed first.',
      dnt_incomplete: 'A few needs-analysis questions are still unanswered.',
      dnt_expired: 'The needs analysis has expired — we can redo it quickly.',
      questionnaire_incomplete: 'A few questions remain before the quote.',
      selection_incomplete: 'Let’s choose the package and level first.',
      quote_already_issued: 'There is already an active quote.',
      no_issued_quote: 'No quote has been generated yet.',
      quote_expired: 'The quote has expired — we’ll generate a new one.',
      quote_already_accepted: 'The quote has already been accepted.',
      requires_confirmation: 'Your confirmation is needed for this step.',
      requires_identity: 'We need a few identification details first.',
      requires_disclosures: 'The mandatory disclosures come first.',
      already_applied: 'This step has already been completed.',
      stale_confirm_token: 'The confirmation expired — please redo this step.',
      invalid_args: 'The submitted data is not valid.',
      handler_rejected: 'The operation could not be completed.',
      temporarily_unavailable: 'The service is temporarily unavailable. Please try again shortly.',
      degraded_mode: 'We are temporarily running in limited mode.',
      no_policy: 'There is no issued policy yet.',
      payment_not_pending: 'There is no pending payment.',
      permission_denied: 'You do not have permission for this action.',
      not_exposed: 'This action is not available right now.',
    },
    // Hero section
    hero_headline:
      'If you received a serious diagnosis tomorrow, would you be prepared?',
    hero_subtitle:
      'Access to treatment at the best clinics worldwide. From 45 lei per month. Allianz-Țiriac insurance.',
    cta_button: 'Find out in 3 minutes',
    trust_badge: 'An Allianz-Țiriac product',

    // Benefits
    benefit_1_title: 'No medical exam',
    benefit_1_desc: 'Simple protection, no bureaucracy',
    benefit_2_title: 'Global treatment',
    benefit_2_desc: 'Access to top clinics worldwide',
    benefit_3_title: 'Active from day one',
    benefit_3_desc: 'Immediate protection for your family',

    // How it works
    how_title: 'How does it work?',
    how_step_1: 'Talk to Zeno (5 min)',
    how_step_2: 'Choose the right protection',
    how_step_3: 'You are protected from that moment',

    // Footer
    footer_legal:
      'Zeno is operated by [company], insurance agent for Allianz-Țiriac.',
    footer_asf: 'Regulated by ASF.',
    footer_copyright: '© 2026 Zeno. All rights reserved.',

    // Chat UI
    chat_placeholder: 'Write a message...',
    chat_new_messages: 'New messages',
    chat_error: 'Something went wrong. Please try again.',
    chat_typing: 'Zeno is thinking...',

    // B2: Product cards
    product_card_select: 'Choose this plan',
    product_card_recommended: 'Recommended',

    // B2: Quote card
    quote_card_title: 'Your quote',
    quote_card_coverages: 'Included coverages:',
    quote_card_valid_until: 'Valid until:',
    quote_card_accept: 'Accept quote',
    quote_card_modify: 'Modify',

    // B2: Question card
    question_progress: 'Question {answered} of {total}',
    question_continue: 'Continue',
    question_submit: 'Submit',
    question_type_placeholder: 'Type your answer...',
    question_number_placeholder: 'Enter a number',

    // B2: BD result card
    bd_result_continue: 'Yes, continue',
    bd_result_decline: 'No, thank you',
    bd_result_answered: 'Answer recorded',

    // B2: Policy issued card
    policy_congratulations: 'Congratulations!',
    policy_activating: 'Your policy is being activated.',
    policy_total_coverage: 'Total coverage',
    policy_email_confirmation: 'You will receive email confirmation within the next hours.',

    // B2: Inline data form
    data_form_save: 'Save',
    data_form_cnp_error: 'CNP must contain exactly 13 digits',
    data_form_email_error: 'Email address is not valid',
    data_form_phone_error: 'Phone number is not valid',
    data_form_invalid: 'The entered value is not valid',
    data_form_too_short: 'Minimum {min} characters',
    data_form_too_long: 'Maximum {max} characters',

    // B4: Customer dashboard
    dashboard_title: 'My account',
    dashboard_logout: 'Logout',
    dashboard_no_policies: 'No active policies',
    dashboard_no_policies_desc: 'Talk to Zeno to get an insurance policy.',
    dashboard_your_policy: 'Your policy',
    dashboard_total_coverage: 'Total coverage',
    dashboard_next_payment: 'Next payment',
    dashboard_documents: 'Documents',
    policy_pending: 'Your policy is being activated',
    policy_active: 'Active',
    action_chat: 'Talk to Zeno',
    action_download: 'Download policy',
    action_referral: 'Refer a friend',
    document_policy: 'Policy PDF',
    document_dnt: 'Suitability report (DNT)',
    document_receipt: 'Payment receipt',
    document_unavailable: 'Available after activation',
    magic_link_sent: 'Check your email. We sent you an access link.',
    magic_link_button: 'Send access link',
    magic_link_sending: 'Sending...',
    magic_link_error: 'Could not send the link. Please try again.',
  },
}

export function t(key: string, lang: Language): string {
  const value = translations[lang]?.[key]
  return typeof value === 'string' ? value : key
}
