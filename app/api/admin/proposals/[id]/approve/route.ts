/**
 * POST /api/admin/proposals/:id/approve
 *
 * Approve a proposal and apply the underlying change.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import type { ProposalDiff } from '@/lib/self-improvement/types'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const proposal = await prisma.improvementProposal.findUnique({ where: { id } })
    if (!proposal) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (proposal.status !== 'PENDING') {
      return NextResponse.json({ error: 'Proposal is not pending' }, { status: 400 })
    }

    const diff = proposal.diff as ProposalDiff

    // Compute baseline metrics before applying
    let baselineMetrics: { avgScore: number; sampleSize: number } | Record<string, never> = {}

    // Apply the change based on type
    switch (proposal.type) {
      case 'KNOWLEDGE_CREATE': {
        if (!diff.create) {
          return NextResponse.json({ error: 'Invalid diff for KNOWLEDGE_CREATE' }, { status: 400 })
        }
        const avgResult = await prisma.conversationScore.aggregate({
          _avg: { score: true },
          _count: { score: true },
        })
        baselineMetrics = {
          avgScore: avgResult._avg.score ?? 0,
          sampleSize: avgResult._count.score,
        }

        await prisma.agentKnowledge.create({
          data: {
            category: diff.create.category as 'OBJECTION_RESPONSE' | 'TOOL_SEQUENCE' | 'CONVERSATION_PATTERN' | 'PROMPT_FRAGMENT',
            trigger: diff.create.trigger,
            content: diff.create.content,
            productId: diff.create.productId ?? null,
            workflowStepCode: diff.create.workflowStepCode ?? null,
            successRate: 0,
            sampleSize: 0,
            isActive: true,
          },
        })
        break
      }

      case 'KNOWLEDGE_UPDATE': {
        if (!diff.update) {
          return NextResponse.json({ error: 'Invalid diff for KNOWLEDGE_UPDATE' }, { status: 400 })
        }
        const existing = await prisma.agentKnowledge.findUnique({
          where: { id: diff.update.knowledgeId },
        })
        if (!existing) {
          return NextResponse.json({ error: 'Knowledge entry not found' }, { status: 404 })
        }
        baselineMetrics = {
          avgScore: existing.successRate,
          sampleSize: existing.sampleSize,
        }

        await prisma.agentKnowledge.update({
          where: { id: diff.update.knowledgeId },
          data: diff.update.after as Record<string, unknown>,
        })
        break
      }

      // SKILLPACK_UPDATE proposals died with the SkillPack subsystem (A5.2).

      case 'INSIGHT':
        break
    }

    await prisma.improvementProposal.update({
      where: { id },
      data: {
        status: 'APPROVED',
        appliedAt: new Date(),
        baselineMetrics,
      },
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
