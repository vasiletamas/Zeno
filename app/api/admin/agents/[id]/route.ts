/**
 * PATCH /api/admin/agents/[id]
 *
 * Update agent configuration fields.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth check — ADMIN only
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const {
      provider,
      model,
      fallbackProvider,
      fallbackModel,
      temperature,
      maxTokens,
      isActive,
    } = body as {
      provider?: string
      model?: string
      fallbackProvider?: string | null
      fallbackModel?: string | null
      temperature?: number
      maxTokens?: number
      isActive?: boolean
    }

    // Build update data — only include provided fields
    const updateData: Record<string, unknown> = {}
    if (provider !== undefined) updateData.provider = provider
    if (model !== undefined) updateData.model = model
    if (fallbackProvider !== undefined) updateData.fallbackProvider = fallbackProvider
    if (fallbackModel !== undefined) updateData.fallbackModel = fallbackModel
    if (temperature !== undefined) updateData.temperature = temperature
    if (maxTokens !== undefined) updateData.maxTokens = maxTokens
    if (isActive !== undefined) updateData.isActive = isActive

    const agent = await prisma.agent.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({
      agent: { id: agent.id, slug: agent.slug, name: agent.name },
    })
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
