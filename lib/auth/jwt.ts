/**
 * JWT Token Management
 *
 * Uses jose for Edge-compatible JWT signing and verification.
 * Algorithm: HS256. Secret from JWT_SECRET env var.
 * Cookie: zeno_auth — HttpOnly, SameSite=Lax, Secure in production.
 */

import { SignJWT, jwtVerify } from 'jose'
import type { JWTPayload } from './types'

const COOKIE_NAME = 'zeno_auth'

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set')
  }
  return new TextEncoder().encode(secret)
}

/**
 * Sign a JWT with the given payload and expiration.
 * @param payload - User data to encode in the token
 * @param expiresIn - Expiration string (e.g., '24h', '7d')
 */
export async function signToken(
  payload: JWTPayload,
  expiresIn: string,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecret())
}

/**
 * Verify a JWT and return its payload, or null if invalid/expired.
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return {
      userId: payload.userId as string,
      role: payload.role as string,
      email: payload.email as string,
    }
  } catch {
    return null
  }
}

/**
 * Set the zeno_auth cookie on a Response with appropriate security attributes.
 */
export function setAuthCookie(response: Response, token: string): void {
  const isProduction = process.env.NODE_ENV === 'production'
  const cookie = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    isProduction ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ')

  response.headers.append('Set-Cookie', cookie)
}

/**
 * Clear the zeno_auth cookie on a Response.
 */
export function clearAuthCookie(response: Response): void {
  const isProduction = process.env.NODE_ENV === 'production'
  const cookie = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
    isProduction ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ')

  response.headers.append('Set-Cookie', cookie)
}

export { COOKIE_NAME }
