/**
 * T26 (P5.2): /api/session never silently hands an authenticated account's
 * session to whoever holds the cookie. A cookie pointing at a customer with
 * a linked User AND ≥1 consumed email challenge gets
 * {status:'reauth_required', maskedEmail} — no customerId, no cookie
 * extension. The holder either proves the email again via
 * /api/session/reauth/{start,confirm} (OTP) or starts an explicit fresh
 * anonymous session ({fresh:true}).
 */
import { it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { lastMockEmailTo } from '@/lib/email/providers/mock'
import { resetFunnelTables, createCustomer } from '../helpers/test-db'
import { POST as sessionPost } from '@/app/api/session/route'
import { POST as reauthStart } from '@/app/api/session/reauth/start/route'
import { POST as reauthConfirm } from '@/app/api/session/reauth/confirm/route'

beforeEach(async () => { await resetFunnelTables() })

const req = (url: string, opts: { cookie?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    headers: new Headers({ 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) }),
  })

/** An account-holder: linked User + consumed email challenge (B3.4 evidence). */
async function makeAccountHolder(email = 'holder@example.ro') {
  const c = await createCustomer({ isAnonymous: false, email })
  await prisma.user.create({ data: { email, role: 'CUSTOMER', customerId: c.id } })
  await prisma.verificationChallenge.create({
    data: {
      customerId: c.id, channel: 'email', target: email,
      codeHash: 'h', linkToken: randomUUID(), expiresAt: new Date(Date.now() + 600_000),
      attemptsRemaining: 5, consumedAt: new Date(),
    },
  })
  return c
}

it('an account-holder cookie gets reauth_required with the masked email — never a silent resume', async () => {
  const c = await makeAccountHolder()
  const res = await sessionPost(req('/api/session', { cookie: `zeno_session=${c.id}` }))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body).toEqual({ status: 'reauth_required', maskedEmail: 'h***@example.ro' })
  // the customerId is withheld and the cookie is NOT re-set
  expect(res.headers.get('set-cookie')).toBeNull()
})

it('an anonymous cookie (no linked User) still resumes silently', async () => {
  const c = await createCustomer({ isAnonymous: true })
  const res = await sessionPost(req('/api/session', { cookie: `zeno_session=${c.id}` }))
  // T21: resumes also carry activeConversationId (null when no ACTIVE conversation)
  expect(await res.json()).toEqual({ customerId: c.id, isNew: false, activeConversationId: null })
})

it('a merged-shell cookie follows the pointer, then the CANONICAL account demands reauth', async () => {
  const owner = await makeAccountHolder('owner@example.ro')
  const shell = await createCustomer({ isAnonymous: true, mergedIntoId: owner.id })
  const res = await sessionPost(req('/api/session', { cookie: `zeno_session=${shell.id}` }))
  const body = await res.json()
  expect(body.status).toBe('reauth_required')
  expect(body.customerId).toBeUndefined()
})

it('{fresh:true} always mints a NEW anonymous customer, even on an account-holder cookie', async () => {
  const c = await makeAccountHolder()
  const res = await sessionPost(req('/api/session', { cookie: `zeno_session=${c.id}`, body: { fresh: true } }))
  const body = await res.json()
  expect(body.isNew).toBe(true)
  expect(body.customerId).not.toBe(c.id)
  const minted = await prisma.customer.findUniqueOrThrow({ where: { id: body.customerId } })
  expect(minted.isAnonymous).toBe(true)
  expect(res.headers.get('set-cookie')).toContain(`zeno_session=${body.customerId}`)
})

it('reauth start issues a challenge to the ACCOUNT email; anti-enumeration: 200 with or without an account', async () => {
  const c = await makeAccountHolder()
  const res = await reauthStart(req('/api/session/reauth/start', { cookie: `zeno_session=${c.id}`, body: {} }))
  expect(res.status).toBe(200)
  const challenge = await prisma.verificationChallenge.findFirst({ where: { customerId: c.id, consumedAt: null } })
  expect(challenge).toMatchObject({ channel: 'email', target: 'holder@example.ro' })

  // no account behind the cookie → SAME 200, no challenge issued
  const anon = await createCustomer({ isAnonymous: true })
  const res2 = await reauthStart(req('/api/session/reauth/start', { cookie: `zeno_session=${anon.id}`, body: {} }))
  expect(res2.status).toBe(200)
  expect(await prisma.verificationChallenge.count({ where: { customerId: anon.id } })).toBe(0)
})

it('reauth confirm: wrong code → 401 with attemptsRemaining; right code → {customerId} + cookie re-set', async () => {
  const c = await makeAccountHolder()
  await reauthStart(req('/api/session/reauth/start', { cookie: `zeno_session=${c.id}`, body: {} }))
  const code = lastMockEmailTo('holder@example.ro')?.code
  if (!code) throw new Error('no reauth code in the mock mailbox')

  const wrong = code === '000000' ? '000001' : '000000'
  const bad = await reauthConfirm(req('/api/session/reauth/confirm', { cookie: `zeno_session=${c.id}`, body: { code: wrong } }))
  expect(bad.status).toBe(401)
  expect((await bad.json()).attemptsRemaining).toBe(4)

  const good = await reauthConfirm(req('/api/session/reauth/confirm', { cookie: `zeno_session=${c.id}`, body: { code } }))
  expect(good.status).toBe(200)
  expect(await good.json()).toEqual({ customerId: c.id })
  expect(good.headers.get('set-cookie')).toContain(`zeno_session=${c.id}`)
})
