/**
 * GET /api/documents/uploads/[id] (T25, P5.5)
 *
 * Serves a CustomerDocument upload's DECRYPTED image bytes — the upload
 * intake (B3.7) stores AES-GCM(base64(bytes)); this is its missing read
 * counterpart. Auth: the OWNER only, via either principal — zeno_auth JWT
 * (owner through the user→customer link) or the zeno_session chat cookie.
 * No mimetype is stored (and none is added): the content-type is sniffed
 * from magic bytes, defaulting to application/octet-stream served as an
 * attachment.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/security/encryption'

function sniffContentType(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf'
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

/** Resolve the requesting principal to a customerId, or null. */
async function resolveCustomerId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (token) {
    const payload = await verifyToken(token)
    if (payload?.role === 'CUSTOMER') {
      const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { customerId: true } })
      if (user?.customerId) return user.customerId
    }
  }
  const sessionId = request.cookies.get('zeno_session')?.value
  if (sessionId) {
    const customer = await prisma.customer.findUnique({ where: { id: sessionId }, select: { id: true } })
    if (customer) return customer.id
  }
  return null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const customerId = await resolveCustomerId(request)
    if (!customerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const doc = await prisma.customerDocument.findUnique({ where: { id } })
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    if (doc.customerId !== customerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // intake stored AES-GCM(base64(raw)); encryptedData holds the hex
    // ciphertext as bytes (see /api/documents/upload)
    const base64 = decrypt(Buffer.from(doc.encryptedData).toString('hex'), doc.dataIv, doc.dataTag)
    const bytes = Buffer.from(base64, 'base64')

    const sniffed = sniffContentType(bytes)
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': sniffed ?? 'application/octet-stream',
        'Content-Disposition': sniffed
          ? `inline; filename="${doc.kind}-${doc.id}"`
          : `attachment; filename="${doc.kind}-${doc.id}"`,
      },
    })
  } catch (error) {
    console.error('[DocumentUploads] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
