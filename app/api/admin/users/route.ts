/**
 * POST /api/admin/users
 *
 * Create an OPERATOR user with email + password.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { hashPassword } from '@/lib/auth/passwords'
import { prisma } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    // Auth check — ADMIN only
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { email, password, role } = body as {
      email?: string
      password?: string
      role?: string
    }

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 },
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 },
      )
    }

    // Only allow creating OPERATOR users via this endpoint
    if (role && role !== 'OPERATOR') {
      return NextResponse.json(
        { error: 'Can only create OPERATOR users' },
        { status: 400 },
      )
    }

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { error: 'Email already exists' },
        { status: 409 },
      )
    }

    const passwordHash = await hashPassword(password)

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'OPERATOR',
        isActive: true,
      },
    })

    return NextResponse.json(
      { user: { id: user.id, email: user.email, role: user.role } },
      { status: 201 },
    )
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
