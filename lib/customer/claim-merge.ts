/**
 * claim-and-merge — fold a duplicate customer shell into the canonical one.
 *
 * Re-points aggregates through an extensible registry, merges profile fields
 * by the pure provenance rules, tombstones the duplicate, and clears its
 * unique/PII mirrors so the canonical customer can hold them.
 */
import { prisma } from '@/lib/db'
import { mergeFieldRecords, type FieldRecord } from '@/lib/engines/provenance-rules'
import { encodeFieldValue, decodeFieldValue } from '@/lib/customer/profile-service'

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

export interface MergeReport {
  canonicalId: string
  tombstonedId: string
  repointed: Record<string, number>
  conflicts: string[]
}

type Repointer = { table: string; run: (tx: Tx, dup: string, canon: string) => Promise<number> }

export const REPOINTERS: Repointer[] = [
  { table: 'Conversation', run: async (tx, d, c) => (await tx.conversation.updateMany({ where: { customerId: d }, data: { customerId: c } })).count },
  {
    table: 'Application',
    // partial unique: one OPEN/PAUSED/REFERRED application per (customer,
    // product). The duplicate's live application is the conversation's
    // activeApplicationId — the canonical's stale open sibling is superseded,
    // not the in-flight one.
    run: async (tx, d, c) => {
      const dupOpen = await tx.application.findMany({
        where: { customerId: d, status: { in: ['OPEN', 'PAUSED', 'REFERRED'] } }, select: { productId: true },
      })
      if (dupOpen.length) {
        await tx.application.updateMany({
          where: { customerId: c, status: { in: ['OPEN', 'PAUSED', 'REFERRED'] }, productId: { in: dupOpen.map(a => a.productId) } },
          data: { status: 'CANCELLED' },
        })
      }
      return (await tx.application.updateMany({ where: { customerId: d }, data: { customerId: c } })).count
    },
  },
  { table: 'Quote', run: async (tx, d, c) => (await tx.quote.updateMany({ where: { customerId: d }, data: { customerId: c } })).count },
  { table: 'Policy', run: async (tx, d, c) => (await tx.policy.updateMany({ where: { customerId: d }, data: { customerId: c } })).count },
  { table: 'Payment', run: async (tx, d, c) => (await tx.payment.updateMany({ where: { customerId: d }, data: { customerId: c } })).count },
  {
    table: 'CustomerInsight',
    // (customerId, key) is unique — when both customers hold the same key the
    // freshest lastConfirmedAt wins (tie → higher confidence, full tie →
    // canonical stays) and the loser row is deleted. Returns rows MOVED to
    // the canonical customer.
    run: async (tx, d, c) => {
      const [dupRows, canRows] = await Promise.all([
        tx.customerInsight.findMany({ where: { customerId: d } }),
        tx.customerInsight.findMany({ where: { customerId: c } }),
      ])
      const canByKey = new Map(canRows.map(r => [r.key, r]))
      let moved = 0
      for (const r of dupRows) {
        const existing = canByKey.get(r.key)
        const dupWins = !existing
          || (r.lastConfirmedAt.getTime() !== existing.lastConfirmedAt.getTime()
            ? r.lastConfirmedAt > existing.lastConfirmedAt
            : r.confidence > existing.confidence)
        if (dupWins) {
          if (existing) await tx.customerInsight.delete({ where: { id: existing.id } })
          await tx.customerInsight.update({ where: { id: r.id }, data: { customerId: c } })
          moved++
        } else {
          await tx.customerInsight.delete({ where: { id: r.id } })
        }
      }
      return moved
    },
  },
  { table: 'ConsentEvent', run: async (tx, d, c) => (await tx.consentEvent.updateMany({ where: { customerId: d }, data: { customerId: c } })).count },
  { table: 'Dnt', run: async (tx, d, c) => (await tx.dnt.updateMany({ where: { customerId: d }, data: { customerId: c } })).count },
  {
    table: 'DntSession',
    // partial unique: one ACTIVE session per customer — the duplicate's live
    // session wins; the canonical's stale ACTIVE one is cancelled.
    run: async (tx, d, c) => {
      if (await tx.dntSession.count({ where: { customerId: d, status: 'ACTIVE' } }) > 0) {
        await tx.dntSession.updateMany({
          where: { customerId: c, status: 'ACTIVE' },
          data: { status: 'CANCELLED', finishedAt: new Date() },
        })
      }
      return (await tx.dntSession.updateMany({ where: { customerId: d }, data: { customerId: c } })).count
    },
  },
  { table: 'VerificationChallenge', run: async (tx, d, c) => (await tx.verificationChallenge.updateMany({ where: { customerId: d }, data: { customerId: c } })).count },
  { table: 'CustomerDocument', run: async (tx, d, c) => (await tx.customerDocument.updateMany({ where: { customerId: d }, data: { customerId: c } })).count },
]

const MIRROR_FIELDS = ['email', 'phone', 'name', 'dateOfBirth'] as const

/** Decode a stored row into a comparable FieldRecord (cnp: envelope → plaintext, B0 erratum 2). */
const toRecord = (row: { field: string; value: string } & Omit<FieldRecord, 'value'>): FieldRecord =>
  ({ ...row, value: decodeFieldValue(row.field, row.value) })

/**
 * When called from inside a gateway commit, pass the gateway's transaction
 * client — opening a nested $transaction from a handler would touch rows the
 * outer tx already locked (e.g. the just-verified profile field) and
 * deadlock on the second connection (the E2 lesson, same class).
 */
export async function claimAndMerge(duplicateId: string, canonicalId: string, db?: Tx): Promise<MergeReport> {
  if (db) return runMerge(db, duplicateId, canonicalId)
  return prisma.$transaction(async tx => runMerge(tx, duplicateId, canonicalId))
}

async function runMerge(tx: Tx, duplicateId: string, canonicalId: string): Promise<MergeReport> {
    const repointed: Record<string, number> = {}
    for (const r of REPOINTERS) repointed[r.table] = await r.run(tx, duplicateId, canonicalId)

    const [dupF, canF] = await Promise.all([
      tx.customerProfileField.findMany({ where: { customerId: duplicateId } }),
      tx.customerProfileField.findMany({ where: { customerId: canonicalId } }),
    ])
    const canByField = new Map(canF.map(f => [f.field, f]))
    const conflicts: string[] = []
    for (const f of dupF) {
      const existing = canByField.get(f.field)
      const merged = mergeFieldRecords(
        existing ? toRecord(existing as unknown as Parameters<typeof toRecord>[0]) : null,
        toRecord(f as unknown as Parameters<typeof toRecord>[0]),
      )!
      if (merged.provenance === 'conflict') conflicts.push(f.field)
      const stored = encodeFieldValue(f.field, merged.value)
      await tx.customerProfileField.upsert({
        where: { customerId_field: { customerId: canonicalId, field: f.field } },
        create: { customerId: canonicalId, field: f.field, value: stored, provenance: merged.provenance, source: merged.source, evidenceRef: merged.evidenceRef, conflictValue: merged.conflictValue, conflictSource: merged.conflictSource, recordedAt: merged.recordedAt },
        update: { value: stored, provenance: merged.provenance, source: merged.source, evidenceRef: merged.evidenceRef, conflictValue: merged.conflictValue, conflictSource: merged.conflictSource, recordedAt: merged.recordedAt },
      })
      await tx.customerProfileField.delete({ where: { id: f.id } })
    }

    // tombstone: clear unique/PII mirrors on the duplicate FIRST, then mirror winners onto canonical
    const dupRow = await tx.customer.findUniqueOrThrow({ where: { id: duplicateId } })
    await tx.customer.update({
      where: { id: duplicateId },
      data: { email: null, phone: null, name: null, dateOfBirth: null, cnpEncrypted: null, cnpIv: null, cnpTag: null, mergedIntoId: canonicalId, mergedAt: new Date(), isAnonymous: true },
    })
    const canonRow = await tx.customer.findUniqueOrThrow({ where: { id: canonicalId } })
    const mirror: Record<string, unknown> = {}
    for (const mf of MIRROR_FIELDS) if (canonRow[mf] == null && dupRow[mf] != null) mirror[mf] = dupRow[mf]
    const winners = await tx.customerProfileField.findMany({ where: { customerId: canonicalId, field: { in: ['email', 'phone', 'name'] } } })
    for (const w of winners) mirror[w.field] = w.value
    if (Object.keys(mirror).length) await tx.customer.update({ where: { id: canonicalId }, data: mirror })

    return { canonicalId, tombstonedId: duplicateId, repointed, conflicts }
}
