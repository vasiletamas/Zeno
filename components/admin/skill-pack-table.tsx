'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export interface SkillPackData {
  id: string
  slug: string
  name: string
  category: string
  description: string
  priority: number
  isActive: boolean
}

interface SkillPackTableProps {
  skillPacks: SkillPackData[]
}

type CategoryFilter = 'ALL' | 'PRODUCT' | 'WORKFLOW_PHASE' | 'POST_SALE'

const CATEGORY_TABS: CategoryFilter[] = ['ALL', 'PRODUCT', 'WORKFLOW_PHASE', 'POST_SALE']

const CATEGORY_BADGE: Record<string, string> = {
  PRODUCT: 'bg-zeno-500/10 text-zeno-600',
  WORKFLOW_PHASE: 'bg-sage/10 text-forest',
  POST_SALE: 'bg-amber-100 text-amber-700',
}

export default function SkillPackTable({ skillPacks }: SkillPackTableProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<CategoryFilter>('ALL')
  const [toggling, setToggling] = useState<string | null>(null)

  const visible =
    filter === 'ALL' ? skillPacks : skillPacks.filter((p) => p.category === filter)

  async function handleToggle(id: string) {
    setToggling(id)
    try {
      await fetch(`/api/admin/skill-packs/${id}/toggle`, { method: 'POST' })
      router.refresh()
    } finally {
      setToggling(null)
    }
  }

  return (
    <div>
      {/* Category filter tabs */}
      <div className="mb-4 flex gap-1 rounded-lg border border-warm-border bg-cloud-50 p-1 w-fit">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === tab
                ? 'bg-white text-night shadow-sm'
                : 'text-muted hover:text-night'
            }`}
          >
            {tab === 'ALL' ? 'All' : tab.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-warm-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-warm-border bg-cloud-50">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">
                Slug
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">
                Category
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">
                Priority
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">
                Active
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-warm-border">
            {visible.map((pack) => (
              <tr key={pack.id} className="hover:bg-cloud-50 transition-colors">
                <td className="px-4 py-3 text-night font-medium">{pack.name}</td>
                <td className="px-4 py-3">
                  <code className="rounded bg-cloud-100 px-1.5 py-0.5 font-mono text-xs text-night">
                    {pack.slug}
                  </code>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      CATEGORY_BADGE[pack.category] ?? 'bg-cloud-100 text-night'
                    }`}
                  >
                    {pack.category.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-night">{pack.priority}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleToggle(pack.id)}
                    disabled={toggling === pack.id}
                    aria-label={pack.isActive ? 'Deactivate' : 'Activate'}
                    className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${
                      pack.isActive ? 'bg-sage' : 'bg-warm-border'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                        pack.isActive ? 'left-[22px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/skill-packs?edit=${pack.id}`}
                    className="rounded-md border border-warm-border px-3 py-1 text-xs font-medium text-night hover:bg-linen transition-colors"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}

            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-muted"
                >
                  No skill packs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
