import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    workflowStep: { findFirst: vi.fn() },
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

  it('returns WorkflowStep.salesPlaybook when workflowStepCode is provided and step has playbook', async () => {
    vi.mocked(prisma.workflowStep.findFirst).mockResolvedValue({ salesPlaybook: 'Step playbook content' } as never)

    const result = await loadCoachingBriefing('prod-1', 'dnt_questionnaire')

    expect(result).toBe('Step playbook content')
    expect(prisma.workflowStep.findFirst).toHaveBeenCalled()
    expect(prisma.product.findUnique).not.toHaveBeenCalled()
  })

  it('falls back to Product.defaultPlaybook when workflowStepCode is null', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ defaultPlaybook: 'Product playbook' } as never)

    const result = await loadCoachingBriefing('prod-1', null)

    expect(result).toBe('Product playbook')
    expect(prisma.product.findUnique).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      select: { defaultPlaybook: true },
    })
  })

  it('falls back to Product.defaultPlaybook when WorkflowStep has no salesPlaybook', async () => {
    vi.mocked(prisma.workflowStep.findFirst).mockResolvedValue({ salesPlaybook: null } as never)
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ defaultPlaybook: 'Product fallback' } as never)

    const result = await loadCoachingBriefing('prod-1', 'dnt_questionnaire')

    expect(result).toBe('Product fallback')
  })

  it('returns null when neither WorkflowStep nor Product has playbook', async () => {
    vi.mocked(prisma.workflowStep.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ defaultPlaybook: null } as never)

    const result = await loadCoachingBriefing('prod-1', 'dnt_questionnaire')

    expect(result).toBeNull()
  })

  it('returns null when productId is null and workflowStepCode is null', async () => {
    const result = await loadCoachingBriefing(null, null)
    expect(result).toBeNull()
    expect(prisma.workflowStep.findFirst).not.toHaveBeenCalled()
    expect(prisma.product.findUnique).not.toHaveBeenCalled()
  })
})
