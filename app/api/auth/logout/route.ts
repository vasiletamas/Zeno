/**
 * POST /api/auth/logout
 *
 * Clears the zeno_auth session cookie.
 */

import { NextResponse } from 'next/server'
import { clearAuthCookie } from '@/lib/auth/jwt'

export async function POST() {
  const response = NextResponse.json({ success: true })
  clearAuthCookie(response)
  return response
}
