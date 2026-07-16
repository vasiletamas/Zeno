'use client'

import type { Language } from '@/lib/i18n/translations'

/**
 * Visible fallback for uiAction types the renderer has no case for (T29):
 * `default: return null` silently dropped show_document_upload/show_otp_entry
 * while the agent told the customer to use the control (2026-07-15, conv
 * cmrm3fgku00056g0y4eb2hsme). An unknown type must never be silent again —
 * the parity test and the unrendered_ui_action check catch it offline, this
 * card and the console line surface it live.
 */
export function UnknownActionCard({ type, language }: { type: string; language: Language }) {
  console.error('[rich-content] unrendered uiAction type', type)
  return (
    <div className="bg-soft-white border border-warm-border rounded-xl p-4">
      <p className="text-[14px] text-muted">
        {language === 'ro'
          ? `Această acțiune nu poate fi afișată încă (tip: ${type}).`
          : `This action can't be displayed yet (type: ${type}).`}
      </p>
    </div>
  )
}
