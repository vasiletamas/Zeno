/**
 * Agent Config Page — ADMIN only
 *
 * Server component. Loads all agents + model catalog.
 * Renders one config card per agent.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import AgentConfigRow from '@/components/admin/agent-config-row'

export default async function AgentsPage() {
  // ADMIN-only check
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) redirect('/admin/login')
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') redirect('/admin')

  const [agents, modelCatalog] = await Promise.all([
    prisma.agent.findMany({ orderBy: { name: 'asc' } }),
    prisma.modelCatalog.findMany({
      where: { isActive: true },
      orderBy: [{ provider: 'asc' }, { displayName: 'asc' }],
    }),
  ])

  // Serialize for client components
  const serializedAgents = JSON.parse(JSON.stringify(agents))
  const serializedModels = modelCatalog.map((m) => ({
    provider: m.provider,
    modelId: m.modelId,
    displayName: m.displayName,
  }))

  return (
    <div>
      <h2 className="mb-6 text-xl font-medium text-night">Agenti AI</h2>

      <div className="flex flex-col gap-6">
        {serializedAgents.map((agent: {
          id: string
          slug: string
          name: string
          type: string
          provider: string
          model: string
          fallbackProvider: string | null
          fallbackModel: string | null
          temperature: number
          maxTokens: number
          isActive: boolean
        }) => (
          <AgentConfigRow
            key={agent.id}
            agent={agent}
            models={serializedModels}
          />
        ))}

        {agents.length === 0 && (
          <p className="rounded-lg border border-warm-border bg-white p-6 text-center text-sm text-muted">
            Nu exista agenti configurati.
          </p>
        )}
      </div>
    </div>
  )
}
