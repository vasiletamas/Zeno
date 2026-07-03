/**
 * C1.9 runtime verification of the consequence engine on the dev DB.
 *
 * Drives the cascades through the gateway: coverage selected facet-by-facet
 * (C1.6) → tier change VALIDITY-invalidates the level → replay returns the
 * ORIGINAL envelope without a second cascade → BD answers through
 * write_question_answer (CONFIRM_ALWAYS two-step, T6.D3) → a bd YES makes
 * the addon ineligible: deterministic removal + questions_removed + prior
 * bd answers INVALIDATED with causality → modify_answer on
 * HEALTH_DECLARATION_CONFIRM pauses via the DERIVED flag and correcting it
 * un-pauses (erratum 10). Prints PASS/FAIL per leg; exits non-zero on
 * failure.
 *
 * Usage: npx tsx scripts/verify-consequence-cascade.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { getDntNextQuestion, writeDntAnswer } from '@/lib/tools/handlers/dnt-handlers'
import type { ToolContext } from '@/lib/tools/types'
import type { CommitActor, CommitResult } from '@/lib/engines/domain-types'

let failures = 0
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail && !ok ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

const makeCtx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

const commit = (tool: string, args: Record<string, unknown>, customerId: string, conversationId: string, actor: CommitActor = 'agent', confirmToken?: string) =>
  executeCommit({ tool, args, actor, customerId, conversationId, confirmToken, toolContext: makeCtx(customerId, conversationId) })

/** Commit with the two-step confirmation ceremony when demanded. */
async function commitConfirmed(tool: string, args: Record<string, unknown>, customerId: string, conversationId: string): Promise<{ first: CommitResult; final: CommitResult }> {
  const first = await commit(tool, args, customerId, conversationId)
  if (first.outcome !== 'requires_confirmation' || !first.confirmToken) return { first, final: first }
  const final = await commit(tool, args, customerId, conversationId, 'agent', first.confirmToken)
  return { first, final }
}

async function answerAllDnt(ctx: ToolContext): Promise<void> {
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

async function main() {
  // fixture: signed DNT + open application with standard/level_1/addon
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const customer = await prisma.customer.create({ data: { language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, candidateProductId: product.id } })
  const ctx = makeCtx(customer.id, conv.id)
  const dntOpen = await commit('open_dnt_session', {}, customer.id, conv.id, 'gui')
  if (dntOpen.outcome !== 'applied') throw new Error(`open_dnt_session: ${JSON.stringify(dntOpen)}`)
  await answerAllDnt(ctx)
  const { final: signed } = await commitConfirmed('sign_dnt', { consent: { gdpr: true, aiDisclosure: true } }, customer.id, conv.id)
  if (signed.outcome !== 'applied') throw new Error(`sign_dnt: ${JSON.stringify(signed)}`)
  const opened = await commit('set_application', {}, customer.id, conv.id)
  if (opened.outcome !== 'applied') throw new Error(`set_application: ${JSON.stringify(opened)}`)
  const app = await prisma.application.findFirstOrThrow({ where: { customerId: customer.id } })
  for (const args of [{ tier: 'standard' }, { level: 'level_1' }, { addon: true }]) {
    const r = await commit('select_coverage', args, customer.id, conv.id)
    if (r.outcome !== 'applied') throw new Error(`select_coverage(${JSON.stringify(args)}): ${JSON.stringify(r)}`)
  }

  // leg 1: tier change → VALIDITY cascade clears the level, re_rating rides
  const tierChange = await commit('select_coverage', { tier: 'optim' }, customer.id, conv.id)
  const afterTier = await prisma.application.findUniqueOrThrow({ where: { id: app.id } })
  check('select_coverage tier change: re_rating + cascade_invalidate, levelId nulled by the plan',
    tierChange.outcome === 'applied' && tierChange.effects.includes('re_rating') && tierChange.effects.includes('cascade_invalidate') && afterTier.levelId === null,
    JSON.stringify({ outcome: tierChange.outcome, effects: tierChange.effects, levelId: afterTier.levelId }))

  // leg 2: re-select the SAME level after the cascade, then re-issue the
  // identical tier commit — select_coverage is state-guarded (REPLAY_EXEMPT
  // since C1.9: a replayed envelope would lie once a cascade moved state),
  // so the level re-select re-APPLIES and the duplicate tier commit is a
  // no-op ('unchanged'), never a second cascade.
  const relevel = await commit('select_coverage', { level: 'level_1' }, customer.id, conv.id)
  if (relevel.outcome !== 'applied') throw new Error(`re-select level: ${JSON.stringify(relevel)}`)
  const dupTier = await commit('select_coverage', { tier: 'optim' }, customer.id, conv.id)
  const afterDup = await prisma.application.findUniqueOrThrow({ where: { id: app.id } })
  check('re-selecting the cascaded level re-applies; a duplicate tier commit is a no-op, not a second cascade',
    afterDup.levelId !== null && dupTier.outcome === 'applied' && (dupTier.data as { changed?: boolean } | undefined)?.changed === false,
    JSON.stringify({ dup: dupTier.outcome, changed: (dupTier.data as { changed?: boolean } | undefined)?.changed, levelId: afterDup.levelId }))

  // leg 3: base questions, then a first BD answer through the
  // CONFIRM_ALWAYS two-step (T6.D3 — even first writes confirm). Answers
  // are ADDRESSED by question code (replay scope — a same-value answer to
  // a different question must never replay).
  // D1.8: PAYMENT_FREQUENCY left the questionnaire (elected at accept_quote)
  for (const [questionCode, answer] of [['HEALTH_DECLARATION_CONFIRM', 'true']]) {
    const r = await commit('write_question_answer', { questionCode, answer }, customer.id, conv.id)
    if (r.outcome !== 'applied') throw new Error(`write(${questionCode}): ${JSON.stringify(r)}`)
  }
  const { first: bd1First, final: bd1 } = await commitConfirmed('write_question_answer', { questionCode: 'BD_CANCER_HISTORY', answer: 'false' }, customer.id, conv.id)
  check('BD first-write demands confirmation (CONFIRM_ALWAYS) and applies on the token round-trip',
    bd1First.outcome === 'requires_confirmation' && bd1.outcome === 'applied',
    JSON.stringify({ first: bd1First.outcome, final: bd1.outcome }))

  // leg 4: bd YES → addon ineligible: deterministic removal, bd questions
  // leave the visible set, the prior bd answer is INVALIDATED with causality
  const { final: bd2 } = await commitConfirmed('write_question_answer', { questionCode: 'BD_CARDIOVASCULAR', answer: 'true' }, customer.id, conv.id)
  const afterBd = await prisma.application.findUniqueOrThrow({ where: { id: app.id } })
  const cancerQ = await prisma.question.findFirstOrThrow({ where: { code: 'BD_CANCER_HISTORY' } })
  const cancerRow = await prisma.answer.findFirst({ where: { applicationId: app.id, questionId: cancerQ.id }, orderBy: { answeredAt: 'desc' } })
  check('bd yes: eligibility_recheck + questions_removed + addon removed; prior bd answer INVALIDATED(removed_by_branch) with the triggering cause',
    bd2.outcome === 'applied' && bd2.effects.includes('eligibility_recheck') && bd2.effects.includes('questions_removed') &&
    afterBd.includesAddon === false && cancerRow?.status === 'INVALIDATED' && cancerRow?.invalidatedReason === 'removed_by_branch' && cancerRow?.causedByKey === 'answer:BD_CARDIOVASCULAR',
    JSON.stringify({ outcome: bd2.outcome, effects: bd2.effects, addon: afterBd.includesAddon, cancer: { status: cancerRow?.status, cause: cancerRow?.causedByKey, reason: cancerRow?.invalidatedReason } }))

  // leg 5: modify HEALTH_DECLARATION_CONFIRM to 'false' — two-step preview,
  // then the DERIVED escalate flag pauses the application (erratum 10)
  const m1 = await commit('modify_answer', { questionCode: 'HEALTH_DECLARATION_CONFIRM', newValue: 'false' }, customer.id, conv.id)
  const preview = (m1.data as { preview?: { mutation?: { node?: string } } } | undefined)?.preview
  const m2 = m1.outcome === 'requires_confirmation' && m1.confirmToken
    ? await commit('modify_answer', { questionCode: 'HEALTH_DECLARATION_CONFIRM', newValue: 'false' }, customer.id, conv.id, 'agent', m1.confirmToken)
    : m1
  const paused = await prisma.application.findUniqueOrThrow({ where: { id: app.id } })
  check('modify_answer: requires_confirmation with the plan preview, confirmed apply pauses via the derived flag',
    m1.outcome === 'requires_confirmation' && preview?.mutation?.node === 'answer:HEALTH_DECLARATION_CONFIRM' &&
    m2.outcome === 'applied' && paused.status === 'PAUSED',
    JSON.stringify({ first: m1.outcome, preview, second: m2.outcome, status: paused.status }))

  // leg 6: correcting the answer on the PAUSED app clears the derived flag
  // and re-opens (the erratum-10 unpause path, exposure included)
  const { final: fixed } = await commitConfirmed('modify_answer', { questionCode: 'HEALTH_DECLARATION_CONFIRM', newValue: 'true' }, customer.id, conv.id)
  const reopened = await prisma.application.findUniqueOrThrow({ where: { id: app.id } })
  check('correcting the escalated answer un-pauses: flag cleared, status OPEN',
    fixed.outcome === 'applied' && reopened.status === 'OPEN' && Array.isArray(reopened.flagsForReview) && (reopened.flagsForReview as unknown[]).length === 0,
    JSON.stringify({ outcome: fixed.outcome, status: reopened.status, flags: reopened.flagsForReview }))

  console.log(failures === 0 ? '\n==== consequence-cascade: all invariants PASS ====' : `\n==== consequence-cascade: ${failures} FAILURE(S) ====`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
