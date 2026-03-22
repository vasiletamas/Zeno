'use client'

import { useRouter } from 'next/navigation'

interface AdminHeaderProps {
  email: string
  role: 'ADMIN' | 'OPERATOR'
}

export default function AdminHeader({ email, role }: AdminHeaderProps) {
  const router = useRouter()

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/admin/login')
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-warm-border bg-soft-white px-6">
      <h1 className="text-lg font-medium text-forest">Zeno Admin</h1>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-night">{email}</span>
          <span
            className={`
              rounded-full px-2 py-0.5 text-xs font-medium
              ${
                role === 'ADMIN'
                  ? 'bg-forest/10 text-forest'
                  : 'bg-sage/10 text-sage'
              }
            `}
          >
            {role}
          </span>
        </div>

        <button
          onClick={handleLogout}
          className="rounded-md border border-warm-border px-3 py-1.5 text-sm text-muted hover:bg-linen transition-colors"
        >
          Logout
        </button>
      </div>
    </header>
  )
}
