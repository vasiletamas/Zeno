'use client'

/**
 * Quick Actions
 *
 * 3 action cards: "Vorbeste cu Zeno", "Descarca polita", "Recomanda un prieten".
 * Each card: bg-soft-white border border-warm-border rounded-xl p-4, Lucide icon, text.
 * Touch targets: 44px minimum.
 */

import { useRouter } from 'next/navigation'
import { MessageCircle, Download, Share2 } from 'lucide-react'
import { useLanguage } from '@/lib/i18n/language-context'
import { t } from '@/lib/i18n/translations'

interface QuickActionsProps {
  policyActive: boolean
}

export default function QuickActions({ policyActive }: QuickActionsProps) {
  const router = useRouter()
  const { lang } = useLanguage()

  function handleChat() {
    router.push('/chat')
  }

  function handleDownload() {
    if (!policyActive) {
      alert(
        lang === 'ro'
          ? 'Disponibil dupa activarea politei'
          : 'Available after policy activation',
      )
      return
    }
    // Placeholder for actual download — Phase C
    alert(
      lang === 'ro'
        ? 'Descarcarea va fi disponibila in curand'
        : 'Download will be available soon',
    )
  }

  function handleReferral() {
    alert(
      lang === 'ro' ? 'In curand' : 'Coming soon',
    )
  }

  const actions = [
    {
      key: 'chat',
      icon: MessageCircle,
      label: t('action_chat', lang),
      onClick: handleChat,
    },
    {
      key: 'download',
      icon: Download,
      label: t('action_download', lang),
      onClick: handleDownload,
    },
    {
      key: 'referral',
      icon: Share2,
      label: t('action_referral', lang),
      onClick: handleReferral,
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {actions.map((action) => (
        <button
          key={action.key}
          onClick={action.onClick}
          className="flex min-h-[44px] items-center gap-3 rounded-xl border border-warm-border bg-soft-white p-4 text-left transition-colors hover:bg-linen sm:flex-col sm:items-start sm:gap-2"
        >
          <action.icon size={20} className="shrink-0 text-sage" />
          <span className="text-sm font-medium text-night">
            {action.label}
          </span>
        </button>
      ))}
    </div>
  )
}
