'use client'

/**
 * Dashboard Header
 *
 * Zeno wordmark + "Contul meu" + logout button.
 * Uses brand tokens: forest bg for wordmark, warm border bottom.
 */

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { useLanguage } from '@/lib/i18n/language-context'
import { t } from '@/lib/i18n/translations'

interface DashboardHeaderProps {
  email: string
  customerName?: string
}

export default function DashboardHeader({
  email,
  customerName,
}: DashboardHeaderProps) {
  const router = useRouter()
  const { lang } = useLanguage()

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/dashboard/login')
  }

  return (
    <header className="border-b border-warm-border bg-soft-white">
      <div className="mx-auto flex max-w-[640px] items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <span
            className="font-display text-xl text-forest"
            style={{ letterSpacing: '-0.5px' }}
          >
            Zeno
          </span>
          <span className="text-sm text-muted">
            {t('dashboard_title', lang)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:inline">
            {customerName ?? email}
          </span>
          <button
            onClick={handleLogout}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted transition-colors hover:bg-linen hover:text-night"
            aria-label={t('dashboard_logout', lang)}
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>
    </header>
  )
}
