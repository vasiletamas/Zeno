'use client'

/**
 * Admin Login Page
 *
 * Email + password form for ADMIN/OPERATOR users.
 * Posts to /api/auth/login, redirects to /admin on success.
 */

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        setError('Email sau parola incorecta')
        setLoading(false)
        return
      }

      router.push('/admin')
    } catch {
      setError('Email sau parola incorecta')
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-soft-white">
      <div className="w-full max-w-[400px] rounded-lg border border-warm-border bg-white p-8">
        <div className="mb-8 text-center">
          <h1 className="font-display text-2xl text-forest">Zeno Admin</h1>
          <p className="mt-1 text-sm text-muted">Autentificare</p>
        </div>

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
              className="w-full rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage focus:ring-1 focus:ring-sage"
              placeholder="admin@zeno.ro"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-night"
            >
              Parola
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage focus:ring-1 focus:ring-sage"
            />
          </div>

          {error && (
            <p className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-forest px-4 py-2.5 text-sm font-medium text-linen transition-colors hover:bg-sage disabled:opacity-50"
          >
            {loading ? 'Se conecteaza...' : 'Conectare'}
          </button>
        </form>
      </div>
    </div>
  )
}
