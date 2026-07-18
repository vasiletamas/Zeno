/**
 * GET /api/documents/[documentId] (D2.2, T9.D1; T21)
 *
 * Serves a registered Document's bytes from the storage provider.
 * Auth: zeno_auth JWT — CUSTOMER (own document, or a product-level static
 * disclosure), ADMIN or OPERATOR (any document) — OR the zeno_session chat
 * cookie (T21): the session's customer reads documents it OWNS plus static
 * per-product disclosures. Chat customers hold only zeno_session, and the
 * disclosure links Zeno hands out must be readable by exactly that customer.
 * Content-type application/pdf.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { fsStorage } from '@/lib/documents/storage'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    const payload = token ? await verifyToken(token) : null
    if (!payload) {
      // T21: no (valid) JWT — fall back to the chat session cookie principal
      return sessionCookieGet(request, params)
    }

    const { documentId } = await params
    const doc = await prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    if (payload.role === 'CUSTOMER') {
      // product-level static disclosures (IPID/TERMS) are public to any
      // authenticated customer; customer-keyed documents must be OWNED
      if (doc.customerId) {
        const customer = await prisma.customer.findUnique({
          where: { id: doc.customerId },
          include: { user: { select: { id: true } } },
        })
        if (customer?.user?.id !== payload.userId) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      } else if (doc.source !== 'STATIC_PER_PRODUCT_VERSION') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else if (payload.role !== 'ADMIN' && payload.role !== 'OPERATOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return servePdf(doc)
  } catch (error) {
    console.error('[Documents] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * T21: zeno_session principal — the chat customer reads its OWN documents
 * and static per-product disclosures; anything else is 403. Anonymous or
 * unknown cookies are 401.
 */
async function sessionCookieGet(
  request: NextRequest,
  params: Promise<{ documentId: string }>,
) {
  const sessionId = request.cookies.get('zeno_session')?.value
  if (!sessionId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const customer = await prisma.customer.findUnique({ where: { id: sessionId } })
  if (!customer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { documentId } = await params
  const doc = await prisma.document.findUnique({ where: { id: documentId } })
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // same shape as the JWT CUSTOMER branch: customer-keyed documents must be
  // OWNED; unkeyed ones must be static per-product disclosures
  if (doc.customerId) {
    if (doc.customerId !== customer.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else if (doc.source !== 'STATIC_PER_PRODUCT_VERSION') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return servePdf(doc)
}

async function servePdf(doc: { storageKey: string; kind: string; language: string; version: number }) {
  const bytes = await fsStorage.get(doc.storageKey)
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${doc.kind.toLowerCase()}-${doc.language}-v${doc.version}.pdf"`,
    },
  })
}
