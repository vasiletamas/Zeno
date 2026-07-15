import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    product: { findUnique: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { loadCoachingBriefing, flushCoachingBriefingCache } from '@/lib/chat/context-loaders'

describe('loadCoachingBriefing (subsystem B)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flushCoachingBriefingCache()
  })

  it('returns Product.defaultPlaybook', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ defaultPlaybook: 'Product playbook' } as never)

    const result = await loadCoachingBriefing('prod-1')

    expect(result).toBe('Product playbook')
    expect(prisma.product.findUnique).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      select: { defaultPlaybook: true },
    })
  })

  it('returns null when the Product has no playbook', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ defaultPlaybook: null } as never)

    const result = await loadCoachingBriefing('prod-1')

    expect(result).toBeNull()
  })

  it('returns null when productId is null', async () => {
    const result = await loadCoachingBriefing(null)
    expect(result).toBeNull()
    expect(prisma.product.findUnique).not.toHaveBeenCalled()
  })
})
