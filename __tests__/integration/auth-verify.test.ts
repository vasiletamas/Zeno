import { it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { resetFunnelTables, createCustomer } from '@/__tests__/helpers/test-db'
import { issueChallenge } from '@/lib/customer/verification-service'
import { GET as verifyGet } from '@/app/api/auth/verify/route'
import { POST as magicLinkPost } from '@/app/api/auth/magic-link/route'

beforeEach(async () => { await resetFunnelTables() })

it('link verification binds the chat session and returns to the conversation, not the dashboard (erratum 2: /chat/[id])', async () => {
  const c = await createCustomer({ email: 'ana@example.ro' })
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const { linkToken } = await issueChallenge(c.id, 'email', 'ana@example.ro', conv.id)
  const res = await verifyGet(new NextRequest(`http://localhost/api/auth/verify?token=${linkToken}`))
  expect(res.status).toBeGreaterThanOrEqual(302)
  expect(res.headers.get('location')).toContain(`/chat/${conv.id}`)
  const setCookie = res.headers.get('set-cookie') ?? ''
  expect(setCookie).toContain('zeno_session=')
  // same primitive, same consumption: the channel is now verified
  const email = await prisma.customerProfileField.findUniqueOrThrow({ where: { customerId_field: { customerId: c.id, field: 'email' } } })
  expect(email.provenance).toBe('verified')
})

it('a dashboard-initiated challenge (no conversation) redirects to the dashboard', async () => {
  const c = await createCustomer({ email: 'solo@example.ro' })
  const { linkToken } = await issueChallenge(c.id, 'email', 'solo@example.ro', null)
  const res = await verifyGet(new NextRequest(`http://localhost/api/auth/verify?token=${linkToken}`))
  expect(res.headers.get('location')).toContain('/dashboard')
})

it('expired/consumed token redirects with an error, never throws', async () => {
  const res = await verifyGet(new NextRequest('http://localhost/api/auth/verify?token=nope'))
  expect(res.headers.get('location')).toContain('error=invalid-token')
})

it('magic-link route issues through the challenge primitive and never reveals whether the email exists', async () => {
  const c = await createCustomer({ email: 'known@example.ro' })
  const known = await magicLinkPost(new NextRequest('http://localhost/api/auth/magic-link', {
    method: 'POST', headers: new Headers({ 'content-type': 'application/json' }), body: JSON.stringify({ email: 'known@example.ro' }),
  }))
  expect(await known.json()).toEqual({ sent: true })
  expect(await prisma.verificationChallenge.count({ where: { customerId: c.id } })).toBe(1)
  const unknown = await magicLinkPost(new NextRequest('http://localhost/api/auth/magic-link', {
    method: 'POST', headers: new Headers({ 'content-type': 'application/json' }), body: JSON.stringify({ email: 'ghost@example.ro' }),
  }))
  expect(await unknown.json()).toEqual({ sent: true })
})
