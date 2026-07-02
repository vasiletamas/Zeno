import { prisma } from '@/lib/db'

export type QuestionPhase = 'dnt' | 'application'

type Db = typeof prisma

/**
 * Group codes for a product + phase: the product's own groups plus any
 * global (productId = null) groups, ordered by orderIndex. Replaces the
 * hardcoded DNT_GROUP_CODES / APPLICATION_GROUP_CODES constants.
 *
 * Accepts an injectable client so callers running inside a transaction
 * (e.g. the snapshot loader under the A2 commit gateway) keep every read
 * on the same connection instead of escaping to the global client.
 */
export async function resolveGroupCodes(
  productId: string | null,
  phase: QuestionPhase,
  db: Db = prisma,
): Promise<string[]> {
  const productFilter = productId
    ? [{ productId }, { productId: null }]
    : [{ productId: null }]
  const groups = await db.questionGroup.findMany({
    where: { phase, OR: productFilter },
    orderBy: { orderIndex: 'asc' },
    select: { code: true },
  })
  return groups.map((g) => g.code)
}

/**
 * The product a conversation is acting on: the committed productId, else the
 * candidate. DNT runs before commit, so the candidate must be honored.
 * Pass a known committed id (e.g. context.product?.id) to skip the query.
 */
export async function resolveActiveProductId(
  conversationId: string,
  knownProductId?: string | null,
): Promise<string | null> {
  if (knownProductId) return knownProductId
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { productId: true, candidateProductId: true },
  })
  return conv?.productId ?? conv?.candidateProductId ?? null
}
