'use client'

/**
 * Document Library (T25, P5.5)
 *
 * Renders BOTH document families from lib/documents/library — registry
 * artifacts (signed/acknowledged/generated) and uploads — grouped under
 * product headers, with open-in-viewer (new tab) and download links
 * through the family's serving route.
 */

import { FileText, Download, ExternalLink } from 'lucide-react'
import { useLanguage } from '@/lib/i18n/language-context'

export interface LibraryItemView {
  id: string
  family: 'registry' | 'upload'
  kind: string
  version: number | null
  language: string | null
  createdAt: string
  acknowledgedAt: string | null
  url: string
}

export interface LibraryGroupView {
  productId: string | null
  productName: Record<string, string> | null
  items: LibraryItemView[]
}

const KIND_LABELS: Record<string, { ro: string; en: string }> = {
  IPID: { ro: 'Document de informare (IPID)', en: 'Product information (IPID)' },
  TERMS: { ro: 'Termeni și condiții', en: 'Terms and conditions' },
  SUITABILITY_REPORT: { ro: 'Raport de suitabilitate (DNT)', en: 'Suitability report (DNT)' },
  PAYMENT_RECEIPT: { ro: 'Chitanță de plată', en: 'Payment receipt' },
  POLICY_SCHEDULE: { ro: 'Specificația poliței', en: 'Policy schedule' },
  id_card: { ro: 'Act de identitate (încărcat)', en: 'Identity document (uploaded)' },
}

function ItemRow({ item, lang }: { item: LibraryItemView; lang: 'ro' | 'en' }) {
  const label = KIND_LABELS[item.kind]?.[lang] ?? item.kind
  const locale = lang === 'ro' ? 'ro-RO' : 'en-GB'
  const meta = [
    item.version !== null ? `v${item.version}` : null,
    item.language ? item.language.toUpperCase() : null,
    new Date(item.createdAt).toLocaleDateString(locale),
    item.acknowledgedAt
      ? `${lang === 'ro' ? 'confirmat' : 'acknowledged'} ${new Date(item.acknowledgedAt).toLocaleDateString(locale)}`
      : null,
  ].filter(Boolean).join(' · ')

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <FileText size={18} className="shrink-0 text-sage" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-night">{label}</p>
          <p className="text-xs text-muted">{meta}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sage transition-colors hover:bg-sage/10"
        >
          <ExternalLink size={16} />
          {lang === 'ro' ? 'Deschide' : 'Open'}
        </a>
        <a
          href={item.url}
          download
          className="flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sage transition-colors hover:bg-sage/10"
        >
          <Download size={16} />
          {lang === 'ro' ? 'Descarcă' : 'Download'}
        </a>
      </div>
    </li>
  )
}

export default function DocumentLibrary({
  groups,
  ungrouped,
}: {
  groups: LibraryGroupView[]
  ungrouped: LibraryItemView[]
}) {
  const { lang: rawLang } = useLanguage()
  const lang: 'ro' | 'en' = rawLang === 'ro' ? 'ro' : 'en'

  if (groups.length === 0 && ungrouped.length === 0) {
    return (
      <div className="rounded-xl border border-warm-border bg-linen px-6 py-8 text-center">
        <p className="text-sm text-muted">
          {lang === 'ro'
            ? 'Nu ai documente disponibile încă. Vorbește cu Zeno pentru a obține o poliță.'
            : 'No documents available yet. Talk to Zeno to get a policy.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.productId ?? 'unknown'} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted">
            {group.productName?.[lang] ?? group.productName?.ro ?? (lang === 'ro' ? 'Produs' : 'Product')}
          </h2>
          <div className="rounded-xl border border-warm-border bg-white">
            <ul className="divide-y divide-warm-border">
              {group.items.map((item) => <ItemRow key={item.id} item={item} lang={lang} />)}
            </ul>
          </div>
        </section>
      ))}
      {ungrouped.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted">
            {lang === 'ro' ? 'Alte documente' : 'Other documents'}
          </h2>
          <div className="rounded-xl border border-warm-border bg-white">
            <ul className="divide-y divide-warm-border">
              {ungrouped.map((item) => <ItemRow key={item.id} item={item} lang={lang} />)}
            </ul>
          </div>
        </section>
      )}
    </div>
  )
}
