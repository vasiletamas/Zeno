/**
 * C3.7 runtime verification of the suitability engine on the dev DB.
 *
 * (1) The LIVE seeded protect row's suitabilityRules parse; (2) unsuitable
 * flow through the gateway: sign a DNT with an investment demand → the
 * derived verdict is unsuitable → generate_quote is blocked
 * suitability_warning_unacknowledged with acknowledge_suitability_warning
 * exposed → the ack commit applies (row + ledger linkage) and the block
 * clears; (3) suitable flow: clean facts → suitable verdict, no ack
 * demanded, generateSuitabilityReport registers a quote-keyed Document.
 *
 * Usage: npx tsx scripts/verify-suitability.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { parseSuitabilityRuleSet } from '@/lib/engines/suitability'
import { generateSuitabilityReport } from '@/lib/compliance/suitability-report'
import { getDntNextQuestion, writeDntAnswer, openDntSession, signDnt } from '@/lib/tools/handlers/dnt-handlers'
import type { ToolContext } from '@/lib/tools/types'

let failures = 0
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail && !ok ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

const makeCtx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

async function seedSignedFixture(facts: Record<string, string>) {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const customer = await prisma.customer.create({ data: { language: 'ro' } })
  const application = await prisma.application.create({ data: { customerId: customer.id, productId: product.id, status: 'OPEN' } })
  const conversation = await prisma.conversation.create({ data: { customerId: customer.id, productId: product.id, activeApplicationId: application.id } })
  await prisma.application.update({ where: { id: application.id }, data: { originConversationId: conversation.id } })
  const ctx = makeCtx(customer.id, conversation.id)
  const opened = await openDntSession({}, ctx)
  if (!opened.success) throw new Error(`open_dnt_session: ${opened.error}`)
  for (const [questionCode, value] of Object.entries(facts)) {
    const w = await writeDntAnswer({ questionCode, value }, ctx)
    if (!w.success) throw new Error(`write_dnt_answer(${questionCode}): ${w.error}`)
  }
  for (let i = 0; i < 100; i++) {
    const n = await getDntNextQuestion({}, ctx)
    if (!n.success) throw new Error(`get_dnt_next_question: ${n.error}`)
    const d = n.data as { complete: boolean; question: { code: string | null; type: string; options: unknown } | null }
    if (d.complete || !d.question?.code) break
    let answer = 'da'
    if (d.question.code === 'DNT_CNP') answer = '1980418089861'
    else if (d.question.type === 'NUMBER') answer = '0'
    else if (Array.isArray(d.question.options) && d.question.options[0]) {
      const first = d.question.options[0] as { value?: unknown } | string
      answer = typeof first === 'string' ? first : String((first as { value?: unknown }).value ?? 'da')
    }
    const w = await writeDntAnswer({ questionCode: d.question.code, value: answer }, ctx)
    if (!w.success) throw new Error(`write_dnt_answer(${d.question.code}): ${w.error}`)
  }
  const signed = await signDnt({ confirmSignature: true, consent: { gdpr: true, aiDisclosure: true } }, ctx)
  if (!signed.success) throw new Error(`sign_dnt: ${signed.error}`)
  return { customer, application, conversation }
}

async function main() {
  // leg 1: the live row parses
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  try {
    const rs = parseSuitabilityRuleSet(product.suitabilityRules)
    check(`live protect.suitabilityRules parse (mode ${rs.mode}, v${rs.version})`, rs.mode === 'warn_and_allow' && rs.version === 1)
  } catch (e) {
    check('live protect.suitabilityRules parse', false, String(e))
    process.exit(1)
  }

  // leg 2: unsuitable flow — investment demand
  const bad = await seedSignedFixture({ DNT_LIFE_SUBTYPE: 'financial_and_investment' })
  const exposed = deriveAndExpose(await loadDomainSnapshot(bad.conversation.id))
  const gqBlock = exposed.actions.blocked.find((b) => b.action === 'generate_quote')
  check('unsuitable facts: DerivedStateV3.suitability.verdict === unsuitable',
    exposed.state.suitability?.verdict === 'unsuitable',
    JSON.stringify(exposed.state.suitability))
  check('generate_quote blocked suitability_warning_unacknowledged; ack commit exposed',
    gqBlock?.reason === 'suitability_warning_unacknowledged' && exposed.actions.available.includes('acknowledge_suitability_warning'),
    JSON.stringify({ block: gqBlock, ackExposed: exposed.actions.available.includes('acknowledge_suitability_warning') }))

  const ack = await executeCommit({ tool: 'acknowledge_suitability_warning', args: {}, actor: 'agent', customerId: bad.customer.id, conversationId: bad.conversation.id, toolContext: makeCtx(bad.customer.id, bad.conversation.id) })
  const ackRow = await prisma.suitabilityWarningAck.findFirst({ where: { customerId: bad.customer.id } })
  const after = deriveAndExpose(await loadDomainSnapshot(bad.conversation.id))
  check('acknowledge_suitability_warning applies: ack row persisted with ledger linkage, block cleared',
    ack.outcome === 'applied' && ackRow !== null && !!ackRow.sourceCommitId &&
    after.actions.blocked.find((b) => b.action === 'generate_quote')?.reason !== 'suitability_warning_unacknowledged' &&
    !after.actions.available.includes('acknowledge_suitability_warning'),
    JSON.stringify({ outcome: ack.outcome, row: ackRow?.id, blockAfter: after.actions.blocked.find((b) => b.action === 'generate_quote') }))

  // leg 3: suitable flow — clean facts + quote-keyed report
  const good = await seedSignedFixture({ DNT_LIFE_SUBTYPE: 'simple_protection' })
  const goodExposed = deriveAndExpose(await loadDomainSnapshot(good.conversation.id))
  check('suitable facts: verdict suitable, no ack demanded',
    goodExposed.state.suitability?.verdict === 'suitable' &&
    goodExposed.actions.blocked.find((b) => b.action === 'generate_quote')?.reason !== 'suitability_warning_unacknowledged' &&
    !goodExposed.actions.available.includes('acknowledge_suitability_warning'),
    JSON.stringify(goodExposed.state.suitability))

  const quote = await prisma.quote.create({
    data: { applicationId: good.application.id, productId: product.id, customerId: good.customer.id, premiumAnnual: 190, premiumMonthly: 15.83, coverages: {}, status: 'ISSUED', validUntil: new Date(Date.now() + 30 * 86400e3) },
  })
  const report = await generateSuitabilityReport(quote.id)
  const docRow = await prisma.document.findUnique({ where: { id: report.documentId } })
  check('generateSuitabilityReport registers a quote-keyed Document with the verdict of record',
    report.buffer.subarray(0, 5).toString() === '%PDF-' && report.meta.verdict === 'suitable' &&
    docRow?.kind === 'SUITABILITY_REPORT' && docRow?.quoteId === quote.id,
    JSON.stringify({ meta: report.meta, doc: { kind: docRow?.kind, quoteId: docRow?.quoteId } }))

  console.log(failures === 0 ? '\n==== suitability: all invariants PASS ====' : `\n==== suitability: ${failures} FAILURE(S) ====`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
