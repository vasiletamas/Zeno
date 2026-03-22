'use client'

/**
 * Users Management Client Component
 *
 * Table with all users, create operator modal, toggle active button.
 */

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

interface UserData {
  id: string
  email: string
  role: string
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}

interface UsersClientProps {
  users: UserData[]
}

export default function UsersClient({ users }: UsersClientProps) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateError('')

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, password: newPassword, role: 'OPERATOR' }),
      })

      if (!res.ok) {
        const data = await res.json()
        setCreateError(data.error ?? 'Eroare la creare')
        setCreating(false)
        return
      }

      setShowCreate(false)
      setNewEmail('')
      setNewPassword('')
      router.refresh()
    } catch {
      setCreateError('Eroare la creare')
    } finally {
      setCreating(false)
    }
  }

  async function handleToggleActive(userId: string, currentActive: boolean) {
    setTogglingId(userId)
    try {
      await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentActive }),
      })
      router.refresh()
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-medium text-night">Utilizatori</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-forest px-4 py-2 text-sm font-medium text-linen hover:bg-sage transition-colors"
        >
          Create Operator
        </button>
      </div>

      {/* Users table */}
      {users.length === 0 ? (
        <p className="rounded-lg border border-warm-border bg-white p-6 text-center text-sm text-muted">
          Nu exista utilizatori.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-warm-border bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-warm-border bg-linen/50">
                <th className="px-4 py-3 font-medium text-muted">Email</th>
                <th className="px-4 py-3 font-medium text-muted">Rol</th>
                <th className="px-4 py-3 font-medium text-muted">Activ</th>
                <th className="px-4 py-3 font-medium text-muted">Ultimul login</th>
                <th className="px-4 py-3 font-medium text-muted">Actiuni</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-warm-border last:border-0 hover:bg-linen/30 transition-colors"
                >
                  <td className="px-4 py-3 text-night">{user.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        user.role === 'ADMIN'
                          ? 'bg-forest/10 text-forest'
                          : user.role === 'OPERATOR'
                            ? 'bg-sage/10 text-sage'
                            : 'bg-muted/10 text-muted'
                      }`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        user.isActive ? 'bg-sage' : 'bg-muted'
                      }`}
                    />
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {user.lastLoginAt
                      ? new Date(user.lastLoginAt).toLocaleString('ro-RO')
                      : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(user.id, user.isActive)}
                      disabled={togglingId === user.id}
                      className="rounded-md border border-warm-border px-2 py-1 text-xs text-muted hover:bg-linen disabled:opacity-50"
                    >
                      {user.isActive ? 'Dezactiveaza' : 'Activeaza'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create operator modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/40">
          <div className="mx-4 w-full max-w-[400px] rounded-lg border border-warm-border bg-white p-6">
            <h3 className="mb-4 text-lg font-medium text-night">Creaza Operator</h3>

            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-night">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage focus:ring-1 focus:ring-sage"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-night">
                  Parola
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage focus:ring-1 focus:ring-sage"
                />
              </div>

              {createError && (
                <p className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">
                  {createError}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-md bg-forest px-4 py-2 text-sm font-medium text-linen hover:bg-sage transition-colors disabled:opacity-50"
                >
                  {creating ? 'Se creeaza...' : 'Creaza'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false)
                    setCreateError('')
                  }}
                  className="rounded-md border border-warm-border px-4 py-2 text-sm text-muted hover:bg-linen transition-colors"
                >
                  Anuleaza
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
