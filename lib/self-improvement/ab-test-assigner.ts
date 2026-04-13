/**
 * A/B Test Assigner — checks active tests and randomly assigns
 * conversations to variant A or B based on split ratio.
 */

import { prisma } from '@/lib/db'

export async function applyABTestVariant(
  skillPackSlugs: string[],
  conversationId: string,
): Promise<string[]> {
  const activeTests = await prisma.aBTestVariant.findMany({
    where: { isActive: true },
  })

  if (activeTests.length === 0) return skillPackSlugs

  const result = [...skillPackSlugs]

  for (const test of activeTests) {
    const indexA = result.indexOf(test.skillPackSlugA)
    if (indexA === -1) continue

    const assignToB = Math.random() < test.splitRatio

    if (assignToB) {
      result[indexA] = test.skillPackSlugB

      await prisma.aBTestVariant.update({
        where: { id: test.id },
        data: { conversationsB: { increment: 1 } },
      })

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          metadata: {
            abTest: { testId: test.id, variant: 'B' },
          },
        },
      })
    } else {
      await prisma.aBTestVariant.update({
        where: { id: test.id },
        data: { conversationsA: { increment: 1 } },
      })
    }
  }

  return result
}
