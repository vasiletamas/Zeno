/**
 * A/B Tests Admin Page — ADMIN only
 *
 * Server component. Lists and creates A/B tests.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import ABTestTable from '@/components/admin/ab-test-table'
import type { ABTestData } from '@/components/admin/ab-test-table'

export default async function ABTestsPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) redirect('/admin/login')
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') redirect('/admin')

  const [tests, skillPacks] = await Promise.all([
    prisma.aBTestVariant.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.skillPack.findMany({ where: { isActive: true }, select: { slug: true }, orderBy: { slug: 'asc' } }),
  ])

  const testData: ABTestData[] = tests.map((t) => ({
    id: t.id,
    name: t.name,
    skillPackSlugA: t.skillPackSlugA,
    skillPackSlugB: t.skillPackSlugB,
    splitRatio: t.splitRatio,
    isActive: t.isActive,
    conversationsA: t.conversationsA,
    conversationsB: t.conversationsB,
    startedAt: t.startedAt.toISOString(),
    endedAt: t.endedAt?.toISOString() ?? null,
  }))

  return (
    <div>
      <h2 className="mb-6 text-xl font-medium text-night">A/B Tests</h2>
      <ABTestTable tests={testData} skillPackSlugs={skillPacks.map((p) => p.slug)} />
    </div>
  )
}
