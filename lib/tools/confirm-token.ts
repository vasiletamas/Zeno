import { createHmac, timingSafeEqual } from 'crypto'

function sign(secret: string, conversationId: string, tool: string, argsHash: string, fingerprint: string): string {
  return createHmac('sha256', secret).update([conversationId, tool, argsHash, fingerprint].join('|')).digest('hex')
}

export function issueConfirmToken(secret: string, conversationId: string, tool: string, argsHash: string, fingerprint: string): string {
  return sign(secret, conversationId, tool, argsHash, fingerprint)
}

export function verifyConfirmToken(secret: string, token: string, conversationId: string, tool: string, argsHash: string, fingerprint: string): boolean {
  const expected = sign(secret, conversationId, tool, argsHash, fingerprint)
  if (token.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected))
}

export function confirmSecret(): string {
  return process.env.CONFIRM_TOKEN_SECRET ?? process.env.NEXTAUTH_SECRET ?? 'dev-confirm-secret'
}
