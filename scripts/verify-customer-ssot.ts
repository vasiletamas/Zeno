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

  console.log(failures === 0 ? '\n==== customer-SSOT: all invariants PASS ====' : `\n==== customer-SSOT: ${failures} FAIL ====`)
  await prisma.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
