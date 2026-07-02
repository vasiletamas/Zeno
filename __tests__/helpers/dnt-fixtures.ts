import { prisma } from '@/lib/db'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
import { getNextQuestion } from '@/lib/engines/questionnaire-engine'
import { saveDntAnswer } from '@/lib/tools/handlers/dnt-handlers'
import { ensureTestProduct } from './test-db'
import type { ToolContext } from '@/lib/tools/types'

function answerFor(q: { type: string; options: unknown; validationRules?: unknown; code?: string | null }): string {
  if (q.type === 'BOOLEAN') return 'da'
  if (q.type === 'NUMBER') return '0'
  if (q.code === 'DNT_CNP') return '1980418089861' // pattern-pinned 13-digit CNP
  const opts = Array.isArray(q.options) ? q.options : []
  const first = opts[0]
  if (typeof first === 'string') return first
  if (first && typeof first === 'object') {
    const o = first as { value?: unknown; label?: unknown }
    return String(o.value ?? o.label ?? 'da')
  }
  const rules = (q.validationRules ?? {}) as { minLength?: number }
  return rules.minLength ? 'x'.repeat(rules.minLength) : 'da'
}

/**
 * Creates a customer + conversation on the seeded protect product and answers
 * every visible DNT question through the real handler (first option / 'da' /
 * '0'), leaving the questionnaire signable.
 */
export async function seedDntFullyAnswered() {
  const product = await ensureTestProduct()
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
  const conversation = await prisma.conversation.create({ data: { customerId: customer.id, productId: product.id } })
  const ctx = { customerId: customer.id, conversationId: conversation.id, language: 'ro', db: prisma } as unknown as ToolContext
  const codes = (await resolveGroupCodes(product.id, 'dnt', prisma)) ?? []
  let answerCount = 0
  for (let i = 0; i < 100; i++) {
    const next = await getNextQuestion(codes, { kind: 'conversation', conversationId: conversation.id })
    if (!next) break
    const r = await saveDntAnswer({ questionId: next.question.id, answer: answerFor(next.question) }, ctx)
    if (!r.success) throw new Error(`dnt fixture could not answer ${next.question.code ?? next.question.id}: ${r.error}`)
    answerCount++
  }
  if (answerCount === 0) throw new Error('dnt fixture answered zero questions — is the DNT group seeded?')
  return { customerId: customer.id, conversationId: conversation.id, ctx, answerCount }
}
