import { prisma } from '@/lib/db'
import { openDntSession, writeDntAnswer, getDntNextQuestion } from '@/lib/tools/handlers/dnt-handlers'
import { ensureTestProduct } from './test-db'
import type { ToolContext } from '@/lib/tools/types'

function answerFor(q: { type: string; options: unknown; code?: string | null }): string {
  if (q.type === 'BOOLEAN') return 'da'
  if (q.type === 'NUMBER') return '0'
  const opts = Array.isArray(q.options) ? q.options : []
  const first = opts[0]
  if (typeof first === 'string') return first
  if (first && typeof first === 'object') {
    const o = first as { value?: unknown; label?: unknown }
    return String(o.value ?? o.label ?? 'da')
  }
  return 'da'
}

function makeCtx(customerId: string, conversationId: string): ToolContext {
  // actor 'gui': fixture answers are the CUSTOMER's scripted input — the
  // P0-1 write-guard only polices agent-actor writes.
  return { customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext
}

/**
 * Answers every visible question of the customer's ACTIVE DNT session through
 * the real write_dnt_answer handler (B2: session-scoped, keyed by code).
 */
export async function answerAllDntQuestions(customerId: string, conversationId: string): Promise<number> {
  const ctx = makeCtx(customerId, conversationId)
  let count = 0
  for (let i = 0; i < 100; i++) {
    const n = await getDntNextQuestion({}, ctx)
    if (!n.success) throw new Error(`dnt fixture: get_dnt_next_question failed: ${n.error}`)
    const d = n.data as { complete: boolean; question: { code: string | null; type: string; options: unknown } | null }
    if (d.complete || !d.question) break
    if (!d.question.code) throw new Error('dnt fixture: question without a code cannot be answered by write_dnt_answer')
    const w = await writeDntAnswer({ questionCode: d.question.code, value: answerFor(d.question) }, ctx)
    if (!w.success) throw new Error(`dnt fixture could not answer ${d.question.code}: ${w.error}`)
    count++
  }
  return count
}

/**
 * Creates a customer + conversation on the seeded protect product, opens a
 * DNT session, and answers every visible question — leaving it signable.
 */
export async function seedDntFullyAnswered() {
  const product = await ensureTestProduct()
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
  const conversation = await prisma.conversation.create({ data: { customerId: customer.id, productId: product.id } })
  const ctx = makeCtx(customer.id, conversation.id)
  const opened = await openDntSession({}, ctx)
  if (!opened.success) throw new Error(`dnt fixture: open_dnt_session failed: ${opened.error}`)
  const answerCount = await answerAllDntQuestions(customer.id, conversation.id)
  if (answerCount === 0) throw new Error('dnt fixture answered zero questions — is the DNT group seeded?')
  return { customerId: customer.id, conversationId: conversation.id, ctx, answerCount, sessionId: (opened.data as { sessionId: string }).sessionId }
}
