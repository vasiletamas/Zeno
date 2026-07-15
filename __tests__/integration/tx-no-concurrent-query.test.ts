/**
 * P2-9 (2026-07-15 hardening): app-level code must not run concurrent queries
 * on a single transaction connection — pg deprecates client.query() while the
 * client is mid-query (removed in pg@9). This guards the flagged sites
 * (claim-merge) whose Promise.all-on-tx was the source.
 *
 * Node dedupes a DeprecationWarning code once per process, so a
 * process.on('warning') listener is unreliable (the code has usually already
 * fired during seeding). Instead we instrument pg's Client.query to record any
 * SECOND query started on a client already mid-query — the exact deprecation
 * condition — which bypasses the dedup entirely.
 *
 * Prisma's query engine already serializes MODEL queries within an interactive
 * transaction, so an app-level Promise.all over tx.model.* is safe today — but
 * that is undocumented and fragile, and raw queries (tx.$queryRaw) are NOT
 * serialized. This guards against a future regression that Promise.all's raw
 * or otherwise-concurrent queries onto a single transaction connection.
 */
import { it, expect, beforeEach, afterAll } from 'vitest'
import pg from 'pg'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { claimAndMerge } from '@/lib/customer/claim-merge'
import { setDeclaredField, setVerifiedField } from '@/lib/customer/profile-service'

type PatchedClient = pg.Client & { __zfInFlight?: boolean }
const overlaps: string[] = []
const originalQuery = pg.Client.prototype.query
// per-client in-flight flag: a second query on a client already executing one
// is the pg@9 deprecation condition.
;(pg.Client.prototype as { query: unknown }).query = function (this: PatchedClient, ...args: unknown[]) {
  if (this.__zfInFlight) overlaps.push('concurrent query on a single client')
  this.__zfInFlight = true
  const result = (originalQuery as (...a: unknown[]) => unknown).apply(this, args)
  Promise.resolve(result).finally(() => { this.__zfInFlight = false }).catch(() => {})
  return result as ReturnType<pg.Client['query']>
}
afterAll(() => { (pg.Client.prototype as { query: unknown }).query = originalQuery })

beforeEach(async () => { await resetDb() })

it('claimAndMerge runs no concurrent queries on its transaction connection', async () => {
  const canon = await createCustomer()
  await setVerifiedField(canon.id, 'name', 'Ion Popescu', 'document_extraction', 'ev-1')
  await prisma.customerInsight.create({ data: { customerId: canon.id, category: 'DEMOGRAPHIC', key: 'age', value: '30', confidence: 0.9, source: 'test', lastConfirmedAt: new Date() } })
  const dup = await createCustomer()
  await setDeclaredField(dup.id, 'name', 'Ionel Popescu', 'collect_customer_field')
  await prisma.customerInsight.create({ data: { customerId: dup.id, category: 'DEMOGRAPHIC', key: 'age', value: '31', confidence: 0.5, source: 'test', lastConfirmedAt: new Date() } })
  await prisma.conversation.create({ data: { customerId: dup.id } })

  overlaps.length = 0
  await claimAndMerge(dup.id, canon.id)
  expect(overlaps).toEqual([])
})
