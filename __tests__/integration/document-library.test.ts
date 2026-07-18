/**
 * T25 (P5.5): customer document library — every signed, acknowledged,
 * generated and uploaded artifact is listable and viewable.
 *
 * (a) CustomerDocument uploads get a read route serving the DECRYPTED bytes
 *     under either principal (zeno_auth owner / zeno_session owner);
 * (b) lib/documents/library.listCustomerDocuments returns BOTH families in
 *     a typed grouped structure (per product via productId or quote link;
 *     ungrouped bucket otherwise) with acknowledgedAt on acked disclosures.
 */
import { it, expect, describe, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { signToken } from '@/lib/auth/jwt'
import { encrypt } from '@/lib/security/encryption'
import { resetDb, createCustomer } from '../helpers/test-db'
import { createDocument } from '@/lib/documents/registry'
import { listCustomerDocuments } from '@/lib/documents/library'
import { GET as uploadGet } from '@/app/api/documents/uploads/[id]/route'

beforeEach(async () => { await resetDb() })

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-body'),
])

async function createUpload(customerId: string, bytes: Buffer = PNG_BYTES) {
  const enc = encrypt(bytes.toString('base64'))
  return prisma.customerDocument.create({
    data: {
      customerId,
      kind: 'id_card',
      encryptedData: Buffer.from(enc.encrypted, 'hex'),
      dataIv: enc.iv,
      dataTag: enc.tag,
    },
  })
}

const call = (id: string, cookie?: string) =>
  uploadGet(
    new NextRequest(`http://localhost/api/documents/uploads/${id}`, {
      headers: new Headers(cookie ? { cookie } : {}),
    }),
    { params: Promise.resolve({ id }) },
  )

describe('GET /api/documents/uploads/[id]', () => {
  it('owner session cookie → 200 with the DECRYPTED bytes and sniffed content-type', async () => {
    const customer = await createCustomer()
    const doc = await createUpload(customer.id)
    const res = await call(doc.id, `zeno_session=${customer.id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG_BYTES)).toBe(true)
  })

  it('owner via zeno_auth (user link) → 200; unknown type → octet-stream attachment', async () => {
    const customer = await createCustomer({ email: 'up@example.ro' })
    const user = await prisma.user.create({ data: { email: 'up@example.ro', role: 'CUSTOMER', customerId: customer.id } })
    const raw = Buffer.from('no-magic-bytes-here')
    const doc = await createUpload(customer.id, raw)
    const token = await signToken({ userId: user.id, role: 'CUSTOMER', email: user.email }, '1h')
    const res = await call(doc.id, `zeno_auth=${token}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(Buffer.from(await res.arrayBuffer()).equals(raw)).toBe(true)
  })

  it('foreign cookie → 403; no principal → 401; unknown id → 404', async () => {
    const owner = await createCustomer()
    const stranger = await createCustomer()
    const doc = await createUpload(owner.id)
    expect((await call(doc.id, `zeno_session=${stranger.id}`)).status).toBe(403)
    expect((await call(doc.id)).status).toBe(401)
    expect((await call('nope', `zeno_session=${owner.id}`)).status).toBe(404)
  })
})

describe('listCustomerDocuments', () => {
  it('groups both families: quote-linked + acked static under the product, uploads ungrouped', async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
    const customer = await createCustomer()
    const application = await prisma.application.create({
      data: { customerId: customer.id, productId: product.id, status: 'OPEN' },
    })
    const quote = await prisma.quote.create({
      data: {
        applicationId: application.id, productId: product.id, customerId: customer.id,
        premiumAnnual: 190, premiumMonthly: 15.83, coverages: {}, status: 'ISSUED',
        validUntil: new Date(Date.now() + 30 * 86400e3),
      },
    })

    // generated, quote-linked → grouped under protect
    const report = await createDocument({
      kind: 'SUITABILITY_REPORT', language: 'ro', customerId: customer.id,
      quoteId: quote.id, bytes: Buffer.from('report'), source: 'GENERATED',
    })
    // static product disclosure, ACKNOWLEDGED → grouped under protect with acknowledgedAt
    const ipid = await createDocument({
      kind: 'IPID', language: 'ro', productId: product.id,
      bytes: Buffer.from('ipid'), source: 'STATIC_PER_PRODUCT_VERSION',
    })
    const ack = await prisma.disclosureAck.create({
      data: {
        quoteId: quote.id, customerId: customer.id, documentId: ipid.id,
        kind: 'IPID', version: 1, language: 'ro', actor: 'gui',
      },
    })
    // upload → ungrouped
    const upload = await createUpload(customer.id)
    // someone else's document must NOT leak in
    const other = await createCustomer()
    await createDocument({
      kind: 'PAYMENT_RECEIPT', language: 'ro', customerId: other.id,
      bytes: Buffer.from('foreign'), source: 'GENERATED',
    })

    const lib = await listCustomerDocuments(customer.id)

    expect(lib.groups).toHaveLength(1)
    const group = lib.groups[0]
    expect(group.productId).toBe(product.id)
    expect(group.productName).toMatchObject({ ro: expect.any(String) })
    const kinds = group.items.map((i) => i.kind).sort()
    expect(kinds).toEqual(['IPID', 'SUITABILITY_REPORT'])

    const reportItem = group.items.find((i) => i.id === report.id)
    expect(reportItem).toMatchObject({ family: 'registry', url: `/api/documents/${report.id}` })
    const ipidItem = group.items.find((i) => i.id === ipid.id)
    expect(ipidItem?.acknowledgedAt?.getTime()).toBe(ack.acknowledgedAt.getTime())

    expect(lib.ungrouped).toHaveLength(1)
    expect(lib.ungrouped[0]).toMatchObject({
      id: upload.id, family: 'upload', kind: 'id_card',
      url: `/api/documents/uploads/${upload.id}`,
    })
  })

  it('a customer-keyed document with no product link lands in the ungrouped bucket', async () => {
    const customer = await createCustomer()
    const receipt = await createDocument({
      kind: 'PAYMENT_RECEIPT', language: 'ro', customerId: customer.id,
      bytes: Buffer.from('receipt'), source: 'GENERATED',
    })
    const lib = await listCustomerDocuments(customer.id)
    expect(lib.groups).toHaveLength(0)
    expect(lib.ungrouped.map((i) => i.id)).toEqual([receipt.id])
  })
})
