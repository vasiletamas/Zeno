/**
 * Next.js Middleware — Route Protection
 *
 * Runs in Edge runtime. Validates JWT from zeno_auth cookie and
 * enforces role-based access to protected routes.
 *
 * IMPORTANT: This file CANNOT import Prisma (Edge runtime limitation).
 * The isActive check for admin/operator users is done in API routes
 * and server components using the regular Prisma client.
 */

import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

export const config = {
  matcher: ['/admin/:path*', '/dashboard/:path*', '/api/admin/:path*'],
}

const COOKIE_NAME = 'zeno_auth'

interface TokenPayload {
  userId: string
  role: string
  email: string
}

async function verifyJWT(token: string): Promise<TokenPayload | null> {
  const secret = process.env.JWT_SECRET
  if (!secret) return null

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
    )
    return {
      userId: payload.userId as string,
      role: payload.role as string,
      email: payload.email as string,
    }
  } catch {
    return null
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow login pages without auth
  if (
    pathname === '/admin/login' || pathname === '/admin/login/' ||
    pathname === '/dashboard/login' || pathname === '/dashboard/login/' ||
    pathname.startsWith('/admin/login?') || pathname.startsWith('/dashboard/login?')
  ) {
    return NextResponse.next()
  }

  // Extract token from zeno_auth cookie
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) {
    return redirectToLogin(request, pathname)
  }

  // Verify JWT
  const user = await verifyJWT(token)
  if (!user) {
    return redirectToLogin(request, pathname)
  }

  // Check role against route requirements
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    // Admin and API admin routes require ADMIN or OPERATOR
    if (user.role !== 'ADMIN' && user.role !== 'OPERATOR') {
      // If they're a CUSTOMER, send to customer dashboard
      if (user.role === 'CUSTOMER') {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }
      return redirectToLogin(request, pathname)
    }
  } else if (pathname.startsWith('/dashboard')) {
    // Dashboard routes require CUSTOMER role
    if (user.role !== 'CUSTOMER') {
      // If they're admin/operator, send to admin panel
      if (user.role === 'ADMIN' || user.role === 'OPERATOR') {
        return NextResponse.redirect(new URL('/admin', request.url))
      }
      return redirectToLogin(request, pathname)
    }
  }

  return NextResponse.next()
}

function redirectToLogin(request: NextRequest, pathname: string): NextResponse {
  if (pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/dashboard/login', request.url))
  }
  // Admin and API admin routes redirect to admin login
  return NextResponse.redirect(new URL('/admin/login', request.url))
}
