'use client'

/**
 * Document List (D4.6 — registry-backed)
 *
 * Renders the customer's Document-registry rows with real download links
 * through the single serving route. Kind labels are localized here (M6 —
 * the registry stores codes only); the alert() placeholders died.
 */

import { FileText, Download } from 'lucide-react'
import { useLanguage } from '@/lib/i18n/language-context'

export interface DocumentRow {
  id: string
  kind: string
  version: number
  language: string
  generatedAt: string
}

const KIND_LABELS: Record<string, { ro: string; en: string }> = {
  IPID: { ro: 'Document de informare (IPID)', en: 'Product information (IPID)' },
  TERMS: { ro: 'Termeni și condiții', en: 'Terms and conditions' },
  SUITABILITY_REPORT: { ro: 'Raport de suitabilitate (DNT)', en: 'Suitability report (DNT)' },
  PAYMENT_RECEIPT: { ro: 'Chitanță de plată', en: 'Payment receipt' },
  POLICY_SCHEDULE: { ro: 'Specificația poliței', en: 'Policy schedule' },
}

export default function DocumentList({ documents }: { documents: DocumentRow[] }) {
  const { lang } = useLanguage()

  if (documents.length === 0) {
    return (
      <div className="rounded-xl border border-warm-border bg-linen px-6 py-8 text-center">
        <p className="text-sm text-muted">
          {lang === 'ro'
            ? 'Nu ai documente disponibile încă.'
            : 'No documents available yet.'}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-warm-border bg-white">
      <ul className="divide-y divide-warm-border">
        {documents.map((doc) => {
          const label = KIND_LABELS[doc.kind]?.[lang === 'ro' ? 'ro' : 'en'] ?? doc.kind
          return (
            <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <FileText size={18} className="shrink-0 text-sage" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-night">{label}</p>
                  <p className="text-xs text-muted">
                    v{doc.version} · {doc.language.toUpperCase()} · {new Date(doc.generatedAt).toLocaleDateString(lang === 'ro' ? 'ro-RO' : 'en-GB')}
                  </p>
                </div>
              </div>
              <a
                href={`/api/documents/${doc.id}`}
                download
                className="flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sage transition-colors hover:bg-sage/10"
              >
                <Download size={16} />
                Download
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
