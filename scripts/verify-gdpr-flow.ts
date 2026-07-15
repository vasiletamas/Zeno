/**
 * E3.6 GDPR flow verification (dev DB): erasure request→approval with the
 * per-class retention report, the verified-channel export gate, and the
 * export bundle on the resolved WorkItem. Demo data — destructive run
 * acceptable; reseed with `npx tsx prisma/seeds/index.ts` afterwards.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/verify-gdpr-flow.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { setDeclaredField } from '@/lib/customer/profile-service'
import { RETENTION_POLICIES, DATA_CLASSES } from '@/lib/gdpr/retention-policy'
import type { ToolContext } from '@/lib/tools/types'

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS — ${name}`)
  else { failures += 1; console.error(`FAIL — ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

const ctxFor = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

async function main() {
  console.log('== retention table ==')
  for (const dc of DATA_CLASSES) {
    const p = RETENTION_POLICIES[dc]
    console.log(`  ${dc.padEnd(24)} never-contracted=${p.whenNeverContracted.padEnd(16)} contracted=${p.whenContracted.padEnd(16)} legalReviewPending=${p.legalReviewPending}`)
  }

  // ── leg 1: erasure request → operator approval (never-contracted) ────
  const customer = await prisma.customer.create({ data: { name: 'Verify Erase', email: `verify-erase-${Date.now()}@example.com`, phone: '0700000001' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
  await prisma.message.create({ data: { conversationId: conv.id, role: 'user', content: 'stergeti-mi datele' } })
  await prisma.customerInsight.create({ data: { customerId: customer.id, key: 'budgetPreference', category: 'BUYING_SIGNAL', value: 'lowest', source: 'verify' } })

  const requested = await executeCommit({ tool: 'request_erasure', actor: 'agent', conversationId: conv.id, customerId: customer.id, args: { reason: 'verify sim' }, toolContext: ctxFor(customer.id, conv.id) })
  check('request_erasure applied (agent)', requested.outcome === 'applied', requested)
  const untouched = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })
  check('data untouched until approval', untouched.name === 'Verify Erase')

  const item = await prisma.workItem.findFirstOrThrow({ where: { kind: 'GDPR_ERASURE', status: 'OPEN' }, orderBy: { createdAt: 'desc' } })
  const approved = await executeCommit({ tool: 'approve_erasure', actor: 'operator', conversationId: conv.id, customerId: customer.id, args: { workItemId: item.id }, toolContext: ctxFor(customer.id, conv.id) })
  check('approve_erasure applied (operator)', approved.outcome === 'applied', approved)

  const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })
  check('customer tombstoned (PII nulled + erasedAt)', after.name === null && after.email === null && after.erasedAt !== null)
  check('never-contracted conversations fully deleted', (await prisma.conversation.count({ where: { customerId: customer.id } })) === 0)
  const resolvedItem = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } })
  const report = resolvedItem.payload as { classResults?: { dataClass: string; disposition: string; affected: number }[] } | null
  check('work item RESOLVED with the per-class report', resolvedItem.status === 'RESOLVED' && Array.isArray(report?.classResults) && report!.classResults!.length === DATA_CLASSES.length)
  check('ledger carries both commits', (await prisma.commitLedger.count({ where: { customerId: customer.id, tool: { in: ['request_erasure', 'approve_erasure'] }, outcome: 'applied' } })) === 2)
  if (report?.classResults) {
    console.log('  per-class erasure report:')
    for (const c of report.classResults) console.log(`    ${c.dataClass.padEnd(24)} ${c.disposition.padEnd(16)} affected=${c.affected}`)
  }

  // ── leg 2: export gate + bundle ───────────────────────────────────────
  const anon = await prisma.customer.create({ data: {} })
  const anonConv = await prisma.conversation.create({ data: { customerId: anon.id } })
  const gated = await executeCommit({ tool: 'request_data_export', actor: 'agent', conversationId: anonConv.id, customerId: anon.id, args: {}, toolContext: ctxFor(anon.id, anonConv.id) })
  check('anonymous request_data_export → requires_identity(verified_channel)', gated.outcome === 'requires_identity' && (gated.needs ?? []).includes('verified_channel'), gated)

  const verified = await prisma.customer.create({ data: {} })
  await setDeclaredField(verified.id, 'name', 'Ion Verificat', 'verify')
  await setDeclaredField(verified.id, 'dateOfBirth', '1990-01-01', 'verify')
  await setDeclaredField(verified.id, 'cnp', '1900101080012', 'verify')
  const email = `verify-export-${Date.now()}@example.com`
  await setDeclaredField(verified.id, 'email', email, 'verify')
  await setDeclaredField(verified.id, 'phone', '+40712345678', 'verify')
  await prisma.verificationChallenge.create({
    data: { customerId: verified.id, channel: 'email', target: email, codeHash: 'verify', expiresAt: new Date(Date.now() + 600_000), consumedAt: new Date() },
  })
  const vConv = await prisma.conversation.create({ data: { customerId: verified.id } })
  await prisma.message.create({ data: { conversationId: vConv.id, role: 'user', content: 'vreau o copie a datelor mele' } })

  const exportReq = await executeCommit({ tool: 'request_data_export', actor: 'agent', conversationId: vConv.id, customerId: verified.id, args: {}, toolContext: ctxFor(verified.id, vConv.id) })
  check('verified request_data_export applied', exportReq.outcome === 'applied', exportReq)
  const exportItem = await prisma.workItem.findFirstOrThrow({ where: { kind: 'GDPR_EXPORT', status: 'OPEN' }, orderBy: { createdAt: 'desc' } })
  const exportApproved = await executeCommit({ tool: 'approve_export', actor: 'operator', conversationId: vConv.id, customerId: verified.id, args: { workItemId: exportItem.id }, toolContext: ctxFor(verified.id, vConv.id) })
  check('approve_export applied (operator)', exportApproved.outcome === 'applied', exportApproved)
  const resolvedExport = await prisma.workItem.findUniqueOrThrow({ where: { id: exportItem.id } })
  const bundle = resolvedExport.payload as { schemaVersion?: number; conversations?: unknown[]; profile?: { identityTier?: string } } | null
  check('bundle stored on the RESOLVED item (schemaVersion 1, conversations, verified tier)',
    resolvedExport.status === 'RESOLVED' && bundle?.schemaVersion === 1 && (bundle?.conversations ?? []).length === 1 && bundle?.profile?.identityTier === 'verified_channel',
    bundle && { schemaVersion: bundle.schemaVersion, tier: bundle.profile?.identityTier })

  if (failures > 0) {
    console.error(`\n==== gdpr-flow: ${failures} FAILURE(S) ====`)
    process.exit(1)
  }
  console.log('\n==== gdpr-flow: all invariants PASS ====')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
