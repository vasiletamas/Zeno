/**
 * GET /api/documents/[documentId] (D2.2, T9.D1)
 *
 * Serves a registered Document's bytes from the storage provider.
 * Auth: CUSTOMER (own document, or a product-level static disclosure),
 * ADMIN or OPERATOR (any document). Content-type application/pdf.
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
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

    const bytes = await fsStorage.get(doc.storageKey)
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${doc.kind.toLowerCase()}-${doc.language}-v${doc.version}.pdf"`,
      },
    })
  } catch (error) {
    console.error('[Documents] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
