/**
 * T21 (P5.4): disclosure documents must be readable by the chat session
 * that owns them. Chat customers hold zeno_session (raw customer id) — the
 * document route used to demand the zeno_auth JWT, so every disclosure link
 * 401'd for exactly the customer required to read it. The route now accepts
 * the session cookie as an ALTERNATIVE principal: owned documents and
 * product-level static disclosures are served; foreign documents stay 403.
 * All zeno_auth paths are unchanged.
 */
import { it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { signToken } from '@/lib/auth/jwt'
import { resetFunnelTables, createCustomer } from '../helpers/test-db'
import { createDocument } from '@/lib/documents/registry'
import { GET as documentGet } from '@/app/api/documents/[documentId]/route'

beforeEach(async () => { await resetFunnelTables() })

const req = (cookie?: string) =>
  new NextRequest('http://localhost/api/documents/x', {
    headers: new Headers(cookie ? { cookie } : {}),
  })

const call = (documentId: string, cookie?: string) =>
  documentGet(req(cookie), { params: Promise.resolve({ documentId }) })

it('the owning chat session (zeno_session cookie) reads its own document — 200 application/pdf', async () => {
  const customer = await createCustomer()
  const doc = await createDocument({
    kind: 'SUITABILITY_REPORT', language: 'ro', customerId: customer.id,
    bytes: Buffer.from('report-bytes'), source: 'GENERATED',
  })
  const res = await call(doc.id, `zeno_session=${customer.id}`)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('application/pdf')
  expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('report-bytes')
})

it('a foreign session cookie gets 403 on someone else\'s document', async () => {
  const owner = await createCustomer()
  const stranger = await createCustomer()
  const doc = await createDocument({
    kind: 'PAYMENT_RECEIPT', language: 'ro', customerId: owner.id,
    bytes: Buffer.from('receipt'), source: 'GENERATED',
  })
  const res = await call(doc.id, `zeno_session=${stranger.id}`)
  expect(res.status).toBe(403)
})

it('static product disclosures (IPID/TERMS) are served on the session cookie alone', async () => {
  const customer = await createCustomer()
  const doc = await createDocument({
    kind: 'IPID', language: 'ro', bytes: Buffer.from('ipid'),
    source: 'STATIC_PER_PRODUCT_VERSION',
  })
  const res = await call(doc.id, `zeno_session=${customer.id}`)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('application/pdf')
})

it('no principal at all → 401; an unknown session id → 401', async () => {
  const customer = await createCustomer()
  const doc = await createDocument({
    kind: 'SUITABILITY_REPORT', language: 'ro', customerId: customer.id,
    bytes: Buffer.from('r'), source: 'GENERATED',
  })
  expect((await call(doc.id)).status).toBe(401)
  expect((await call(doc.id, 'zeno_session=nope')).status).toBe(401)
})

it('the zeno_auth JWT path is untouched: linked account-holder still reads via JWT', async () => {
  const customer = await createCustomer({ email: 'jwt@example.ro' })
  const user = await prisma.user.create({
    data: { email: 'jwt@example.ro', role: 'CUSTOMER', customerId: customer.id },
  })
  const doc = await createDocument({
    kind: 'SUITABILITY_REPORT', language: 'ro', customerId: customer.id,
    bytes: Buffer.from('jwt-read'), source: 'GENERATED',
  })
  const token = await signToken({ userId: user.id, role: 'CUSTOMER', email: user.email }, '1h')
  const res = await call(doc.id, `zeno_auth=${token}`)
  expect(res.status).toBe(200)
  expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('jwt-read')
})
