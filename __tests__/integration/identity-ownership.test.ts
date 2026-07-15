/**
 * P0-1 (2026-07-15 hardening): verified-channel OWNERSHIP comes only from
 * consumed verification evidence — a merely DECLARED Customer.email/phone
 * mirror never absorbs a verifier.
 *
 * The attack this kills: attacker pre-declares the victim's email (receives
 * the mutable mirror without proving control) → victim later verifies that
 * same address → the old code merged the VICTIM's shell into the attacker's
 * customer, handing the attacker the victim's conversations, applications,
 * quotes, policies and payments.
 *
 * Both challenge presentations (in-chat OTP and magic link) go through the
 * same applyVerifiedClaim, so both are covered here at the service layer.
 */
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, createCustomer } from '@/__tests__/helpers/test-db'
import { setDeclaredField } from '@/lib/customer/profile-service'
import {
  issueChallenge,
  confirmByCode,
  confirmByLinkToken,
  applyVerifiedClaim,
  type ConfirmResult,
} from '@/lib/customer/verification-service'
import type { EmailProvider } from '@/lib/email/types'

beforeEach(async () => { await resetFunnelTables() })

const silentProvider: EmailProvider = { send: async () => ({ messageId: 'test-silent' }) }

/** Issue + confirm a challenge for `customerId` on `target`, returning the ok ConfirmResult. */
async function verifyTarget(customerId: string, target: string): Promise<Extract<ConfirmResult, { ok: true }>> {
  const { code } = await issueChallenge(customerId, 'email', target, null, prisma, silentProvider)
  const r = await confirmByCode(customerId, code)
  if (!r.ok) throw new Error(`confirmByCode failed: ${r.reason}`)
  return r
}

it('ATTACK: a pre-declared (unverified) mirror holder never absorbs the verifier — the victim keeps their own customer and wins the mirror', async () => {
  const attacker = await createCustomer()
  await setDeclaredField(attacker.id, 'email', 'victim@example.ro', 'collect_customer_field')
  expect((await prisma.customer.findUniqueOrThrow({ where: { id: attacker.id } })).email).toBe('victim@example.ro')

  const victim = await createCustomer()
  const victimConv = await prisma.conversation.create({ data: { customerId: victim.id } })
  const victimQuoteApp = await prisma.application.create({
    data: { customerId: victim.id, productId: (await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })).id, status: 'OPEN' },
  })

  const r = await verifyTarget(victim.id, 'victim@example.ro')
  const claim = await applyVerifiedClaim(r)

  // the verifier is NOT merged anywhere
  expect(claim.merged).toBe(false)
  expect(claim.customerId).toBe(victim.id)
  const victimRow = await prisma.customer.findUniqueOrThrow({ where: { id: victim.id } })
  expect(victimRow.mergedIntoId).toBeNull()
  // the victim's records stay theirs
  expect((await prisma.conversation.findUniqueOrThrow({ where: { id: victimConv.id } })).customerId).toBe(victim.id)
  expect((await prisma.application.findUniqueOrThrow({ where: { id: victimQuoteApp.id } })).customerId).toBe(victim.id)
  // the unproven mirror is released to the party that PROVED control
  expect((await prisma.customer.findUniqueOrThrow({ where: { id: attacker.id } })).email).toBeNull()
  expect(victimRow.email).toBe('victim@example.ro')
})

it('ATTACK via magic link: same negative outcome through confirmByLinkToken', async () => {
  const attacker = await createCustomer()
  await setDeclaredField(attacker.id, 'email', 'linked@example.ro', 'collect_customer_field')
  const victim = await createCustomer()
  const { linkToken } = await issueChallenge(victim.id, 'email', 'linked@example.ro', null, prisma, silentProvider)
  const r = await confirmByLinkToken(linkToken)
  if (!r.ok) throw new Error('link confirm failed')
  const claim = await applyVerifiedClaim(r)
  expect(claim.merged).toBe(false)
  expect(claim.customerId).toBe(victim.id)
  expect((await prisma.customer.findUniqueOrThrow({ where: { id: victim.id } })).mergedIntoId).toBeNull()
})

it('LEGIT returning customer: a shell verifying a target the owner previously VERIFIED (consumed evidence) merges into that owner', async () => {
  const owner = await createCustomer({ isAnonymous: false })
  // the owner's own past verification IS the ownership evidence
  await verifyTarget(owner.id, 'ana@example.ro')

  const shell = await createCustomer()
  const shellConv = await prisma.conversation.create({ data: { customerId: shell.id } })
  const r = await verifyTarget(shell.id, 'ana@example.ro')
  const claim = await applyVerifiedClaim(r)

  expect(claim.merged).toBe(true)
  expect(claim.customerId).toBe(owner.id)
  expect((await prisma.customer.findUniqueOrThrow({ where: { id: shell.id } })).mergedIntoId).toBe(owner.id)
  expect((await prisma.conversation.findUniqueOrThrow({ where: { id: shellConv.id } })).customerId).toBe(owner.id)
})

it('normalization: evidence matches case-insensitively for email (Ana@Example.RO ≡ ana@example.ro)', async () => {
  const owner = await createCustomer({ isAnonymous: false })
  await verifyTarget(owner.id, 'Ana@Example.RO')
  const shell = await createCustomer()
  const r = await verifyTarget(shell.id, 'ana@example.ro')
  const claim = await applyVerifiedClaim(r)
  expect(claim.merged).toBe(true)
  expect(claim.customerId).toBe(owner.id)
})

it('CONCURRENCY: two shells verifying the same never-verified target in parallel — neither merges into the declared holder; a later verifier merges into the earliest', async () => {
  const declaredHolder = await createCustomer()
  await setDeclaredField(declaredHolder.id, 'email', 'race@example.ro', 'collect_customer_field')

  const a = await createCustomer()
  const b = await createCustomer()
  const ra = await verifyTarget(a.id, 'race@example.ro')
  const rb = await verifyTarget(b.id, 'race@example.ro')

  const settled = await Promise.allSettled([applyVerifiedClaim(ra), applyVerifiedClaim(rb)])

  // no takeover: the declared holder absorbed nobody
  for (const c of [a, b]) {
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
    expect(row.mergedIntoId === declaredHolder.id).toBe(false)
  }
  // at most one live mirror holder for the address (unique wins the race)
  const holders = await prisma.customer.findMany({ where: { email: 'race@example.ro' } })
  expect(holders.length).toBeLessThanOrEqual(1)
  expect(holders.every((h) => h.id !== declaredHolder.id)).toBe(true)
  // at least one claim resolved without a crash
  expect(settled.some((s) => s.status === 'fulfilled')).toBe(true)

  // a third shell verifying now merges into the EARLIEST verifier (deterministic owner)
  const c3 = await createCustomer()
  const r3 = await verifyTarget(c3.id, 'race@example.ro')
  const claim3 = await applyVerifiedClaim(r3)
  expect(claim3.merged).toBe(true)
  const earliest = await prisma.verificationChallenge.findFirst({
    where: { consumedAt: { not: null }, customerId: { in: [a.id, b.id] } },
    orderBy: [{ consumedAt: 'asc' }, { createdAt: 'asc' }],
  })
  expect(claim3.customerId).toBe(earliest!.customerId)
})
