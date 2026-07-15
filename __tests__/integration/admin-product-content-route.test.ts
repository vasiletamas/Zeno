import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { GET, POST } from '@/app/api/admin/product-content/route'

async function adminRequest(method: 'GET' | 'POST', body?: Record<string, unknown>, role = 'OPERATOR') {
  const { NextRequest } = await import('next/server')
  const { signToken, COOKIE_NAME } = await import('@/lib/auth/jwt')
  const token = await signToken({ userId: 'op-fixture', role, email: 'operator@zeno.ro' }, '1h')
  return new NextRequest('http://localhost/api/admin/product-content', {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: { cookie: `${COOKIE_NAME}=${token}`, 'content-type': 'application/json' },
  })
}

describe('admin ProductContent governance surface (E1 erratum 7, T11.D2)', () => {
  let productId: string
  beforeAll(async () => {
    await resetDb()
    productId = (await prisma.product.findUniqueOrThrow({ where: { code: 'protect' } })).id
  })

  it('GET lists the versioned rows with status', async () => {
    const res = await GET(await adminRequest('GET'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.rows.length).toBeGreaterThanOrEqual(8)
    expect(data.rows[0]).toMatchObject({ field: expect.any(String), locale: expect.any(String), status: expect.any(String), version: expect.any(Number) })
  })

  it('POST publishes a new draft version through the ONE workflow, retiring v1', async () => {
    await prisma.productContent.createMany({ data: [
      { productId, field: 'PRICING_NOTE', locale: 'ro', content: 'nota noua, fara cifre', version: 2, authoredBy: 'op-1' },
      { productId, field: 'PRICING_NOTE', locale: 'en', content: 'new note, digit-free', version: 2, authoredBy: 'op-1' },
    ] })
    const res = await POST(await adminRequest('POST', { productId, addonId: null, field: 'PRICING_NOTE', version: 2 }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.outcome).toBe('applied')
    const published = await prisma.productContent.findMany({ where: { productId, field: 'PRICING_NOTE', status: 'PUBLISHED' } })
    expect(published.every((r) => r.version === 2 && r.approvedBy === 'op-fixture')).toBe(true)
  })

  it('POST surfaces the publish gate rejection (numerals) as 409 + reason', async () => {
    await prisma.productContent.createMany({ data: [
      { productId, field: 'PRICING_NOTE', locale: 'ro', content: 'costa 190 lei', version: 3, authoredBy: 'op-1' },
      { productId, field: 'PRICING_NOTE', locale: 'en', content: 'digit-free', version: 3, authoredBy: 'op-1' },
    ] })
    const res = await POST(await adminRequest('POST', { productId, addonId: null, field: 'PRICING_NOTE', version: 3 }))
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('numerals_in_authored_content')
  })

  it('rejects non-operator callers', async () => {
    const res = await POST(await adminRequest('POST', { productId, addonId: null, field: 'PRICING_NOTE', version: 2 }, 'CUSTOMER'))
    expect(res.status).toBe(403)
  })
})
