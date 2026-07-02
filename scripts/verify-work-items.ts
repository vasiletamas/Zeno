/**
 * E2.6 runtime verification for the WorkItem operator queue on the dev DB.
 *
 * (1) escalate_to_human through the gateway → persisted OPEN WorkItem +
 * ledger row; (2) identical resubmit → replay disposition, no duplicate
 * item; (3) referral reject through the queue resolution flow → item
 * RESOLVED/rejected, application CANCELLED with the underwriter reason
 * (erratum 2: the T5.D6 set has no DECLINED), customer notified via the
 * mock email provider with a notification_sent system ledger event.
 *
 * Usage: EMAIL_PROVIDER=mock npx tsx scripts/verify-work-items.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { resolveWorkItemDecision } from '@/lib/work-items/resolution'
import { createReferralWorkItem } from '@/lib/work-items/referral'
import { getDntNextQuestion, writeDntAnswer } from '@/lib/tools/handlers/dnt-handlers'
import type { ToolContext } from '@/lib/tools/types'

process.env.EMAIL_PROVIDER = process.env.EMAIL_PROVIDER ?? 'mock'

let failures = 0
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail && !ok ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

const makeCtx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

async function answerAll(ctx: ToolContext): Promise<void> {
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
  }
}

async function signViaGateway(customerId: string, conversationId: string, ctx: ToolContext) {
  const consent = { gdpr: true, aiDisclosure: true }
  const first = await executeCommit({ tool: 'sign_dnt', args: { consent }, actor: 'gui', customerId, conversationId, toolContext: ctx })
  if (first.outcome !== 'requires_confirmation' || !first.confirmToken) return first
  return executeCommit({ tool: 'sign_dnt', args: { consent, confirmToken: first.confirmToken }, actor: 'gui', customerId, conversationId, toolContext: ctx })
}

async function main() {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })

  // ── leg 1: escalation persists a WorkItem atomically with its ledger row
  const customer1 = await prisma.customer.create({ data: { language: 'ro' } })
  const conv1 = await prisma.conversation.create({ data: { customerId: customer1.id, candidateProductId: product.id } })
  const ctx1 = makeCtx(customer1.id, conv1.id)
  const escArgs = { reason: 'customer_request', summary: 'wants a human', priority: 'high' }
  const escalated = await executeCommit({ tool: 'escalate_to_human', args: escArgs, actor: 'agent', customerId: customer1.id, conversationId: conv1.id, toolContext: ctx1 })
  const item1 = await prisma.workItem.findFirst({ where: { kind: 'ESCALATION', refs: { path: ['conversationId'], equals: conv1.id } } })
  const ledger1 = await prisma.commitLedger.findFirst({ where: { conversationId: conv1.id, tool: 'escalate_to_human', outcome: 'applied', idempotencyDisposition: 'fresh' } })
  check('escalate_to_human applies → OPEN ESCALATION WorkItem + fresh ledger row',
    escalated.outcome === 'applied' && item1?.status === 'OPEN' && item1.priority === 'HIGH' && ledger1 !== null,
    JSON.stringify({ outcome: escalated.outcome, item: item1?.status }))

  // ── leg 2: identical resubmit replays, no duplicate item
  const replayed = await executeCommit({ tool: 'escalate_to_human', args: escArgs, actor: 'agent', customerId: customer1.id, conversationId: conv1.id, toolContext: ctx1 })
  const itemCount = await prisma.workItem.count({ where: { kind: 'ESCALATION', refs: { path: ['conversationId'], equals: conv1.id } } })
  const replayRow = await prisma.commitLedger.findFirst({ where: { conversationId: conv1.id, tool: 'escalate_to_human', idempotencyDisposition: 'replay' } })
  check('identical escalation resubmit → replay disposition, still exactly one WorkItem',
    replayed.outcome === 'applied' && itemCount === 1 && replayRow !== null,
    JSON.stringify({ outcome: replayed.outcome, itemCount, replay: replayRow !== null }))

  // ── leg 3: referral reject → RESOLVED item, CANCELLED application,
  //           customer notified (mock email) with a system ledger event
  const customer2 = await prisma.customer.create({ data: { language: 'ro', email: `verify-wi-${Date.now()}@example.ro` } })
  const conv2 = await prisma.conversation.create({ data: { customerId: customer2.id, candidateProductId: product.id } })
  const ctx2 = makeCtx(customer2.id, conv2.id)
  const opened = await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'gui', customerId: customer2.id, conversationId: conv2.id, toolContext: ctx2 })
  if (opened.outcome !== 'applied') throw new Error(`open_dnt_session failed: ${JSON.stringify(opened)}`)
  await answerAll(ctx2)
  const signed = await signViaGateway(customer2.id, conv2.id, ctx2)
  if (signed.outcome !== 'applied') throw new Error(`sign_dnt failed: ${JSON.stringify(signed)}`)

  const tier = await prisma.pricingTier.findFirstOrThrow({ where: { productId: product.id, isActive: true }, orderBy: { orderIndex: 'asc' } })
  const level = await prisma.pricingLevel.findFirstOrThrow({ where: { tierId: tier.id, isActive: true }, orderBy: { orderIndex: 'asc' } })
  const app = await prisma.application.create({
    data: {
      conversationId: conv2.id, customerId: customer2.id, productId: product.id,
      tierId: tier.id, levelId: level.id, includesAddon: false,
      status: 'REFERRED', currentQuestionIndex: 0, totalQuestions: 0,
    },
  })
  const referralItem = await createReferralWorkItem({
    applicationId: app.id, customerId: customer2.id, conversationId: conv2.id,
    reason: 'pending_external_check: cumulative sum at risk',
  })

  const decision = await resolveWorkItemDecision({ workItemId: referralItem.id, decision: 'reject', note: 'sum at risk exceeded', resolvedBy: 'verify-script' })
  const itemAfter = await prisma.workItem.findUniqueOrThrow({ where: { id: referralItem.id } })
  const appAfter = await prisma.application.findUniqueOrThrow({ where: { id: app.id } })
  const notification = await prisma.commitLedger.findFirst({ where: { conversationId: conv2.id, tool: 'notification_sent', actor: 'system', outcome: 'applied' } })
  check('referral reject → WorkItem RESOLVED/rejected by the named operator',
    decision.outcome === 'applied' && decision.effects.includes('terminal') && itemAfter.status === 'RESOLVED' && itemAfter.resolutionCode === 'rejected' && itemAfter.resolvedBy === 'verify-script',
    JSON.stringify({ outcome: decision.outcome, item: itemAfter.status, by: itemAfter.resolvedBy }))
  check('application terminal: CANCELLED with underwriter reason (T5.D6, erratum 2)',
    appAfter.status === 'CANCELLED' && (appAfter.flagsForReview as { underwriterReason?: string } | null)?.underwriterReason === 'sum at risk exceeded',
    JSON.stringify({ status: appAfter.status, flags: appAfter.flagsForReview }))
  check('customer notified: notification_sent system ledger event recorded',
    notification !== null && notification.targetRef === 'referral_rejected',
    JSON.stringify({ found: notification !== null }))

  console.log(failures === 0 ? '\n==== work-items: all invariants PASS ====' : `\n==== work-items: ${failures} FAIL ====`)
  await prisma.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
