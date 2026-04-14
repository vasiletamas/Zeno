import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

const COOKIE_NAME = 'zeno_auth'

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const limit = parseInt(searchParams.get('limit') ?? '20', 10)

  const runs = await prisma.simulationRun.findMany({
    where: status ? { status } : undefined,
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: {
      _count: { select: { conversations: true } },
    },
  })

  return NextResponse.json({ runs })
}
