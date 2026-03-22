/**
 * Auth Middleware Helpers
 *
 * Functions for extracting and validating auth state from requests.
 * Used by Next.js middleware and server components/API routes.
 *
 * NOTE: verifyUserActive uses Prisma and CANNOT run in Edge middleware.
 * Call it in API routes and server components instead.
 */

import { NextRequest } from 'next/server'
import { verifyToken, COOKIE_NAME } from './jwt'
import type { AuthUser } from './types'
import { prisma } from '@/lib/db'

/**
 * Extract the auth user from a request's zeno_auth cookie.
 * Returns null if no valid token is present.
 *
 * Safe for Edge runtime (no DB calls).
 */
export async function getAuthUser(
  request: NextRequest,
): Promise<AuthUser | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return null

  const payload = await verifyToken(token)
  if (!payload) return null

  return {
    userId: payload.userId,
    role: payload.role as AuthUser['role'],
    email: payload.email,
  }
}

/**
 * Check if a user has one of the required roles.
 */
export function hasRole(
  user: AuthUser,
  requiredRoles: AuthUser['role'][],
): boolean {
  return requiredRoles.includes(user.role)
}

/**
 * Verify a user is still active in the database.
 *
 * IMPORTANT: This uses Prisma and CANNOT run in Edge middleware.
 * Use only in API routes and server components.
 */
export async function verifyUserActive(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true },
  })
  return user?.isActive ?? false
}
