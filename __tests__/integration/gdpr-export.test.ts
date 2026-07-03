import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables } from '@/__tests__/helpers/test-db'
import { setDeclaredField } from '@/lib/customer/profile-service'
import { executeCommit } from '@/lib/tools/gateway'
import { compileCustomerExport } from '@/lib/gdpr/export'
import { signToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { GET as downloadExport } from '@/app/api/gdpr/export/[workItemId]/route'
import type { ToolContext } from '@/lib/tools/types'

function ctxFor(customerId: string, conversationId: string) {
  return { customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext
}

/** Full KYC declared + a CONSUMED email challenge → derived tier verified_channel (B3.4). */
async function seedVerifiedChannelCustomer() {
  const customer = await prisma.customer.create({ data: {} })
  await setDeclaredField(customer.id, 'name', 'Ion Verificat', 'fixture')
  await setDeclaredField(customer.id, 'dateOfBirth', '1990-01-01', 'fixture')
  await setDeclaredField(customer.id, 'cnp', '1900101080012', 'fixture')
  const email = `fx-${customer.id}@example.com`
  await setDeclaredField(customer.id, 'email', email, 'fixture')
  await setDeclaredField(customer.id, 'phone', '+40712345678', 'fixture')
  await prisma.verificationChallenge.create({
    data: { customerId: customer.id, channel: 'email', target: email, codeHash: 'fixture', expiresAt: new Date(Date.now() + 600_000), consumedAt: new Date() },
  })
  return customer
}

describe('GDPR data-access export (E3.5, M3)', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('compiles a versioned bundle of everything held on the customer', async () => {
    const customer = await prisma.customer.create({ data: { name: 'Ion', email: 'ion@x.ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    await prisma.message.create({ data: { conversationId: conv.id, role: 'user', content: 'salut' } })
    const bundle = await compileCustomerExport(customer.id)
    expect(bundle.schemaVersion).toBe(1)
    expect(bundle.profile.email).toBe('ion@x.ro')
    expect(bundle.conversations).toHaveLength(1)
    expect(bundle.conversations[0].messages).toHaveLength(1)
    expect(bundle).toHaveProperty('consentEvents')
    expect(bundle).toHaveProperty('commitLedger')
    expect(bundle).toHaveProperty('payments')
    expect(bundle).toHaveProperty('policies')
  })

  it('request_data_export requires verified_channel — requires_identity with needs otherwise', async () => {
    const customer = await prisma.customer.create({ data: {} }) // anonymous tier
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    const r = await executeCommit({ tool: 'request_data_export', actor: 'agent', conversationId: conv.id, customerId: customer.id, args: {}, toolContext: ctxFor(customer.id, conv.id) })
    expect(r.outcome).toBe('requires_identity')
    expect(r.needs).toContain('verified_channel')
    expect(await prisma.workItem.count({ where: { kind: 'GDPR_EXPORT' } })).toBe(0)
  })

  it('verified customer: request creates the WorkItem; operator approval stores the bundle on it', async () => {
    const customer = await seedVerifiedChannelCustomer()
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    const r = await executeCommit({ tool: 'request_data_export', actor: 'agent', conversationId: conv.id, customerId: customer.id, args: {}, toolContext: ctxFor(customer.id, conv.id) })
    expect(r.outcome).toBe('applied')
    const item = await prisma.workItem.findFirstOrThrow({ where: { kind: 'GDPR_EXPORT' } })
    const approved = await executeCommit({ tool: 'approve_export', actor: 'operator', conversationId: conv.id, customerId: customer.id, args: { workItemId: item.id }, toolContext: ctxFor(customer.id, conv.id) })
    expect(approved.outcome).toBe('applied')
    const resolved = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(resolved.status).toBe('RESOLVED')
    expect((resolved.payload as { schemaVersion?: number }).schemaVersion).toBe(1)
  })

  it('download route: the owning customer gets the bundle; a foreign customer gets 403', async () => {
    const customer = await seedVerifiedChannelCustomer()
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    await executeCommit({ tool: 'request_data_export', actor: 'agent', conversationId: conv.id, customerId: customer.id, args: {}, toolContext: ctxFor(customer.id, conv.id) })
    const item = await prisma.workItem.findFirstOrThrow({ where: { kind: 'GDPR_EXPORT' } })
    await executeCommit({ tool: 'approve_export', actor: 'operator', conversationId: conv.id, customerId: customer.id, args: { workItemId: item.id }, toolContext: ctxFor(customer.id, conv.id) })

    const { NextRequest } = await import('next/server')
    const owner = await prisma.user.create({ data: { email: 'own@x.ro', role: 'CUSTOMER', customerId: customer.id, passwordHash: '' } })
    const ownerToken = await signToken({ userId: owner.id, email: owner.email, role: 'CUSTOMER' }, '1h')
    const ownerReq = new NextRequest(`http://localhost/api/gdpr/export/${item.id}`, { headers: { cookie: `${COOKIE_NAME}=${ownerToken}` } })
    const ok = await downloadExport(ownerReq, { params: Promise.resolve({ workItemId: item.id }) })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-disposition')).toContain('attachment')
    expect((await ok.json()).schemaVersion).toBe(1)

    const stranger = await prisma.customer.create({ data: {} })
    const strangerUser = await prisma.user.create({ data: { email: 'other@x.ro', role: 'CUSTOMER', customerId: stranger.id, passwordHash: '' } })
    const strangerToken = await signToken({ userId: strangerUser.id, email: strangerUser.email, role: 'CUSTOMER' }, '1h')
    const strangerReq = new NextRequest(`http://localhost/api/gdpr/export/${item.id}`, { headers: { cookie: `${COOKIE_NAME}=${strangerToken}` } })
    expect((await downloadExport(strangerReq, { params: Promise.resolve({ workItemId: item.id }) })).status).toBe(403)
  })
})
