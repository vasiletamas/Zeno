/**
 * B3.8 runtime verification for the identity block on the dev DB.
 *
 * Legs: declared KYC → tier declared → OTP verify (gateway commits) → tier
 * verified_channel → a second anonymous shell claims the same email by
 * verifying it → merge into the owner → mock document validates → cnp/name
 * flip to verified provenance → a mismatching document queues review.
 * Prints PASS/FAIL per leg; exits non-zero on failure.
 *
 * Usage: npx tsx scripts/verify-identity-flow.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { setDeclaredField, getIdentityFacts } from '@/lib/customer/profile-service'
import { deriveIdentityTier } from '@/lib/engines/identity-rules'
import { processDocument } from '@/lib/identity/document-pipeline'
import { setMockExtraction } from '@/lib/identity/extraction-provider'
import type { ToolContext } from '@/lib/tools/types'

let failures = 0
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail && !ok ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

const makeCtx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

function lastIssuedCode(): string {
  const email = (globalThis as Record<string, unknown>).__lastMockEmail as { subject: string } | undefined
  const m = email?.subject.match(/\b(\d{6})\b/)
  if (!m) throw new Error('no code found in the last mock email')
  return m[1]
}

async function main() {
  process.env.EMAIL_PROVIDER = process.env.EMAIL_PROVIDER ?? 'mock'
  const stamp = Date.now()
  const email = `verify-id-${stamp}@example.ro`

  // leg 1: declared KYC → tier declared
  const customer = await prisma.customer.create({ data: { language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
  const ctx = makeCtx(customer.id, conv.id)
  await setDeclaredField(customer.id, 'name', 'Ana Pop', 'verify-script')
  await setDeclaredField(customer.id, 'cnp', '1980418089861', 'verify-script')
  await setDeclaredField(customer.id, 'dateOfBirth', '1998-04-18', 'verify-script')
  await setDeclaredField(customer.id, 'email', email, 'verify-script')
  await setDeclaredField(customer.id, 'phone', '0712345678', 'verify-script')
  const tier1 = deriveIdentityTier(await getIdentityFacts(customer.id))
  check('full consistent declared KYC derives tier=declared', tier1 === 'declared', tier1)

  // leg 2: OTP verify through the gateway → verified_channel
  const started = await executeCommit({ tool: 'start_channel_verification', actor: 'agent', customerId: customer.id, conversationId: conv.id, args: { channel: 'email', target: email }, toolContext: ctx })
  const antiEnum = !/exists|found|match/i.test(JSON.stringify(started.data ?? {}))
  const confirmed = await executeCommit({ tool: 'confirm_channel_verification', actor: 'gui', customerId: customer.id, conversationId: conv.id, args: { code: lastIssuedCode() }, toolContext: ctx })
  const tier2 = deriveIdentityTier(await getIdentityFacts(customer.id))
  check('OTP start (anti-enumeration payload) + confirm applies → tier=verified_channel',
    started.outcome === 'applied' && antiEnum && confirmed.outcome === 'applied' && tier2 === 'verified_channel',
    JSON.stringify({ started: started.outcome, confirmed: confirmed.outcome, tier2 }))

  // leg 3: a second anonymous shell claims the same email by verifying it
  const shell = await prisma.customer.create({ data: { language: 'ro' } })
  const conv2 = await prisma.conversation.create({ data: { customerId: shell.id } })
  const ctx2 = makeCtx(shell.id, conv2.id)
  await executeCommit({ tool: 'start_channel_verification', actor: 'agent', customerId: shell.id, conversationId: conv2.id, args: { channel: 'email', target: email }, toolContext: ctx2 })
  const claim = await executeCommit({ tool: 'confirm_channel_verification', actor: 'gui', customerId: shell.id, conversationId: conv2.id, args: { code: lastIssuedCode() }, toolContext: ctx2 })
  const shellAfter = await prisma.customer.findUniqueOrThrow({ where: { id: shell.id } })
  const convAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: conv2.id } })
  check('verified claim merges the shell INTO the owner and repoints the conversation',
    claim.outcome === 'applied' && (claim.data as { customerId?: string }).customerId === customer.id && shellAfter.mergedIntoId === customer.id && convAfter.customerId === customer.id,
    JSON.stringify({ outcome: claim.outcome, mergedInto: shellAfter.mergedIntoId }))

  // leg 4: matching document flips fields to verified
  setMockExtraction({ name: 'Ana Pop', cnp: '1980418089861', expiryDate: '2031-01-01' })
  const doc = await prisma.customerDocument.create({ data: { customerId: customer.id, kind: 'id_card', encryptedData: Buffer.from('img'), dataIv: 'iv', dataTag: 'tag' } })
  const events: string[] = []
  const processed = await processDocument(doc.id, { onFieldVerified: (e) => events.push(e.field) })
  const cnpRow = await prisma.customerProfileField.findUniqueOrThrow({ where: { customerId_field: { customerId: customer.id, field: 'cnp' } } })
  check('matching document validates: cnp verified + mutation events emitted',
    processed.status === 'validated' && cnpRow.provenance === 'verified' && events.includes('cnp'),
    JSON.stringify({ status: processed.status, cnp: cnpRow.provenance, events }))

  // leg 5: mismatching/expired document queues DOCUMENT_REVIEW
  setMockExtraction({ name: 'Alta Persoana', cnp: '1980418089862', expiryDate: '2020-01-01' })
  const badDoc = await prisma.customerDocument.create({ data: { customerId: customer.id, kind: 'id_card', encryptedData: Buffer.from('img'), dataIv: 'iv', dataTag: 'tag' } })
  const reviewed = await processDocument(badDoc.id, { onFieldVerified: () => {} })
  const reviewItem = await prisma.workItem.findFirst({ where: { kind: 'DOCUMENT_REVIEW', status: 'OPEN', refs: { path: ['customerDocumentId'], equals: badDoc.id } } })
  check('mismatch/expired document → review + OPEN DOCUMENT_REVIEW WorkItem',
    reviewed.status === 'review' && reviewed.findings.includes('document_expired') && reviewed.findings.includes('cnp_checksum_invalid') && reviewItem !== null,
    JSON.stringify({ status: reviewed.status, findings: reviewed.findings, item: reviewItem !== null }))

  console.log(failures === 0 ? '\n==== identity-flow: all invariants PASS ====' : `\n==== identity-flow: ${failures} FAIL ====`)
  await prisma.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
