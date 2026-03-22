/**
 * User Management Page — ADMIN only
 *
 * Server component. Loads all users. Create operator + toggle active.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import UsersClient from './client'

export default async function UsersPage() {
  // ADMIN-only check
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) redirect('/admin/login')
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') redirect('/admin')

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
  })

  const serialized = JSON.parse(JSON.stringify(users))

  return <UsersClient users={serialized} />
}
