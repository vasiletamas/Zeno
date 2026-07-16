'use client'

import { ShieldCheck } from 'lucide-react'
import type { Language } from '@/lib/i18n/translations'
import type { UIAction } from '@/lib/chat/action-adapter'

/**
 * Consumer for the gateway's confirm_required ui_action (A3 erratum 5 / M4):
 * the GUI renders this dialog on the first click of a confirmable commit and
 * the confirm button round-trips the SAME commit with the gateway-issued
 * token — buttons never self-confirm.
 */

// P2-15: EVERY requiresConfirmation commit renders a card — the four cancel/
// change commits previously had NO carrier for their token (the P0-6 class:
// the gateway asked for confirmation nothing could deliver).
export const CONFIRMABLE_TOOLS = ['sign_dnt', 'accept_quote', 'write_question_answer', 'modify_answer', 'sign_medical_declarations', 'cancel_quote', 'cancel_application', 'change_payment_option', 'request_cancellation'] as const

const COPY: Record<(typeof CONFIRMABLE_TOOLS)[number], { title: { ro: string; en: string }; body: { ro: string; en: string }; cta: { ro: string; en: string } }> = {
  sign_dnt: {
    title: { ro: 'Confirmă semnarea', en: 'Confirm signing' },
    body: { ro: 'Semnezi analiza de nevoi (DNT)? Semnătura confirmă că răspunsurile îți aparțin și include acordul tău pentru prelucrarea datelor (GDPR) și confirmarea că ai înțeles că ești asistat de un sistem AI.', en: 'Sign the demands-and-needs analysis (DNT)? Your signature confirms the answers are yours and includes your consent to data processing (GDPR) and your acknowledgment of the AI-assistance disclosure.' },
    cta: { ro: 'Semnează și îmi dau acordul', en: 'Sign and consent' },
  },
  accept_quote: {
    title: { ro: 'Confirmă acceptarea ofertei', en: 'Confirm quote acceptance' },
    body: { ro: 'Accepți această ofertă? După acceptare urmează plata primei rate — polița se emite la prima plată reușită.', en: 'Accept this quote? The first installment payment follows — the policy is issued at the first successful payment.' },
    cta: { ro: 'Accept oferta', en: 'Accept quote' },
  },
  // C1.5 sensitive (BD medical) answers: the consequence plan demands the
  // customer's explicit confirmation — before P0-6 these rendered NO card and
  // the application deadlocked at the first medical question (2026-07-06).
  write_question_answer: {
    title: { ro: 'Confirmă răspunsul declarat', en: 'Confirm your declared answer' },
    body: { ro: 'Acesta este un răspuns sensibil din declarația ta medicală. Confirmi că răspunsul afișat este corect și îți aparține?', en: 'This is a sensitive answer in your medical declaration. Do you confirm the displayed answer is correct and yours?' },
    cta: { ro: 'Confirm răspunsul', en: 'Confirm answer' },
  },
  modify_answer: {
    title: { ro: 'Confirmă modificarea răspunsului', en: 'Confirm the answer change' },
    body: { ro: 'Modifici un răspuns sensibil din declarația ta medicală. Confirmi noua valoare? Răspunsurile dependente pot fi reevaluate.', en: 'You are changing a sensitive answer in your medical declaration. Confirm the new value? Dependent answers may be re-evaluated.' },
    cta: { ro: 'Confirm modificarea', en: 'Confirm change' },
  },
  // T6.D3 deviation (2026-07-06): ONE batch signature over the whole medical
  // declaration replaces the per-answer cards above for FIRST writes.
  sign_medical_declarations: {
    title: { ro: 'Semnează declarația medicală', en: 'Sign the medical declaration' },
    body: { ro: 'Confirmi printr-o singură semnătură că toate răspunsurile medicale rezumate mai sus îți aparțin și sunt corecte? Modificarea ulterioară a unui răspuns anulează semnătura și cere una nouă.', en: 'Confirm with one signature that all the medical answers summarized above are yours and correct? Changing an answer later voids the signature and requires a new one.' },
    cta: { ro: 'Semnez declarația', en: 'Sign the declaration' },
  },
  cancel_quote: {
    title: { ro: 'Confirmă anularea ofertei', en: 'Confirm quote cancellation' },
    body: { ro: 'Anulezi oferta emisă? Anularea este definitivă — pentru un preț nou reluăm cererea de la selecția acoperirii.', en: 'Cancel the issued quote? Cancellation is final — a new price requires restarting from coverage selection.' },
    cta: { ro: 'Anulez oferta', en: 'Cancel the quote' },
  },
  cancel_application: {
    title: { ro: 'Confirmă anularea cererii', en: 'Confirm application cancellation' },
    body: { ro: 'Anulezi cererea curentă? O cerere anulată nu poate fi reluată — se poate deschide oricând una nouă.', en: 'Cancel the current application? A cancelled application cannot be resumed — a new one can be opened anytime.' },
    cta: { ro: 'Anulez cererea', en: 'Cancel the application' },
  },
  change_payment_option: {
    title: { ro: 'Confirmă schimbarea frecvenței de plată', en: 'Confirm the payment frequency change' },
    body: { ro: 'Schimbi frecvența de plată aleasă? Ratele se recalculează de la prima plată neîncasată.', en: 'Change the elected payment frequency? Installments recalculate from the first uncaptured payment.' },
    cta: { ro: 'Schimb frecvența', en: 'Change frequency' },
  },
  request_cancellation: {
    title: { ro: 'Confirmă renunțarea la poliță', en: 'Confirm the policy cancellation' },
    body: { ro: 'Renunți la polița activă în perioada de renunțare (free-look)? Cererea se procesează de un coleg și primele plătite se returnează conform condițiilor.', en: 'Cancel the active policy within the free-look window? A colleague processes the request and paid premiums are returned per the terms.' },
    cta: { ro: 'Renunț la poliță', en: 'Cancel the policy' },
  },
}

export function buildConfirmAction(tool: string, confirmToken: string, args: Record<string, unknown> = {}): UIAction | null {
  if (!(CONFIRMABLE_TOOLS as readonly string[]).includes(tool)) return null
  // sign_dnt: clicking the consent-labelled CTA IS the explicit grant (B1.5) —
  // the consent object is material, so it must match the original call's args.
  // Since T7 this card is the AGENT-PATH FALLBACK only: the primary flow is the
  // auto-emitted show_dnt_review card (gui clicks are confirmed by construction,
  // so a GUI sign never produces the requires_confirmation this card consumes).
  if (tool === 'sign_dnt') return { type: tool, payload: { ...args, confirmToken, consent: { gdpr: true, aiDisclosure: true } } }
  // D2.5: the token is bound to the material args hash — the original args
  // (e.g. accept_quote's paymentOption) must ride the confirm round-trip.
  return { type: tool, payload: { ...args, confirmToken } }
}

interface ConfirmRequiredCardProps {
  tool: string
  confirmToken: string
  args?: Record<string, unknown>
  onConfirm: (action: UIAction) => void
  language: Language
  isAnswered?: boolean
  isLoading?: boolean
}

export function ConfirmRequiredCard({
  tool,
  confirmToken,
  args = {},
  onConfirm,
  language,
  isAnswered = false,
  isLoading = false,
}: ConfirmRequiredCardProps) {
  const copy = COPY[tool as (typeof CONFIRMABLE_TOOLS)[number]]
  if (!copy) return null
  const action = buildConfirmAction(tool, confirmToken, args)

  return (
    <div className="bg-linen border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <ShieldCheck className="w-5 h-5 text-sage" />
        </div>
        <div className="flex-1">
          <p className="text-[15px] font-medium text-night leading-[1.5]">
            {language === 'ro' ? copy.title.ro : copy.title.en}
          </p>
          <p className="text-[14px] text-night/70 leading-[1.5] mt-1">
            {language === 'ro' ? copy.body.ro : copy.body.en}
          </p>
          <button
            type="button"
            disabled={isAnswered || isLoading || !action}
            onClick={() => action && onConfirm(action)}
            className="mt-3 px-4 py-2 rounded-lg bg-sage text-white text-[14px] font-medium disabled:opacity-50"
          >
            {language === 'ro' ? copy.cta.ro : copy.cta.en}
          </button>
        </div>
      </div>
    </div>
  )
}
