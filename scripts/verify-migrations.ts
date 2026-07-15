/**
 * P1-7: prove the migration chain deploys cleanly on a FRESH empty database
 * and UPGRADES a database representing current `main` — both on DISPOSABLE
 * databases that are dropped afterward. NEVER touches the dev/test databases.
 *
 * Run: npx tsx scripts/verify-migrations.ts
 * Requires DATABASE_URL reachable (a disposable db is created off the same
 * server). Exits non-zero on any failure.
 *
 * The main-schema database for scenario [2] is provisioned by REPLAYING the
 * baseline_main migration SQL directly (that migration IS "empty -> main
 * schema"), so we never run `prisma db push` (which would regenerate the client
 * from the main schema and clobber the v3 client).
 */
import { execSync } from 'node:child_process'
import { Client } from 'pg'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const MIGRATIONS = join(ROOT, 'prisma', 'migrations')

function base(): string {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL must be set (used to reach the postgres server; a disposable db is created off it)')
  return raw.replace(/\/[^/?]+(\?|$)/, '/PLACEHOLDER$1')
}
const dbUrl = (name: string) => base().replace('PLACEHOLDER', name)
const adminUrl = () => dbUrl('postgres')

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url })
  await c.connect()
  try { return await fn(c) } finally { await c.end() }
}
const createDb = (name: string) => withClient(adminUrl(), async (c) => {
  await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  await c.query(`CREATE DATABASE "${name}"`)
})
const dropDb = (name: string) => withClient(adminUrl(), async (c) => { await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`) })
const query = <T = Record<string, unknown>>(url: string, sql: string) => withClient(url, async (c) => (await c.query(sql)).rows as T[])
const run = (cmd: string, url: string) => execSync(cmd, { cwd: ROOT, stdio: 'pipe', env: { ...process.env, DATABASE_URL: url } })

const EXPECTED_PARTIAL_INDEXES = [
  'DntSession_one_active_per_customer',
  'Application_one_open_per_product',
  'answer_active_unique',
  'ProductContent_product_level_unique',
  'Payment_one_open_per_installment',
]
const EXPECTED_V3_TABLES = [
  'Customer', 'Conversation', 'Application', 'Quote', 'Policy', 'Payment',
  'PaymentSchedule', 'Installment', 'PaymentEvent', 'DisclosureAck',
  'VerificationChallenge', 'CustomerProfileField', 'CustomerDocument',
  'Dnt', 'DntSession', 'DntAnswer', 'WorkItem', 'ConsentEvent', 'CommitLedger',
  'ProductContent', 'MedicalDeclarationSignature', 'Document', 'SuitabilityWarningAck',
]
const RETIRED_MAIN_TABLES = ['Workflow', 'WorkflowStep', 'StepTransition', 'WorkflowSession', 'SkillPack']

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function assertNoStructuralDrift(url: string, label: string) {
  // migrate diff schema -> live db; the ONLY tolerated differences are the
  // raw-SQL partial unique indexes Prisma cannot express (they live in the seed).
  // Prisma 7: --to-url was removed; --to-config-datasource reads the datasource
  // from prisma.config.ts, which resolves DATABASE_URL from the environment.
  const out = execSync(
    `npx prisma migrate diff --from-schema prisma/schema.prisma --to-config-datasource prisma.config.ts --script`,
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url } },
  )
  const meaningful = out.split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('--'))
    .filter((l) => !(/DROP INDEX/i.test(l) && EXPECTED_PARTIAL_INDEXES.some((i) => l.includes(i))))
  check(`${label}: no structural drift vs schema.prisma`, meaningful.length === 0, meaningful.slice(0, 3).join(' | '))
}

async function scenarioFresh() {
  const name = 'zeno_mig_fresh'
  console.log('\n[1] FRESH empty database -> migrate deploy')
  await createDb(name)
  const url = dbUrl(name)
  try {
    run('npx prisma migrate deploy', url)
    check('migrate deploy succeeded', true)
    const tables = (await query<{ tablename: string }>(url, `SELECT tablename FROM pg_tables WHERE schemaname='public'`)).map((r) => r.tablename)
    for (const t of EXPECTED_V3_TABLES) check(`table ${t} exists`, tables.includes(t))
    for (const t of RETIRED_MAIN_TABLES) check(`retired table ${t} absent`, !tables.includes(t))
    await assertNoStructuralDrift(url, 'fresh')
    run('npx tsx prisma/seeds/index.ts', url)
    check('seed succeeded', true)
    const idx = (await query<{ indexname: string }>(url, `SELECT indexname FROM pg_indexes WHERE schemaname='public'`)).map((r) => r.indexname)
    for (const i of EXPECTED_PARTIAL_INDEXES) check(`partial index ${i} present after seed`, idx.includes(i))
    const products = await query<{ n: string }>(url, `SELECT count(*)::text AS n FROM "Product"`)
    check('catalog seeded (>=1 product)', Number(products[0].n) >= 1)
  } finally {
    await dropDb(name)
  }
}

async function scenarioUpgrade() {
  const name = 'zeno_mig_upgrade'
  console.log('\n[2] UPGRADE from a main-schema database with representative data')
  await createDb(name)
  const url = dbUrl(name)
  try {
    // provision the main schema by replaying the baseline migration SQL
    const baselineSql = readFileSync(join(MIGRATIONS, '20260101000000_baseline_main', 'migration.sql'), 'utf8')
    await withClient(url, (c) => c.query(baselineSql))
    check('main schema provisioned (baseline SQL replay)', true)
    // representative DURABLE data (Answer/Payment drained per the migration note)
    await query(url, `INSERT INTO "Customer" (id, "createdAt", "updatedAt") VALUES ('cust_mig_1', now(), now())`)
    await query(url, `INSERT INTO "Product"
      (id, code, name, description, "insuranceType", "subType", eligibility, features, exclusions,
       "defaultPlaybook", "pricingExplanation", "targetCustomer", "targetAgeRange", "contractTerm",
       "gracePeriod", "territoryCoverage", "isActive", "createdAt", "updatedAt")
      VALUES ('prod_mig_1', 'legacy', '{"ro":"Legacy"}'::jsonb, '{"ro":"-"}'::jsonb, 'LIFE', 'TERM', '{}'::jsonb,
       ARRAY[]::text[], ARRAY[]::text[], '-', '-', '-', '-', '-', '-', 'RO', true, now(), now())`)
    await query(url, `INSERT INTO "Conversation" (id, "customerId", status, "createdAt", "updatedAt") VALUES ('conv_mig_1', 'cust_mig_1', 'ACTIVE', now(), now())`)

    // the db already matches baseline_main -> mark it applied, deploy only the delta
    run('npx prisma migrate resolve --applied 20260101000000_baseline_main', url)
    check('baseline resolved as applied (existing main db)', true)
    run('npx prisma migrate deploy', url)
    check('v3_upgrade deploy succeeded on the main db', true)

    const tables = (await query<{ tablename: string }>(url, `SELECT tablename FROM pg_tables WHERE schemaname='public'`)).map((r) => r.tablename)
    for (const t of RETIRED_MAIN_TABLES) check(`retired table ${t} dropped`, !tables.includes(t))
    check('PaymentSchedule table created', tables.includes('PaymentSchedule'))
    const cust = await query<{ n: string }>(url, `SELECT count(*)::text AS n FROM "Customer" WHERE id='cust_mig_1'`)
    check('customer row preserved', Number(cust[0].n) === 1)
    const prod = await query<{ it: string }>(url, `SELECT "insuranceType"::text AS it FROM "Product" WHERE id='prod_mig_1'`)
    check('product insuranceType cast to enum (data preserved)', prod[0]?.it === 'LIFE')
    const conv = await query<{ n: string }>(url, `SELECT count(*)::text AS n FROM "Conversation" WHERE id='conv_mig_1'`)
    check('conversation row preserved', Number(conv[0].n) === 1)
    await assertNoStructuralDrift(url, 'upgrade')
  } finally {
    await dropDb(name)
  }
}

async function main() {
  console.log('Verifying the Zeno v3 migration chain on disposable databases...')
  await scenarioFresh()
  await scenarioUpgrade()
  console.log(`\n${failures === 0 ? 'ALL MIGRATION CHECKS PASSED' : `${failures} MIGRATION CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error('verify-migrations crashed:', e); process.exit(1) })
