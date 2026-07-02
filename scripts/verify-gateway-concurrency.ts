/**
 * A2.10 concurrency probe: two genuinely concurrent commits with identical
 * material args must serialize via the per-conversation advisory lock and
 * apply exactly ONCE — the loser takes the in-lock replay path (erratum 2)
 * and returns the winner's envelope. Expect exactly 1 fresh applied row.
 *
 * Usage: npx tsx scripts/verify-gateway-concurrency.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import type { ToolContext } from '@/lib/tools/types'

async function main() {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
  const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
  const mk = (actor: 'agent' | 'gui') => executeCommit({ tool: 'set_candidate_product', args: { productId: product.id, confidence: 80 }, actor, conversationId: conv.id, customerId: customer.id, toolContext: ctx })
  const [a, b] = await Promise.all([mk('agent'), mk('gui')])
  const fresh = await prisma.commitLedger.count({ where: { conversationId: conv.id, idempotencyDisposition: 'fresh', outcome: 'applied' } })
  console.log({ a: a.outcome, b: b.outcome, freshApplied: fresh })
  if (fresh !== 1) throw new Error(`expected exactly 1 fresh applied row, got ${fresh}`)
  console.log('OK: concurrent GUI+agent commit applied once')
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
