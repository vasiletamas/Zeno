/**
 * PII Encryption — AES-256-GCM
 *
 * Encrypts sensitive data (CNP) with a random IV per operation.
 * Key sourced from ENCRYPTION_KEY env var (64-char hex = 32 bytes).
 */

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-char hex string (32 bytes)')
  }
  return Buffer.from(key, 'hex')
}

export function encrypt(plaintext: string): { encrypted: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag().toString('hex')
  return { encrypted, iv: iv.toString('hex'), tag }
}

export function decrypt(encrypted: string, iv: string, tag: string): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, 'hex'))
  decipher.setAuthTag(Buffer.from(tag, 'hex'))
  let plaintext = decipher.update(encrypted, 'hex', 'utf8')
  plaintext += decipher.final('utf8')
  return plaintext
}

/**
 * Mask CNP for display: "1880******3456"
 * Shows first 4 + last 3 digits, middle 6 replaced with asterisks.
 */
export function maskCnp(cnp: string): string {
  if (cnp.length !== 13) return '***'
  return cnp.slice(0, 4) + '*'.repeat(6) + cnp.slice(10)
}

/** JSON AES envelope — the DntAnswer at-rest format (Task 5.4, D11). */
export function encryptEnvelope(plaintext: string): string {
  return JSON.stringify(encrypt(plaintext))
}

/**
 * Tolerant envelope decode (Task 5.4): pre-backfill plaintext rows pass
 * through unchanged, so reads never break mid-migration.
 */
export function decryptEnvelopeTolerant(value: string): string {
  if (!value.startsWith('{')) return value
  try {
    const e = JSON.parse(value) as { encrypted: string; iv: string; tag: string }
    return decrypt(e.encrypted, e.iv, e.tag)
  } catch {
    return value
  }
}
