/**
 * B0.6 runtime verification for the CustomerProfile SSOT on the dev DB.
 *
 * Drives declared write → verified overlay → conflict surfaced → claim-and-merge
 * of two customer shells, printing PASS/FAIL per invariant. Exits non-zero on
 * any FAIL. Leaves only its own two customers behind (no truncation).
 *
 * Usage: npx tsx scripts/verify-customer-ssot.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { setDeclaredField, setVerifiedField, getProfile, getAge } from '@/lib/customer/profile-service'
import { claimAndMerge } from '@/lib/customer/claim-merge'
import { loadDerivedConsents } from '@/lib/customer/consent-service'
import { executeCommit } from '@/lib/tools/gateway'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
import { getNextQuestion } from '@/lib/engines/questionnaire-engine'
import { saveDntAnswer } from '@/lib/tools/handlers/dnt-handlers'
import type { ToolContext } from '@/lib/tools/types'

let failures = 0
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail && !ok ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

async function main() {
  const stamp = Date.now()
  const canon = await prisma.customer.create({ data: { language: 'ro' } })
  const dup = await prisma.customer.create({ data: { language: 'ro' } })

  // declared write lands
  const w1 = await setDeclaredField(canon.id, 'name', 'Stefan Popa', 'collect_customer_field')
  check('declared write applies', w1.outcome === 'applied')

  // verified overlay with matching value (diacritics-insensitive) flips to verified
  const w2 = await setVerifiedField(canon.id, 'name', 'Ștefan Popa', 'document_extraction', `ev-${stamp}`)
  const nameField = (await getProfile(canon.id)).fields.name
  check('verified overlay flips provenance', w2.outcome === 'applied' && nameField?.provenance === 'verified', JSON.stringify(nameField))

  // declared can never displace verified
  const w3 = await setDeclaredField(canon.id, 'name', 'Alt Nume', 'collect_customer_field')
  check('verified-beats-declared (rejected write)', w3.outcome === 'rejected' && w3.reason === 'field_verified_immutable')

  // verified write over differing declared surfaces a conflict
  await setDeclaredField(dup.id, 'phone', '0722000111', 'collect_customer_field')
  await setVerifiedField(dup.id, 'phone', '0733999888', 'document_extraction', `ev2-${stamp}`)
  const dupProfile = await getProfile(dup.id)
  check('conflict surfaced with both values kept', dupProfile.conflicts.includes('phone') && dupProfile.fields.phone?.conflictValue === '0722000111', JSON.stringify(dupProfile.fields.phone))

  // age derived: declaredAge then DOB precedence
  await setDeclaredField(dup.id, 'declaredAge', '41', 'chat')
  const ageDeclared = await getAge(dup.id)
  await setDeclaredField(dup.id, 'dateOfBirth', '1990-05-01', 'collect_customer_field')
  const ageDob = await getAge(dup.id)
  check('age derived (declaredAge, then DOB wins)', ageDeclared === 41 && ageDob !== null && ageDob >= 35 && ageDob !== 41, `declared=${ageDeclared} dob=${ageDob}`)

  // merge: email moves, tombstone written, conversation re-pointed
  const email = `ssot-${stamp}@example.ro`
  await setDeclaredField(dup.id, 'email', email, 'collect_customer_field')
  const conv = await prisma.conversation.create({ data: { customerId: dup.id } })
  const report = await claimAndMerge(dup.id, canon.id)
  const canonAfter = await getProfile(canon.id)
  const tomb = await prisma.customer.findUnique({ where: { id: dup.id } })
  check('merge re-points conversations', (await prisma.conversation.findUnique({ where: { id: conv.id } }))?.customerId === canon.id && report.repointed.Conversation >= 1)
  check('merge keeps verified name on canonical', canonAfter.fields.name?.value === 'Ștefan Popa' && canonAfter.fields.name?.provenance === 'verified')
  check('merge moves the unique email to canonical', canonAfter.fields.email?.value === email && (await prisma.customer.findUnique({ where: { id: canon.id } }))?.email === email)
  check('duplicate tombstoned with mirrors cleared', tomb?.mergedIntoId === canon.id && tomb?.mergedAt !== null && tomb?.email === null)

  // ---- consent leg (B1.6): grant via sign → withdraw → halt → re-grant ----
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const codes = (await resolveGroupCodes(product.id, 'dnt', prisma)) ?? []
  const answerAll = async (conversationId: string, ctx: ToolContext) => {
    for (let i = 0; i < 100; i++) {
      const next = await getNextQuestion(codes, { kind: 'conversation', conversationId: conversationId })
      if (!next) break
      const q = next.question as { id: string; type: string; options: unknown; validationRules?: unknown; code?: string | null }
      let answer = 'da'
      if (q.code === 'DNT_CNP') answer = '1980418089861'
      else if (q.type === 'NUMBER') answer = '0'
      else if (Array.isArray(q.options) && q.options[0]) {
        const first = q.options[0] as { value?: unknown; label?: unknown } | string
        answer = typeof first === 'string' ? first : String(first.value ?? first.label ?? 'da')
      } else if (q.type === 'OPEN_ENDED') {
        const rules = (q.validationRules ?? {}) as { minLength?: number }
        if (rules.minLength) answer = 'x'.repeat(rules.minLength)
      }
      const r = await saveDntAnswer({ questionId: q.id, answer }, ctx)
      if (!r.success) throw new Error(`consent leg could not answer ${q.code ?? q.id}: ${r.error}`)
    }
  }
  const signViaGateway = async (customerId: string, conversationId: string, ctx: ToolContext) => {
    const consent = { gdpr: true, aiDisclosure: true }
    const first = await executeCommit({ tool: 'sign_dnt', args: { consent }, actor: 'gui', customerId, conversationId, toolContext: ctx })
    if (first.outcome !== 'requires_confirmation' || !first.confirmToken) return first
    return executeCommit({ tool: 'sign_dnt', args: { consent, confirmToken: first.confirmToken }, actor: 'gui', customerId, conversationId, toolContext: ctx })
  }

  const cc = await prisma.customer.create({ data: { language: 'ro' } })
  const conv1 = await prisma.conversation.create({ data: { customerId: cc.id, productId: product.id } })
  const ctx1 = { customerId: cc.id, conversationId: conv1.id, language: 'ro', db: prisma } as unknown as ToolContext
  await answerAll(conv1.id, ctx1)
  const signed1 = await signViaGateway(cc.id, conv1.id, ctx1)
  const consentsAfterSign = await loadDerivedConsents(cc.id)
  check('consent granted at signing (sign_dnt via gateway)', signed1.outcome === 'applied' && consentsAfterSign.gdprProcessing && consentsAfterSign.aiDisclosure, JSON.stringify({ signed1: signed1.outcome, consentsAfterSign }))

  const withdrawn = await executeCommit({ tool: 'withdraw_consent', args: { kind: 'gdpr_processing' }, actor: 'gui', customerId: cc.id, conversationId: conv1.id, toolContext: ctx1 })
  const halted = await executeCommit({ tool: 'set_candidate_product', args: { productId: product.id }, actor: 'gui', customerId: cc.id, conversationId: conv1.id, toolContext: ctx1 })
  check('withdrawal applies and halts writing commits', withdrawn.outcome === 'applied' && halted.outcome === 'rejected' && halted.reason === 'gdpr_processing_withdrawn', JSON.stringify({ withdrawn: withdrawn.outcome, halted }))

  const conv2 = await prisma.conversation.create({ data: { customerId: cc.id, productId: product.id } })
  const ctx2 = { customerId: cc.id, conversationId: conv2.id, language: 'ro', db: prisma } as unknown as ToolContext
  await answerAll(conv2.id, ctx2)
  const signed2 = await signViaGateway(cc.id, conv2.id, ctx2)
  const consentsAfterRegrant = await loadDerivedConsents(cc.id)
  check('re-grant path reachable while withdrawn (exempt DNT commits) and clears the halt', signed2.outcome === 'applied' && consentsAfterRegrant.gdprProcessing && !consentsAfterRegrant.gdprWithdrawn, JSON.stringify({ signed2: signed2.outcome, consentsAfterRegrant }))

  console.log(failures === 0 ? '\n==== customer-SSOT: all invariants PASS ====' : `\n==== customer-SSOT: ${failures} FAIL ====`)
  await prisma.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
