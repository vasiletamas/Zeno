/**
 * Admin Panel Layout (server component)
 *
 * Verifies auth via zeno_auth cookie + JWT. Checks ADMIN or OPERATOR role.
 * Redirects to /admin/login if unauthorized or inactive.
 * Renders sidebar + header + children. Max-width 1080px.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { verifyUserActive } from '@/lib/auth/middleware'
import AdminSidebar from '@/components/admin/admin-sidebar'
import AdminHeader from '@/components/admin/admin-header'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value

  if (!token) {
    redirect('/admin/login')
  }

  const payload = await verifyToken(token)
  if (!payload) {
    redirect('/admin/login')
  }

  // Must be ADMIN or OPERATOR
  const role = payload.role as 'ADMIN' | 'OPERATOR' | 'CUSTOMER'
  if (role !== 'ADMIN' && role !== 'OPERATOR') {
    redirect('/admin/login')
  }

  // Check isActive via DB
  const isActive = await verifyUserActive(payload.userId)
  if (!isActive) {
    redirect('/admin/login')
  }

  return (
    <div className="flex min-h-screen bg-soft-white">
      <AdminSidebar role={role} />

      <div className="flex flex-1 flex-col md:ml-0">
        <AdminHeader email={payload.email} role={role} />

        <main className="mx-auto w-full max-w-[1080px] flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
