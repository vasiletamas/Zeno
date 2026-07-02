import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { resetFunnelTables, createCustomer } from '@/__tests__/helpers/test-db'
import { signToken } from '@/lib/auth/jwt'
import { createWorkItem } from '@/lib/work-items/service'
import { GET as listWorkItemsRoute } from '@/app/api/admin/work-items/route'
import { POST as resolveRoute } from '@/app/api/admin/work-items/[id]/resolve/route'

function req(url: string, opts: { token?: string; method?: string; body?: unknown } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (opts.token) headers.set('cookie', `zeno_auth=${opts.token}`)
  return new NextRequest(`http://localhost${url}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
}

/** The gateway snapshot-loads the conversation, so refs must be real rows. */
async function seedEscalation(kind: 'ESCALATION' | 'GDPR_ERASURE' = 'ESCALATION') {
  const customer = await createCustomer()
  const conversation = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro' } })
  return createWorkItem({
    kind,
    reason: 'help',
    refs: { conversationId: conversation.id, customerId: customer.id },
    createdBy: 'agent',
  })
}

describe('admin work-items API', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('401s without a token (negative)', async () => {
    const res = await listWorkItemsRoute(req('/api/admin/work-items'))
    expect(res.status).toBe(401)
  })

  it('403s for CUSTOMER role (negative)', async () => {
    const token = await signToken({ userId: 'u1', email: 'c@x.ro', role: 'CUSTOMER' }, '1h')
    const res = await listWorkItemsRoute(req('/api/admin/work-items', { token }))
    expect(res.status).toBe(403)
  })

  it('lists open items for OPERATOR (with status/kind filters) and resolves an escalation through the gateway', async () => {
    const item = await seedEscalation()
    const token = await signToken({ userId: 'op1', email: 'op@x.ro', role: 'OPERATOR' }, '1h')

    const list = await listWorkItemsRoute(req('/api/admin/work-items?status=OPEN', { token }))
    expect(list.status).toBe(200)
    expect((await list.json()).items).toHaveLength(1)

    const filtered = await listWorkItemsRoute(req('/api/admin/work-items?status=OPEN&kind=REFERRAL', { token }))
    expect((await filtered.json()).items).toHaveLength(0)

    const res = await resolveRoute(
      req(`/api/admin/work-items/${item.id}/resolve`, { token, method: 'POST', body: { decision: 'resolve', note: 'handled by phone' } }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(200)
    const updated = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(updated).toMatchObject({ status: 'RESOLVED', resolvedBy: 'op@x.ro', resolution: 'handled by phone' })
    // moved through the gateway: the operator commit is on the ledger
    const ledger = await prisma.commitLedger.findFirst({ where: { tool: 'resolve_work_item', actor: 'operator', outcome: 'applied' } })
    expect(ledger).not.toBeNull()
  })

  it('400s on an invalid decision for the kind (negative)', async () => {
    const item = await seedEscalation()
    const token = await signToken({ userId: 'op1', email: 'op@x.ro', role: 'OPERATOR' }, '1h')
    const res = await resolveRoute(
      req(`/api/admin/work-items/${item.id}/resolve`, { token, method: 'POST', body: { decision: 'approve' } }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_decision_for_kind')
  })

  it('400s GDPR kinds until E3 wires them (negative)', async () => {
    const item = await seedEscalation('GDPR_ERASURE')
    const token = await signToken({ userId: 'op1', email: 'op@x.ro', role: 'OPERATOR' }, '1h')
    const res = await resolveRoute(
      req(`/api/admin/work-items/${item.id}/resolve`, { token, method: 'POST', body: { decision: 'approve' } }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('use_gdpr_resolution')
  })
})
