import { it, expect, beforeEach, vi, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, createCustomer } from '@/__tests__/helpers/test-db'
import { issueChallenge } from '@/lib/customer/verification-service'
import { GET } from '@/app/api/dev/last-verification-email/route'
import { NextRequest } from 'next/server'

// Task 4.1 (D6): the dev seam — a human on the laptop (or an HTTP harness)
// reads the last verification code without grepping server logs.

beforeEach(async () => { await resetFunnelTables() })
afterEach(() => { vi.unstubAllEnvs() })

const req = (qs: string) => new NextRequest(`http://localhost:3001/api/dev/last-verification-email${qs}`)

it('returns the last code + link for a customer in dev', async () => {
  const c = await createCustomer()
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const issued = await issueChallenge(c.id, 'email', 'maria@example.ro', conv.id)
  const res = await GET(req(`?customerId=${c.id}`))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.code).toBe(issued.code)
  expect(body.link).toContain(`/api/auth/verify?token=${issued.linkToken}`)
  expect(body.target).toBe('maria@example.ro')
})

it('404 in production mode (negative)', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  const res = await GET(req('?customerId=whatever'))
  expect(res.status).toBe(404)
})

it('400 without customerId; 404 when the customer has no recorded send', async () => {
  expect((await GET(req(''))).status).toBe(400)
  const c = await createCustomer()
  expect((await GET(req(`?customerId=${c.id}`))).status).toBe(404)
})
