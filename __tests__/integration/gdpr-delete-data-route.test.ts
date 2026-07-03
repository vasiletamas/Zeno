import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { resetFunnelTables } from '@/__tests__/helpers/test-db'
import { signToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { DELETE as deleteData } from '@/app/api/gdpr/delete-data/route'

function req(body: unknown, token?: string) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('cookie', `${COOKIE_NAME}=${token}`)
  return new NextRequest('http://localhost/api/gdpr/delete-data', { method: 'DELETE', headers, body: JSON.stringify(body) })
}

describe('DELETE /api/gdpr/delete-data (E3.4 — aligned under the retention table)', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('401s without auth (negative)', async () => {
    expect((await deleteData(req({ customerId: 'x', confirmDeletion: true }))).status).toBe(401)
  })

  it('400s without confirmDeletion (negative)', async () => {
    const token = await signToken({ userId: 'u1', email: 'a@x.ro', role: 'ADMIN' }, '1h')
    expect((await deleteData(req({ customerId: 'x' }, token))).status).toBe(400)
  })

  it('CUSTOMER request creates an OPEN GDPR_ERASURE WorkItem — no inline mutation', async () => {
    const customer = await prisma.customer.create({ data: { name: 'Ion', email: 'ion@x.ro' } })
    await prisma.conversation.create({ data: { customerId: customer.id } })
    const user = await prisma.user.create({ data: { email: 'ion@x.ro', role: 'CUSTOMER', customerId: customer.id, passwordHash: '' } })
    const token = await signToken({ userId: user.id, email: user.email, role: 'CUSTOMER' }, '1h')
    const res = await deleteData(req({ customerId: customer.id, confirmDeletion: true }, token))
    expect(res.status).toBe(202)
    expect((await res.json()).workItemId).toBeDefined()
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).name).toBe('Ion')
    expect(await prisma.workItem.count({ where: { kind: 'GDPR_ERASURE', status: 'OPEN' } })).toBe(1)
  })

  it('CUSTOMER cannot request erasure of another customer (negative 403)', async () => {
    const victim = await prisma.customer.create({ data: {} })
    const customer = await prisma.customer.create({ data: {} })
    const user = await prisma.user.create({ data: { email: 'me@x.ro', role: 'CUSTOMER', customerId: customer.id, passwordHash: '' } })
    const token = await signToken({ userId: user.id, email: user.email, role: 'CUSTOMER' }, '1h')
    expect((await deleteData(req({ customerId: victim.id, confirmDeletion: true }, token))).status).toBe(403)
  })

  it('ADMIN request approves immediately through the gateway: customer tombstoned, item RESOLVED', async () => {
    const customer = await prisma.customer.create({ data: { name: 'Ana', email: 'ana@x.ro' } })
    await prisma.conversation.create({ data: { customerId: customer.id } })
    const token = await signToken({ userId: 'admin1', email: 'admin@x.ro', role: 'ADMIN' }, '1h')
    const res = await deleteData(req({ customerId: customer.id, confirmDeletion: true }, token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.classResults).toBeDefined()
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).erasedAt).not.toBeNull()
    expect(await prisma.workItem.count({ where: { kind: 'GDPR_ERASURE', status: 'RESOLVED' } })).toBe(1)
    expect(await prisma.commitLedger.count({ where: { tool: 'approve_erasure' } })).toBe(1)
  })
})
