'use client'

/**
 * Customer Dashboard Login — Magic Link Request
 *
 * Email input + "Trimite link de acces" button.
 * Posts to /api/auth/magic-link.
 * On success: shows confirmation message.
 * Styled: centered form, max-width 400px, Zeno brand tokens.
 */

import { useState, type FormEvent } from 'react'
import { useLanguage } from '@/lib/i18n/language-context'
import { t } from '@/lib/i18n/translations'

export default function DashboardLoginPage() {
  const { lang, toggleLanguage } = useLanguage()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? t('magic_link_error', lang))
        setLoading(false)
        return
      }

      setSent(true)
      setLoading(false)
    } catch {
      setError(t('magic_link_error', lang))
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-soft-white px-4">
      <div className="w-full max-w-[400px] rounded-xl border border-warm-border bg-white p-8">
        <div className="mb-8 text-center">
          <h1
            className="font-display text-2xl text-forest"
            style={{ letterSpacing: '-0.5px' }}
          >
            Zeno
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t('dashboard_title', lang)}
          </p>
        </div>

        {sent ? (
          <div className="rounded-lg bg-sage/10 px-4 py-6 text-center">
            <p className="text-sm font-medium text-forest">
              {t('magic_link_sent', lang)}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1 block text-sm font-medium text-night"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-[10px] border border-warm-border bg-soft-white px-4 py-3 text-[15px] text-night outline-none focus:border-sage focus:ring-1 focus:ring-sage"
                placeholder="email@exemplu.ro"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-error/10 px-3 py-2 text-sm text-error">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="min-h-[44px] rounded-[10px] bg-forest px-6 py-3 text-[15px] font-medium text-linen transition-colors hover:bg-sage disabled:opacity-50"
            >
              {loading
                ? t('magic_link_sending', lang)
                : t('magic_link_button', lang)}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={toggleLanguage}
            className="text-sm text-muted transition-colors hover:text-night"
          >
            {lang === 'ro' ? 'English' : 'Romana'}
          </button>
        </div>
      </div>
    </div>
  )
}
