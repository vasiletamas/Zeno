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
      no_candidate_product: 'Mai întâi alegem produsul despre care vorbim.',
      invalid_level_for_tier: 'Nivelul ales nu există pentru acest pachet — alegem unul valid.',
      illegal_status_transition: 'Această acțiune nu mai este posibilă pentru aplicația curentă.',
      with_underwriter: 'Cererea este în analiză la asigurător — revenim imediat ce avem un răspuns.',
      requires_consent: 'Avem nevoie mai întâi de acordul tău.',
      gdpr_processing_withdrawn: 'Consimțământul pentru prelucrarea datelor a fost retras — pentru a continua, este nevoie de un nou acord.',
      dnt_not_signed: 'Analiza de nevoi trebuie semnată mai întâi.',
      dnt_incomplete: 'Mai sunt întrebări de completat în analiza de nevoi.',
      dnt_expired: 'Analiza de nevoi a expirat — o refacem rapid.',
      dnt_session_already_active: 'Există deja o sesiune de analiză în curs — o continuăm pe aceea.',
      dnt_session_incomplete: 'Mai sunt întrebări de completat în sesiunea de analiză.',
      no_active_dnt_session: 'Nu există o sesiune de analiză activă — deschidem una întâi.',
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
      actor_not_permitted: 'Această operațiune este rezervată echipei de operatori.',
      work_item_not_found: 'Sarcina de lucru nu a fost găsită.',
      work_item_not_open: 'Sarcina de lucru a fost deja rezolvată sau închisă.',
      permission_denied: 'Nu ai permisiunea pentru această acțiune.',
      not_exposed: 'Această acțiune nu este disponibilă în acest moment.',
      validity_dependency_changed: 'O alegere anterioară s-a schimbat, așa că acest răspuns trebuie reconfirmat.',
      removed_by_branch: 'Această întrebare nu mai face parte din traseul actual al cererii.',
      addon_ineligible_medical_history: 'Istoricul medical declarat nu permite adăugarea opțiunii de tratament în străinătate.',
      ineligible_age_minimum: 'Produsul este disponibil de la vârsta de 18 ani.',
      ineligible_age_maximum: 'Produsul este disponibil până la vârsta de 64 de ani.',
      ineligible_residency: 'Produsul este disponibil doar pentru rezidenții din România.',
      addon_age_band_unavailable: 'Opțiunea de tratament în străinătate nu este disponibilă pentru această vârstă.',
      one_facet_per_commit: 'Schimbăm pe rând: întâi pachetul, apoi nivelul, apoi opțiunea suplimentară.',
      eligibility_facts_missing: 'Mai avem nevoie de câteva date pentru a verifica eligibilitatea (de exemplu vârsta).',
      suitability_warning_unacknowledged: 'Produsul nu se potrivește complet nevoilor declarate — putem continua doar după ce confirmi că ai înțeles diferența.',
      no_suitability_warning_pending: 'Nu există o avertizare de potrivire de confirmat.',
      product_has_no_investment_component: 'Protect nu are componentă de investiție — este o asigurare de protecție.',
      severe_conditions_demand_needs_addon: 'Pentru afecțiuni medicale grave, potrivirea vine din opțiunea de tratament în străinătate.',
      compliance_block: 'Pașii de conformitate nu sunt încheiați — analiza de nevoi și acordul GDPR trebuie să fie valide.',
      application_frozen: 'Cererea a fost înghețată la emiterea ofertei — pentru schimbări, anulăm oferta și deschidem o cerere nouă.',
      manual_underwriting: 'Cererea necesită analiza unui subscriitor — revenim imediat ce avem un răspuns.',
      no_due_installment: 'Nu există nicio rată scadentă de plătit — planul de plată este achitat la zi.',
      schedule_already_captured: 'Prima rată a fost deja încasată — frecvența de plată nu mai poate fi schimbată pentru acest plan.',
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
      no_candidate_product: 'Let’s choose the product we are talking about first.',
      invalid_level_for_tier: 'That level does not exist for this package — let’s pick a valid one.',
      illegal_status_transition: 'This action is no longer possible for the current application.',
      with_underwriter: 'The application is with the underwriter — we will continue as soon as there is an answer.',
      requires_consent: 'We need your consent first.',
      gdpr_processing_withdrawn: 'Data-processing consent has been withdrawn — a new consent is required to continue.',
      dnt_not_signed: 'The needs analysis must be signed first.',
      dnt_incomplete: 'A few needs-analysis questions are still unanswered.',
      dnt_expired: 'The needs analysis has expired — we can redo it quickly.',
      dnt_session_already_active: 'A needs-analysis session is already in progress — we continue that one.',
      dnt_session_incomplete: 'A few needs-analysis session questions are still unanswered.',
      no_active_dnt_session: 'There is no active needs-analysis session — we open one first.',
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
      actor_not_permitted: 'This operation is reserved for the operator team.',
      work_item_not_found: 'The work item could not be found.',
      work_item_not_open: 'The work item has already been resolved or closed.',
      permission_denied: 'You do not have permission for this action.',
      not_exposed: 'This action is not available right now.',
      validity_dependency_changed: 'An earlier choice changed, so this answer needs to be confirmed again.',
      removed_by_branch: 'This question is no longer part of the current application path.',
      addon_ineligible_medical_history: 'The declared medical history does not allow adding the treatment-abroad option.',
      ineligible_age_minimum: 'The product is available from age 18.',
      ineligible_age_maximum: 'The product is available up to age 64.',
      ineligible_residency: 'The product is only available to residents of Romania.',
      addon_age_band_unavailable: 'The treatment-abroad option is not available for this age.',
      one_facet_per_commit: 'One change at a time: first the package, then the level, then the add-on.',
      eligibility_facts_missing: 'A few more details are needed to check eligibility (for example your age).',
      suitability_warning_unacknowledged: 'The product does not fully match the declared needs — we can continue only after you confirm you understand the difference.',
      no_suitability_warning_pending: 'There is no suitability warning to acknowledge.',
      product_has_no_investment_component: 'Protect has no investment component — it is a protection product.',
      severe_conditions_demand_needs_addon: 'For severe medical conditions, the fit comes from the treatment-abroad option.',
      compliance_block: 'The compliance steps are not complete — the needs analysis and GDPR consent must be valid.',
      application_frozen: 'The application froze when the quote was issued — to change it, we cancel the quote and open a new application.',
      manual_underwriting: 'The application needs an underwriter\'s review — we will continue as soon as there is an answer.',
      no_due_installment: 'There is no due installment to pay — the payment plan is fully up to date.',
      schedule_already_captured: 'The first installment was already captured — the payment frequency can no longer be changed on this plan.',
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
