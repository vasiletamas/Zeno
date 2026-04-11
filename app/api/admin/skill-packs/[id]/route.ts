/**
 * GET /api/admin/skill-packs/[id]
 * PUT /api/admin/skill-packs/[id]
 *
 * Get or update a skill pack by id.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { flushSkillPackCache } from '@/lib/skills/skill-pack-loader'

// ============================================================
// Auth helper
// ============================================================

async function requireAdmin(
  request: NextRequest,
): Promise<{ error: NextResponse } | { error: null }> {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { error: null }
}

// ============================================================
// GET /api/admin/skill-packs/[id]
// ============================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdmin(request)
    if (auth.error) return auth.error

    const { id } = await params

    const skillPack = await prisma.skillPack.findUnique({ where: { id } })
    if (!skillPack) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json(skillPack)
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

// ============================================================
// PUT /api/admin/skill-packs/[id]
// ============================================================

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdmin(request)
    if (auth.error) return auth.error

    const { id } = await params
    const body = await request.json()

    const {
      name,
      description,
      promptSections,
      allowedTools,
      constraints,
      flags,
      priority,
    } = body as {
      name?: string
      description?: string
      promptSections?: Record<string, string>
      allowedTools?: string[]
      constraints?: string | null
      flags?: Record<string, unknown> | null
      priority?: number
    }

    // Build update data — only include provided fields
    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (promptSections !== undefined) updateData.promptSections = promptSections
    if (allowedTools !== undefined) updateData.allowedTools = allowedTools
    if (constraints !== undefined) updateData.constraints = constraints
    if (flags !== undefined) updateData.flags = flags
    if (priority !== undefined) updateData.priority = priority

    const skillPack = await prisma.skillPack.update({
      where: { id },
      data: updateData,
    })

    flushSkillPackCache()

    return NextResponse.json(skillPack)
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
