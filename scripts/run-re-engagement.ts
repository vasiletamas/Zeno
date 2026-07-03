/**
 * Re-engagement job CLI (E4.6, M2) — the deploy story schedules this.
 *
 *   npx tsx scripts/run-re-engagement.ts --dry-run     # print candidates, send nothing
 *   npx tsx scripts/run-re-engagement.ts --seed-demo   # seed a synthetic expiring-quote customer first
 *   npx tsx scripts/run-re-engagement.ts               # live run (EMAIL_PROVIDER from env; mock default)
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { gatherCandidateRows, runReEngagementJob } from '@/lib/engagement/re-engagement-job'
import { RE_ENGAGEMENT_CONFIG } from '@/lib/engagement/config'
import { selectReEngagementCandidates } from '@/lib/engagement/select-candidates'
import { setDeclaredField } from '@/lib/customer/profile-service'

async function seedDemo() {
  const product = await prisma.product.findUniqueOrThrow({ where: { code: 'protect' } })
  const email = `re-engage-demo-${Date.now()}@example.com`
  const customer = await prisma.customer.create({ data: { email, language: 'ro' } })
  const conversation = await prisma.conversation.create({ data: { customerId: customer.id } })
  const app = await prisma.application.create({
    data: { customerId: customer.id, productId: product.id, status: 'COMPLETED', originConversationId: conversation.id },
  })
  await prisma.quote.create({
    data: {
      applicationId: app.id, productId: product.id, customerId: customer.id,
      premiumAnnual: 190, premiumMonthly: 15.83, coverages: {}, status: 'ISSUED',
      validUntil: new Date(Date.now() + 2 * 86400e3),
    },
  })
  await setDeclaredField(customer.id, 'name', 'Demo Re-Engage', 'seed-demo')
  await setDeclaredField(customer.id, 'dateOfBirth', '1990-01-01', 'seed-demo')
  await setDeclaredField(customer.id, 'cnp', '1900101080012', 'seed-demo')
  await setDeclaredField(customer.id, 'email', email, 'seed-demo')
  await setDeclaredField(customer.id, 'phone', '+40712345678', 'seed-demo')
  await prisma.verificationChallenge.create({
    data: { customerId: customer.id, channel: 'email', target: email, codeHash: 'seed-demo', expiresAt: new Date(Date.now() + 600_000), consumedAt: new Date() },
  })
  await prisma.consentEvent.create({ data: { customerId: customer.id, kind: 'marketing', action: 'granted' } })
  console.log(`seeded demo customer ${customer.id} (${email}) with a quote expiring in 2 days`)
}

async function main() {
  const args = new Set(process.argv.slice(2))
  if (args.has('--seed-demo')) await seedDemo()

  const now = new Date()
  if (args.has('--dry-run')) {
    const rows = await gatherCandidateRows(now)
    const candidates = selectReEngagementCandidates(rows, RE_ENGAGEMENT_CONFIG, now)
    console.log(`considered=${rows.length} candidates=${candidates.length}`)
    console.log('customerId'.padEnd(28), 'tier'.padEnd(18), 'mkt', 'trigger?', 'lastOutboundAt')
    for (const r of rows) {
      const c = candidates.find((x) => x.customerId === r.customerId)
      console.log(r.customerId.padEnd(28), r.identityTier.padEnd(18), String(r.marketingConsent).padEnd(3), (c?.trigger ?? '-').padEnd(18), r.lastOutboundAt?.toISOString() ?? '-')
    }
    return
  }

  const report = await runReEngagementJob({ now })
  console.log(`considered=${report.considered} sent=${report.sent.length} skipped=${report.skipped}`)
  for (const s of report.sent) console.log(`  sent → ${s.customerId} (${s.trigger})`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
