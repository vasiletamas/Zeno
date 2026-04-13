/**
 * GET /api/admin/ab-tests — list all tests
 * POST /api/admin/ab-tests — create a new test
 *
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const tests = await prisma.aBTestVariant.findMany({
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(tests)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { name, skillPackSlugA, skillPackSlugB, splitRatio } = body as {
      name?: string
      skillPackSlugA?: string
      skillPackSlugB?: string
      splitRatio?: number
    }

    if (!name || !skillPackSlugA || !skillPackSlugB || splitRatio === undefined) {
      return NextResponse.json({ error: 'name, skillPackSlugA, skillPackSlugB, and splitRatio are required' }, { status: 400 })
    }

    if (splitRatio < 0 || splitRatio > 1) {
      return NextResponse.json({ error: 'splitRatio must be between 0 and 1' }, { status: 400 })
    }

    const [packA, packB] = await Promise.all([
      prisma.skillPack.findUnique({ where: { slug: skillPackSlugA } }),
      prisma.skillPack.findUnique({ where: { slug: skillPackSlugB } }),
    ])

    if (!packA) return NextResponse.json({ error: `Skill pack "${skillPackSlugA}" not found` }, { status: 404 })
    if (!packB) return NextResponse.json({ error: `Skill pack "${skillPackSlugB}" not found` }, { status: 404 })

    const test = await prisma.aBTestVariant.create({
      data: { name, skillPackSlugA, skillPackSlugB, splitRatio, isActive: true },
    })

    return NextResponse.json(test, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
