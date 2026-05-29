import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManySpy = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: { turnDebug: { findMany: (...a: unknown[]) => findManySpy(...a) } },
}))
vi.mock('@/lib/errors/logger', () => ({ logError: vi.fn() }))

const { GET } = await import('@/app/api/conversations/[id]/debug/route')

function req() {
  return new Request('http://localhost/api/conversations/A/debug') as unknown as import('next/server').NextRequest
}

describe('GET /api/conversations/[id]/debug', () => {
  beforeEach(() => {
    findManySpy.mockReset()
    vi.unstubAllEnvs()
  })

  it('returns 404 outside development (no DB read)', async () => {
    const res = await GET(req(), { params: Promise.resolve({ id: 'A' }) })
    expect(res.status).toBe(404)
    expect(findManySpy).not.toHaveBeenCalled()
  })

  it('returns the conversation turns, scoped to the path id, newest-first', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    findManySpy.mockResolvedValueOnce([{ payload: { traceId: 't2', conversationId: 'A' } }])
    const res = await GET(req(), { params: Promise.resolve({ id: 'A' }) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { turns: unknown[] }
    expect(body.turns).toEqual([{ traceId: 't2', conversationId: 'A' }])
    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: 'A' },
        orderBy: { createdAt: 'desc' },
      }),
    )
  })

  it('returns empty turns for an unknown conversation', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    findManySpy.mockResolvedValueOnce([])
    const res = await GET(req(), { params: Promise.resolve({ id: 'nope' }) })
    const body = (await res.json()) as { turns: unknown[] }
    expect(body.turns).toEqual([])
  })
})
