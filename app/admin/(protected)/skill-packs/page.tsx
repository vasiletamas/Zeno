/**
 * Skill Packs Admin Page — ADMIN only
 *
 * Server component. Lists all skill packs or shows the editor
 * when ?edit=<id> is present in the search params.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { getRegisteredToolNames } from '@/lib/tools/registry'
import SkillPackTable from '@/components/admin/skill-pack-table'
import SkillPackEditor from '@/components/admin/skill-pack-editor'
import type { SkillPackData } from '@/components/admin/skill-pack-table'
import type { SkillPackDetail } from '@/components/admin/skill-pack-editor'

export default async function SkillPacksPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>
}) {
  // ADMIN-only check
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) redirect('/admin/login')
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') redirect('/admin')

  const { edit } = await searchParams

  // Editor mode
  if (edit) {
    const pack = await prisma.skillPack.findUnique({ where: { id: edit } })
    if (!pack) redirect('/admin/skill-packs')

    const skillPackDetail: SkillPackDetail = {
      id: pack.id,
      slug: pack.slug,
      name: pack.name,
      category: pack.category,
      description: pack.description,
      promptSections: pack.promptSections as Record<string, string>,
      allowedTools: pack.allowedTools,
      constraints: pack.constraints ?? null,
      priority: pack.priority,
      isActive: pack.isActive,
    }

    const allToolNames = getRegisteredToolNames()

    return (
      <div>
        <h2 className="mb-6 text-xl font-medium text-night">Edit Skill Pack</h2>
        <SkillPackEditor skillPack={skillPackDetail} allToolNames={allToolNames} />
      </div>
    )
  }

  // List mode
  const packs = await prisma.skillPack.findMany({
    orderBy: [{ category: 'asc' }, { priority: 'desc' }, { name: 'asc' }],
  })

  const skillPacks: SkillPackData[] = packs.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category,
    description: p.description,
    priority: p.priority,
    isActive: p.isActive,
  }))

  return (
    <div>
      <h2 className="mb-6 text-xl font-medium text-night">Skill Packs</h2>
      <SkillPackTable skillPacks={skillPacks} />
    </div>
  )
}
