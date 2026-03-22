/**
 * Customer Dashboard Layout (server component)
 *
 * Verifies auth via zeno_auth cookie + JWT. Checks CUSTOMER role.
 * Redirects to /dashboard/login if unauthorized.
 * Renders header (Zeno wordmark + "Contul meu" + logout) + children.
 * Max-width: 640px centered. Background: Soft White.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import DashboardHeader from '@/components/dashboard/dashboard-header'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value

  if (!token) {
    redirect('/dashboard/login')
  }

  const payload = await verifyToken(token)
  if (!payload) {
    redirect('/dashboard/login')
  }

  // Must be CUSTOMER
  if (payload.role !== 'CUSTOMER') {
    redirect('/dashboard/login')
  }

  // Load user + customer data
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: { customer: true },
  })

  if (!user || !user.isActive) {
    redirect('/dashboard/login')
  }

  return (
    <div className="min-h-screen bg-soft-white">
      <DashboardHeader
        email={payload.email}
        customerName={user.customer?.name ?? undefined}
      />

      <main className="mx-auto w-full max-w-[640px] px-4 py-6">
        {children}
      </main>
    </div>
  )
}
