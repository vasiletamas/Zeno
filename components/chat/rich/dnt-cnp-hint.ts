/**
 * Client-side CNP checksum hint for the DNT card (Task 2.1, D1) — catches
 * typos before the round-trip. The SERVER stays the boundary: the same
 * checksum is enforced in write_dnt_answer (dnt-handlers) regardless.
 */
import { validateCnpChecksum } from '@/lib/engines/cnp-validation'
import type { Language } from '@/lib/i18n/translations'

export function cnpChecksumHint(value: string, language: Language): string | null {
  const trimmed = value.trim()
  if (!/^\d{13}$/.test(trimmed)) {
    return language === 'ro'
      ? 'CNP-ul are exact 13 cifre — verifică te rog.'
      : 'A CNP has exactly 13 digits — please double-check.'
  }
  if (!validateCnpChecksum(trimmed)) {
    return language === 'ro'
      ? 'Cifra de control a CNP-ului nu se potrivește — verifică te rog cele 13 cifre.'
      : 'The CNP control digit does not match — please re-check the 13 digits.'
  }
  return null
}
