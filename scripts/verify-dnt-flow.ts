/**
 * B2.7 runtime verification for the DNT aggregate on the dev DB.
 *
 * Drives the full session lifecycle through the gateway: open NEW → answer
 * all → sign → valid get_dnt_state → simulate near-expiry → open UPDATE
 * (pre-filled, WITHOUT any application — #12 renewal) → sign again → prior
 * SUPERSEDED. Prints PASS/FAIL per invariant; exits non-zero on failure.
 *
 * Usage: npx tsx scripts/verify-dnt-flow.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { getDntState, getDntNextQuestion, writeDntAnswer } from '@/lib/tools/handlers/dnt-handlers'
import type { ToolContext } from '@/lib/tools/types'

let failures = 0
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail && !ok ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

// actor 'gui': scripted answers are the CUSTOMER's input — the P0-1
// write-guard only polices agent-actor writes (same convention as
// __tests__/helpers/dnt-fixtures.ts; without it the guard rejects every
// scripted value as ungrounded, since the conversation has no messages).
const makeCtx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

async function answerAll(ctx: ToolContext): Promise<number> {
  let count = 0
  for (let i = 0; i < 100; i++) {
    const n = await getDntNextQuestion({}, ctx)
    if (!n.success) throw new Error(`get_dnt_next_question failed: ${n.error}`)
    const d = n.data as { complete: boolean; question: { code: string | null; type: string; options: unknown } | null }
    if (d.complete || !d.question?.code) break
    let answer = 'da'
    if (d.question.code === 'DNT_CNP') answer = '1980418089861'
    else if (d.question.type === 'NUMBER') answer = '0'
    else if (Array.isArray(d.question.options) && d.question.options[0]) {
      const first = d.question.options[0] as { value?: unknown; label?: unknown } | string
      answer = typeof first === 'string' ? first : String(first.value ?? first.label ?? 'da')
    }
    const w = await writeDntAnswer({ questionCode: d.question.code, value: answer }, ctx)
    if (!w.success) throw new Error(`write_dnt_answer(${d.question.code}) failed: ${w.error}`)
    count++
  }
  return count
}

async function signViaGateway(customerId: string, conversationId: string, ctx: ToolContext) {
  const consent = { gdpr: true, aiDisclosure: true }
  const first = await executeCommit({ tool: 'sign_dnt', args: { consent }, actor: 'gui', customerId, conversationId, toolContext: ctx })
  if (first.outcome !== 'requires_confirmation' || !first.confirmToken) return first
  return executeCommit({ tool: 'sign_dnt', args: { consent, confirmToken: first.confirmToken }, actor: 'gui', customerId, conversationId, toolContext: ctx })
}

async function main() {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const customer = await prisma.customer.create({ data: { language: 'ro' } })
  const conv1 = await prisma.conversation.create({ data: { customerId: customer.id, candidateProductId: product.id } })
  const ctx1 = makeCtx(customer.id, conv1.id)

  // leg 1: open NEW through the gateway
  const opened = await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'gui', customerId: customer.id, conversationId: conv1.id, toolContext: ctx1 })
  check('open_dnt_session applies with engine-decided NEW', opened.outcome === 'applied' && (opened.data as { type: string }).type === 'NEW', JSON.stringify(opened))

  // leg 2: duplicate open rejected with the active id
  const dup = await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'gui', customerId: customer.id, conversationId: conv1.id, toolContext: ctx1 })
  check('second open rejected dnt_session_already_active', dup.outcome === 'rejected' && dup.reason === 'dnt_session_already_active', JSON.stringify(dup))

  // leg 3: answer all + sign
  const answered = await answerAll(ctx1)
  const signed = await signViaGateway(customer.id, conv1.id, ctx1)
  check(`answer all (${answered}) + sign applies`, answered > 0 && signed.outcome === 'applied', JSON.stringify(signed))

  // leg 4: get_dnt_state reports valid coverage
  const state1 = await getDntState({}, ctx1)
  check('get_dnt_state valid with LIFE coverage', state1.success === true && (state1.data as { valid: boolean; productTypesCovered: string[] }).valid === true && (state1.data as { productTypesCovered: string[] }).productTypesCovered.includes('LIFE'), JSON.stringify(state1.data))

  // leg 5: simulate near-expiry → renewal WITHOUT an application (#12)
  const dnt1 = await prisma.dnt.findFirstOrThrow({ where: { customerId: customer.id, status: 'ACTIVE' } })
  await prisma.dnt.update({ where: { id: dnt1.id }, data: { validUntil: new Date(Date.now() + 5 * 86400e3) } })
  const conv2 = await prisma.conversation.create({ data: { customerId: customer.id, candidateProductId: product.id } })
  const ctx2 = makeCtx(customer.id, conv2.id)
  const applicationCount = await prisma.application.count({ where: { customerId: customer.id } })
  const reopened = await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'gui', customerId: customer.id, conversationId: conv2.id, toolContext: ctx2 })
  const prefilled = (reopened.data as { type: string; prefilled: number })
  check('renewal opens as UPDATE with pre-fill, no application required', applicationCount === 0 && reopened.outcome === 'applied' && prefilled.type === 'UPDATE' && prefilled.prefilled > 0, JSON.stringify(reopened.data))

  // leg 6: complete + sign again → prior SUPERSEDED
  await answerAll(ctx2)
  const signed2 = await signViaGateway(customer.id, conv2.id, ctx2)
  const dnt1After = await prisma.dnt.findUniqueOrThrow({ where: { id: dnt1.id } })
  const activeCount = await prisma.dnt.count({ where: { customerId: customer.id, status: 'ACTIVE' } })
  check('re-sign applies; prior Dnt SUPERSEDED; exactly one ACTIVE', signed2.outcome === 'applied' && dnt1After.status === 'SUPERSEDED' && dnt1After.supersededById !== null && activeCount === 1, JSON.stringify({ signed2: signed2.outcome, prior: dnt1After.status, activeCount }))

  console.log(failures === 0 ? '\n==== dnt-flow: all invariants PASS ====' : `\n==== dnt-flow: ${failures} FAIL ====`)
  await prisma.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
