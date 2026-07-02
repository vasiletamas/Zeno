/**
 * Pure CNP validation (B3.1) — deterministic; the LLM is never the
 * validator (T4-R3). Checksum per the official weights, birth-date decode
 * from S+YYMMDD with the century chosen by the sex digit, and a
 * DOB-consistency check that answers 'unknown' for resident prefixes (7-9)
 * whose CNPs do not encode a birth date century.
 */

const WEIGHTS = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9]

export function validateCnpChecksum(cnp: string): boolean {
  if (!/^[1-9]\d{12}$/.test(cnp)) return false
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(cnp[i]), 0)
  const rem = sum % 11
  return (rem === 10 ? 1 : rem) === Number(cnp[12])
}

export function cnpBirthDate(cnp: string): Date | null {
  if (!/^[1-9]\d{12}$/.test(cnp)) return null
  const s = Number(cnp[0])
  const century = s <= 2 ? 1900 : s <= 4 ? 1800 : s <= 6 ? 2000 : null
  if (century === null) return null
  const yy = Number(cnp.slice(1, 3))
  const mm = Number(cnp.slice(3, 5))
  const dd = Number(cnp.slice(5, 7))
  const d = new Date(Date.UTC(century + yy, mm - 1, dd))
  return d.getUTCFullYear() === century + yy && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd ? d : null
}

export function cnpMatchesDob(cnp: string, dob: Date): boolean | 'unknown' {
  const b = cnpBirthDate(cnp)
  if (b === null) return Number(cnp[0]) >= 7 ? 'unknown' : false
  return b.toISOString().slice(0, 10) === dob.toISOString().slice(0, 10)
}
