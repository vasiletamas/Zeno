/**
 * POST /api/documents/upload
 *
 * Multipart document intake (B3.7, Stripe-card pattern): the customer's
 * browser posts the image straight here — the agent and the chat transcript
 * never see it (T14.D5). The image is AES-GCM encrypted at rest and the
 * deterministic pipeline runs immediately; the response carries only the
 * validation outcome.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { encrypt } from '@/lib/security/encryption'
import { processDocument } from '@/lib/identity/document-pipeline'

const MAX_BYTES = 10 * 1024 * 1024

export async function POST(request: NextRequest) {
  try {
    const customerId = request.cookies.get('zeno_session')?.value
    if (!customerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const customer = await prisma.customer.findUnique({ where: { id: customerId } })
    if (!customer) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const form = await request.formData()
    const file = form.get('file')
    const kind = String(form.get('kind') ?? 'id_card')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'A file field is required' }, { status: 400 })
    }
    if (kind !== 'id_card') {
      return NextResponse.json({ error: 'Unsupported document kind' }, { status: 400 })
    }
    const buf = Buffer.from(await file.arrayBuffer())
    if (buf.length === 0 || buf.length > MAX_BYTES) {
      return NextResponse.json({ error: 'File empty or too large (max 10MB)' }, { status: 413 })
    }

    const enc = encrypt(buf.toString('base64'))
    const doc = await prisma.customerDocument.create({
      data: {
        customerId: customer.id,
        kind: 'id_card',
        encryptedData: Buffer.from(enc.encrypted, 'hex'),
        dataIv: enc.iv,
        dataTag: enc.tag,
      },
    })

    const result = await processDocument(doc.id, { onFieldVerified: () => {} })
    return NextResponse.json({ documentId: doc.id, status: result.status }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
