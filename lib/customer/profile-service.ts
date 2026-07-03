/**
 * profile-service — the ONLY read/write path for profile facts (M1).
 *
 * Facts live in CustomerProfileField with provenance; a few fields are
 * mirrored onto legacy Customer columns so existing consumers keep working.
 * cnp is stored as the AES-GCM JSON envelope and masked on read.
 */
import { prisma } from '@/lib/db'
import { Prisma } from '@/lib/generated/prisma/client'
import { encrypt, decrypt, maskCnp } from '@/lib/security/encryption'
import { resolveDeclaredWrite, resolveVerifiedWrite, type FieldRecord } from '@/lib/engines/provenance-rules'

export type ProfileFieldName = 'name' | 'cnp' | 'dateOfBirth' | 'declaredAge' | 'email' | 'phone' | 'address'

export type ProfileWriteResult =
  | { outcome: 'applied'; provenance: FieldRecord['provenance']; mirrorConflict?: string }
  | { outcome: 'rejected'; reason: 'field_verified_immutable' }

type Db = Pick<typeof prisma, 'customerProfileField' | 'customer' | 'verificationChallenge'>

const MIRROR: Partial<Record<ProfileFieldName, (v: string) => Record<string, unknown>>> = {
  email: v => ({ email: v }),
  phone: v => ({ phone: v.replace(/[\s-]/g, '') }),
  name: v => ({ name: v }),
  dateOfBirth: v => ({ dateOfBirth: new Date(v) }),
  cnp: v => { const e = encrypt(v); return { cnpEncrypted: e.encrypted, cnpIv: e.iv, cnpTag: e.tag } },
}

export const encodeFieldValue = (f: ProfileFieldName | string, v: string) =>
  f === 'cnp' ? JSON.stringify(encrypt(v)) : v
export const decodeFieldValue = (f: ProfileFieldName | string, v: string) => {
  if (f !== 'cnp') return v
  const e = JSON.parse(v) as { encrypted: string; iv: string; tag: string }
  return decrypt(e.encrypted, e.iv, e.tag)
}

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'

async function applyWrite(
  db: Db,
  customerId: string,
  field: ProfileFieldName,
  decision: ReturnType<typeof resolveDeclaredWrite>,
): Promise<ProfileWriteResult> {
  if (decision.action === 'reject') return { outcome: 'rejected', reason: decision.reason }
  if (decision.action === 'write') {
    const n = decision.next
    await db.customerProfileField.upsert({
      where: { customerId_field: { customerId, field } },
      create: { customerId, field, value: encodeFieldValue(field, n.value), provenance: n.provenance, source: n.source, evidenceRef: n.evidenceRef, conflictValue: n.conflictValue, conflictSource: n.conflictSource, recordedAt: n.recordedAt },
      update: { value: encodeFieldValue(field, n.value), provenance: n.provenance, source: n.source, evidenceRef: n.evidenceRef, conflictValue: n.conflictValue, conflictSource: n.conflictSource, recordedAt: n.recordedAt },
    })
    if (MIRROR[field]) {
      // B0 erratum 3: an email already mirrored on another Customer (@unique)
      // is the returning-customer case — keep the provenance row, skip the
      // mirror, surface the collision so the caller can offer the T4.D4
      // verified-claim path. Detected by PRE-CHECK, not by catching P2002:
      // inside a gateway transaction a unique violation ABORTS the tx (B3.5).
      if (field === 'email') {
        const holder = await db.customer.findFirst({ where: { email: n.value, id: { not: customerId } } })
        if (holder) return { outcome: 'applied', provenance: n.provenance, mirrorConflict: 'email_in_use' }
      }
      try {
        await db.customer.update({ where: { id: customerId }, data: MIRROR[field]!(n.value) })
      } catch (e) {
        // race fallback (only reachable outside a transaction)
        if (!isUniqueViolation(e)) throw e
        return { outcome: 'applied', provenance: n.provenance, mirrorConflict: `${field}_in_use` }
      }
    }
    return { outcome: 'applied', provenance: n.provenance }
  }
  return { outcome: 'applied', provenance: 'declared' }
}

async function existingRecord(db: Db, customerId: string, field: ProfileFieldName): Promise<FieldRecord | null> {
  const r = await db.customerProfileField.findUnique({ where: { customerId_field: { customerId, field } } })
  return r ? ({ ...r, value: decodeFieldValue(field, r.value) } as FieldRecord) : null
}

export async function setDeclaredField(customerId: string, field: ProfileFieldName, value: string, source: string, db: Db = prisma): Promise<ProfileWriteResult> {
  return applyWrite(db, customerId, field, resolveDeclaredWrite(await existingRecord(db, customerId, field), { value, source, at: new Date() }))
}

export async function setVerifiedField(customerId: string, field: ProfileFieldName, value: string, source: string, evidenceRef: string, db: Db = prisma): Promise<ProfileWriteResult> {
  return applyWrite(db, customerId, field, resolveVerifiedWrite(await existingRecord(db, customerId, field), { value, source, evidenceRef, at: new Date() }))
}

/**
 * Identity facts for tier derivation (B3.2) — INTERNAL: cnp is decrypted so
 * deriveIdentityTier can checksum it; never serialize these values outward
 * (the snapshot stores only the derived tier + field presence/provenance).
 * verifiedChannels = channels with a CONSUMED VerificationChallenge (B3.4);
 * invalidated/expired challenges never count.
 */
export async function getIdentityFacts(customerId: string, db: Db = prisma): Promise<{
  fields: Partial<Record<'name' | 'cnp' | 'dateOfBirth' | 'email' | 'phone', { value: string; provenance: 'declared' | 'verified' | 'conflict' }>>
  verifiedChannels: ('email' | 'sms')[]
}> {
  const rows = await db.customerProfileField.findMany({ where: { customerId } })
  const fields: Record<string, { value: string; provenance: 'declared' | 'verified' | 'conflict' }> = {}
  for (const r of rows) {
    if (!['name', 'cnp', 'dateOfBirth', 'email', 'phone'].includes(r.field)) continue
    fields[r.field] = { value: decodeFieldValue(r.field, r.value), provenance: r.provenance as 'declared' | 'verified' | 'conflict' }
  }
  const consumed = await db.verificationChallenge.findMany({
    where: { customerId, consumedAt: { not: null } },
    select: { channel: true },
    distinct: ['channel'],
  })
  return { fields, verifiedChannels: consumed.map((r) => r.channel) }
}

export async function getProfile(customerId: string) {
  const rows = await prisma.customerProfileField.findMany({ where: { customerId } })
  const fields: Record<string, { value: string; provenance: string; source: string; evidenceRef: string | null; conflictValue: string | null; conflictSource: string | null; recordedAt: Date }> = {}
  for (const r of rows) fields[r.field] = { ...r, value: r.field === 'cnp' ? maskCnp(decodeFieldValue('cnp', r.value)) : r.value }
  return { customerId, fields, conflicts: rows.filter(r => r.provenance === 'conflict').map(r => r.field) }
}

export async function getAge(customerId: string, now = new Date(), db: Db = prisma): Promise<number | null> {
  const dob = await existingRecord(db, customerId, 'dateOfBirth')
  if (dob) {
    const d = new Date(dob.value)
    let a = now.getFullYear() - d.getFullYear()
    const m = now.getMonth() - d.getMonth()
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--
    return a
  }
  const decl = await existingRecord(db, customerId, 'declaredAge')
  return decl ? Number(decl.value) : null
}
