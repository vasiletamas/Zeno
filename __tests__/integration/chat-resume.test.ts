/**
 * T21 (P5.4): /chat resumes the open conversation instead of minting a new
 * one. /api/session's resume responses (plain and merged) carry
 * activeConversationId — the customer's latest ACTIVE conversation by
 * lastActivityAt — and the entry page navigates there unless ?new=1 opts
 * out. Fresh mints and reauth_required carry no conversation id.
 */
import { it, expect, describe, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { resetFunnelTables, createCustomer } from '../helpers/test-db'
import { POST as sessionPost } from '@/app/api/session/route'
import { resolveEntryTarget } from '@/lib/chat/entry-target'

beforeEach(async () => { await resetFunnelTables() })

const req = (opts: { cookie?: string; body?: unknown } = {}) =>
  new NextRequest('http://localhost/api/session', {
    method: 'POST',
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    headers: new Headers({ 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) }),
  })

it('plain resume carries the latest ACTIVE conversation by lastActivityAt', async () => {
  const c = await createCustomer({ isAnonymous: true })
  await prisma.conversation.create({
    data: { customerId: c.id, lastActivityAt: new Date('2026-01-01') },
  })
  const newer = await prisma.conversation.create({
    data: { customerId: c.id, lastActivityAt: new Date('2026-06-01') },
  })
  // an even newer but ARCHIVED conversation must NOT win
  await prisma.conversation.create({
    data: { customerId: c.id, status: 'ARCHIVED', lastActivityAt: new Date('2026-07-01') },
  })
  const res = await sessionPost(req({ cookie: `zeno_session=${c.id}` }))
  const body = await res.json()
  expect(body).toEqual({ customerId: c.id, isNew: false, activeConversationId: newer.id })
})

it('plain resume with no ACTIVE conversation carries activeConversationId null', async () => {
  const c = await createCustomer({ isAnonymous: true })
  const body = await (await sessionPost(req({ cookie: `zeno_session=${c.id}` }))).json()
  expect(body).toEqual({ customerId: c.id, isNew: false, activeConversationId: null })
})

it('merged-shell resume follows the pointer and carries the CANONICAL customer\'s conversation', async () => {
  const canonical = await createCustomer({ isAnonymous: true })
  const conv = await prisma.conversation.create({ data: { customerId: canonical.id } })
  const shell = await createCustomer({ isAnonymous: true, mergedIntoId: canonical.id })
  const body = await (await sessionPost(req({ cookie: `zeno_session=${shell.id}` }))).json()
  expect(body).toEqual({ customerId: canonical.id, isNew: false, activeConversationId: conv.id })
})

it('a fresh mint carries NO activeConversationId; reauth_required carries none either', async () => {
  const fresh = await (await sessionPost(req())).json()
  expect(fresh.isNew).toBe(true)
  expect('activeConversationId' in fresh).toBe(false)

  // account-holder → reauth_required, still no conversation id leaked
  const email = 'resume-holder@example.ro'
  const c = await createCustomer({ isAnonymous: false, email })
  await prisma.user.create({ data: { email, role: 'CUSTOMER', customerId: c.id } })
  await prisma.verificationChallenge.create({
    data: {
      customerId: c.id, channel: 'email', target: email,
      codeHash: 'h', linkToken: randomUUID(), expiresAt: new Date(Date.now() + 600_000),
      attemptsRemaining: 5, consumedAt: new Date(),
    },
  })
  await prisma.conversation.create({ data: { customerId: c.id } })
  const gated = await (await sessionPost(req({ cookie: `zeno_session=${c.id}` }))).json()
  expect(gated.status).toBe('reauth_required')
  expect('activeConversationId' in gated).toBe(false)
})

describe('resolveEntryTarget (pure entry logic)', () => {
  it('resumes when the session carries an active conversation', () => {
    expect(resolveEntryTarget({ customerId: 'c1', activeConversationId: 'conv1' }, false))
      .toEqual({ kind: 'resume', conversationId: 'conv1' })
  })

  it('forceNew (?new=1) always creates', () => {
    expect(resolveEntryTarget({ customerId: 'c1', activeConversationId: 'conv1' }, true))
      .toEqual({ kind: 'create' })
  })

  it('no active conversation (null or absent) creates', () => {
    expect(resolveEntryTarget({ customerId: 'c1', activeConversationId: null }, false))
      .toEqual({ kind: 'create' })
    expect(resolveEntryTarget({ customerId: 'c1' }, false)).toEqual({ kind: 'create' })
  })
})
