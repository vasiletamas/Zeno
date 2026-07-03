import { describe, it, expect } from 'vitest'
import { disclosuresRequired } from '@/lib/engines/disclosures'

const ipidV2 = { kind: 'IPID' as const, version: 2, language: 'ro' }
const termsV1 = { kind: 'TERMS' as const, version: 1, language: 'ro' }

describe('disclosuresRequired (set difference, version+language bound)', () => {
  it('all current docs unacked -> all required', () => {
    expect(disclosuresRequired([ipidV2, termsV1], [])).toEqual([ipidV2, termsV1])
  })
  it('ack at an OLD version does not satisfy the current version', () => {
    expect(disclosuresRequired([ipidV2, termsV1], [{ kind: 'IPID', version: 1, language: 'ro' }])).toEqual([ipidV2, termsV1])
  })
  it('ack in another LANGUAGE does not satisfy', () => {
    expect(disclosuresRequired([ipidV2], [{ kind: 'IPID', version: 2, language: 'en' }])).toEqual([ipidV2])
  })
  it('exact version+language acks satisfy', () => {
    expect(disclosuresRequired([ipidV2, termsV1], [ipidV2, termsV1])).toEqual([])
  })
})
