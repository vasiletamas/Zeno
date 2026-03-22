'use client'

/**
 * Document List
 *
 * Lists policy documents: Polita PDF, Raport suitabilitate (DNT), Chitanta plata.
 * For non-ACTIVE policies: shows unavailability message.
 * For ACTIVE: placeholder download links (actual PDFs in Phase C).
 */

import { FileText } from 'lucide-react'
import { useLanguage } from '@/lib/i18n/language-context'
import { t } from '@/lib/i18n/translations'

interface DocumentListProps {
  policyActive: boolean
}

interface DocumentItem {
  key: string
  labelKey: string
}

const DOCUMENTS: DocumentItem[] = [
  { key: 'policy', labelKey: 'document_policy' },
  { key: 'dnt', labelKey: 'document_dnt' },
  { key: 'receipt', labelKey: 'document_receipt' },
]

export default function DocumentList({ policyActive }: DocumentListProps) {
  const { lang } = useLanguage()

  return (
    <div>
      <h3 className="mb-3 text-lg font-medium text-night">
        {t('dashboard_documents', lang)}
      </h3>

      <div className="divide-y divide-warm-border rounded-xl border border-warm-border bg-soft-white">
        {DOCUMENTS.map((doc) => (
          <div
            key={doc.key}
            className="flex items-center justify-between px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <FileText size={20} className="shrink-0 text-muted" />
              <span className="text-sm font-medium text-night">
                {t(doc.labelKey, lang)}
              </span>
            </div>

            {policyActive ? (
              <button
                onClick={() =>
                  alert(
                    lang === 'ro'
                      ? 'Descarcarea va fi disponibila in curand'
                      : 'Download will be available soon',
                  )
                }
                className="min-h-[44px] rounded-lg px-3 py-2 text-sm font-medium text-sage transition-colors hover:bg-sage/10"
              >
                Download
              </button>
            ) : (
              <span className="text-xs text-muted">
                {t('document_unavailable', lang)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
