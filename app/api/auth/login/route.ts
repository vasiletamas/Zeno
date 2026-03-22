/**
 * POST /api/auth/login
 *
 * Admin/Operator login with email + password.
 * Returns JWT session cookie (24h expiry).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyPassword } from '@/lib/auth/passwords'
import { signToken, setAuthCookie } from '@/lib/auth/jwt'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = body as { email?: string; password?: string }

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 },
      )
    }

    // Find user — must be ADMIN or OPERATOR and active
    const user = await prisma.user.findUnique({
      where: { email },
    })

    if (
      !user ||
      (user.role !== 'ADMIN' && user.role !== 'OPERATOR') ||
      !user.isActive ||
      !user.passwordHash
    ) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 },
      )
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 },
      )
    }

    // Update lastLoginAt
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    // Sign JWT (24h expiry for admin/operator)
    const token = await signToken(
      { userId: user.id, role: user.role, email: user.email },
      '24h',
    )

    // Set cookie and return user info
    const response = NextResponse.json({
      user: { id: user.id, email: user.email, role: user.role },
    })
    setAuthCookie(response, token)

    return response
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
