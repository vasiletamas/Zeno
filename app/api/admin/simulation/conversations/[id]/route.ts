import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

const COOKIE_NAME = 'zeno_auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const simConv = await prisma.simulationConversation.findUnique({
    where: { id },
    include: {
      conversation: {
        include: {
          messages: { orderBy: { createdAt: 'asc' }, take: 100 },
          score: true,
          turnTraces: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  })

  if (!simConv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  return NextResponse.json({
    simulation: {
      id: simConv.id,
      personaSlug: simConv.personaSlug,
      scenarioType: simConv.scenarioType,
      scenarioSlug: simConv.scenarioSlug,
      status: simConv.status,
      turnCount: simConv.turnCount,
      error: simConv.error,
      durationMs: simConv.durationMs,
    },
    messages: simConv.conversation.messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
      toolResults: m.toolResults,
      createdAt: m.createdAt.toISOString(),
    })),
    score: simConv.conversation.score,
    turnTraces: simConv.conversation.turnTraces,
  })
}
