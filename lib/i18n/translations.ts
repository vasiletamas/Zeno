export type Language = 'ro' | 'en'

export const translations: Record<Language, Record<string, string>> = {
  ro: {
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
  return translations[lang]?.[key] ?? key
}
