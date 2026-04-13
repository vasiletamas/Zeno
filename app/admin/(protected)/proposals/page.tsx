/**
 * Improvement Proposals Admin Page — ADMIN only
 *
 * Server component. Lists proposals or shows detail when ?detail=<id>.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import ProposalTable from '@/components/admin/proposal-table'
import ProposalDetail from '@/components/admin/proposal-detail'
import type { ProposalData } from '@/components/admin/proposal-table'
import type { ProposalFullData } from '@/components/admin/proposal-detail'

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ detail?: string }>
}) {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) redirect('/admin/login')
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') redirect('/admin')

  const { detail } = await searchParams

  // Detail mode
  if (detail) {
    const proposal = await prisma.improvementProposal.findUnique({ where: { id: detail } })
    if (!proposal) redirect('/admin/proposals')

    const proposalData: ProposalFullData = {
      id: proposal.id,
      type: proposal.type,
      title: proposal.title,
      description: proposal.description,
      diff: proposal.diff as Record<string, unknown>,
      evidence: proposal.evidence as { conversationIds: string[]; sampleSize: number; confidence: number },
      status: proposal.status,
      adminNotes: proposal.adminNotes,
      createdAt: proposal.createdAt.toISOString(),
    }

    return (
      <div>
        <h2 className="mb-6 text-xl font-medium text-night">Proposal Detail</h2>
        <ProposalDetail proposal={proposalData} />
      </div>
    )
  }

  // List mode
  const proposals = await prisma.improvementProposal.findMany({
    orderBy: { createdAt: 'desc' },
  })

  const proposalList: ProposalData[] = proposals.map((p) => ({
    id: p.id,
    type: p.type,
    title: p.title,
    status: p.status,
    evidence: p.evidence as { sampleSize: number; confidence: number },
    createdAt: p.createdAt.toISOString(),
  }))

  return (
    <div>
      <h2 className="mb-6 text-xl font-medium text-night">Improvement Proposals</h2>
      <ProposalTable proposals={proposalList} />
    </div>
  )
}
