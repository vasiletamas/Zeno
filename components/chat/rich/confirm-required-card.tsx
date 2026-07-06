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

export const CONFIRMABLE_TOOLS = ['sign_dnt', 'accept_quote', 'write_question_answer', 'modify_answer'] as const

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
}

export function buildConfirmAction(tool: string, confirmToken: string, args: Record<string, unknown> = {}): UIAction | null {
  if (!(CONFIRMABLE_TOOLS as readonly string[]).includes(tool)) return null
  // sign_dnt: clicking the consent-labelled CTA IS the explicit grant (B1.5) —
  // the consent object is material, so it must match the original call's args.
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
