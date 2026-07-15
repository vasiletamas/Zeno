/**
 * /api/admin/product-content (E1 erratum 7, T11.D2 governance surface)
 *
 * GET  — list the versioned authored rows (field/locale/version/status)
 * POST — publish a draft version through the ONE workflow
 *        (publishProductContent: locale-complete + no-numerals gates,
 *        atomic retire-and-publish, cache flushes). approvedBy is the
 *        authenticated operator — the audit trail is the row itself.
 * Protected: ADMIN or OPERATOR (E2.5 pattern).
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { publishProductContent } from '@/lib/products/product-content'
import type { ProductContentField } from '@/lib/generated/prisma/client'

const FIELDS = new Set(['KEY_VALUE_PRODUCT_POINTS', 'SELL_SPECIFIC_INFO', 'SELL_SPECIFIC_ADDON_INFO', 'PRICING_NOTE'])

async function authorize(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || (payload.role !== 'ADMIN' && payload.role !== 'OPERATOR')) return null
  return payload
}

export async function GET(request: NextRequest) {
  try {
    const payload = await authorize(request)
    if (!payload) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const rows = await prisma.productContent.findMany({
      orderBy: [{ productId: 'asc' }, { field: 'asc' }, { version: 'desc' }, { locale: 'asc' }],
      select: {
        id: true, productId: true, addonId: true, field: true, locale: true,
        version: true, status: true, authoredBy: true, approvedBy: true,
        publishedAt: true, retiredAt: true, updatedAt: true,
      },
    })
    return NextResponse.json({ rows })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await authorize(request)
    if (!payload) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = (await request.json()) as { productId?: string; addonId?: string | null; field?: string; version?: number }
    if (!body.productId || !body.field || !FIELDS.has(body.field) || typeof body.version !== 'number') {
      return NextResponse.json({ error: 'Invalid body: productId, field, version required' }, { status: 400 })
    }
    const result = await publishProductContent({
      productId: body.productId,
      addonId: body.addonId ?? null,
      field: body.field as ProductContentField,
      version: body.version,
      approvedBy: payload.userId,
    })
    if (result.outcome === 'rejected') {
      return NextResponse.json({ outcome: 'rejected', reason: result.reason, params: result.params ?? null }, { status: 409 })
    }
    return NextResponse.json({ outcome: 'applied', publishedIds: result.publishedIds })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
