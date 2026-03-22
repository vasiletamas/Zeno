/**
 * Auth Types
 *
 * Shared types for the authentication system.
 * Used across JWT, middleware, and API routes.
 */

export interface AuthUser {
  userId: string
  role: 'CUSTOMER' | 'ADMIN' | 'OPERATOR'
  email: string
  customerId?: string
}

export interface JWTPayload {
  userId: string
  role: string
  email: string
}
