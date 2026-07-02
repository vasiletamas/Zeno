import { it, expect } from 'vitest'
import { validateCnpChecksum, cnpBirthDate, cnpMatchesDob } from '@/lib/engines/cnp-validation'

it('checksum: weights 279146358279, control = sum%11 (10→1)', () => {
  expect(validateCnpChecksum('1980418089861')).toBe(true)
  expect(validateCnpChecksum('2950715123458')).toBe(true)
  expect(validateCnpChecksum('1980418089862')).toBe(false) // wrong control digit
  expect(validateCnpChecksum('0980418089861')).toBe(false) // leading 0 invalid
})

it('birth date decodes from S+YYMMDD with century by sex digit', () => {
  expect(cnpBirthDate('1980418089861')?.toISOString().slice(0, 10)).toBe('1998-04-18')
  expect(cnpBirthDate('2950715123458')?.toISOString().slice(0, 10)).toBe('1995-07-15')
  expect(cnpBirthDate('1981332089861')).toBeNull() // month 13 impossible
})

it('DOB consistency: match, mismatch, unknown for resident prefixes 7-9', () => {
  expect(cnpMatchesDob('1980418089861', new Date('1998-04-18'))).toBe(true)
  expect(cnpMatchesDob('1980418089861', new Date('1998-04-19'))).toBe(false)
  expect(cnpMatchesDob('7980418089865', new Date('1998-04-18'))).toBe('unknown')
})
