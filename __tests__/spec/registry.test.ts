import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spec, scanSpecRegistrations } from '@/lib/spec/registry'
import { toToolName, DROPPED_OPERATIONS } from '@/lib/spec/operations-map'

describe('spec()', () => {
  it('returns a stable [spec:...] marker for valid ids', () => {
    expect(spec('dnt/refused-consent-blocks-funnel')).toBe('[spec:dnt/refused-consent-blocks-funnel]')
    expect(spec('questionnaire/modify-answer-consequence#ex3')).toBe('[spec:questionnaire/modify-answer-consequence#ex3]')
  })
  it('rejects malformed ids', () => {
    expect(() => spec('NoSlash')).toThrow()
    expect(() => spec('upper/Case')).toThrow()
  })
})

describe('scanSpecRegistrations', () => {
  it('finds spec(...) string literals in *.test.ts files recursively', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specscan-'))
    fs.mkdirSync(path.join(dir, 'nested'))
    fs.writeFileSync(path.join(dir, 'nested', 'a.test.ts'),
      `it(spec('quote/expired-quote-cannot-be-accepted') + ' x', () => {})\nit(spec("dnt/signing-after-needs-analysis"), () => {})\n`)
    fs.writeFileSync(path.join(dir, 'ignored.ts'), `spec('not/counted')`)
    const reg = scanSpecRegistrations(dir)
    expect([...reg.keys()].sort()).toEqual(['dnt/signing-after-needs-analysis', 'quote/expired-quote-cannot-be-accepted'])
  })
})

describe('operations map (T12 risk mitigation: renames are one line)', () => {
  it('maps retired catalog names to the pinned 6-tool DNT surface (#7) and M2 reads', () => {
    expect(toToolName('start_dnt_session')).toBe('open_dnt_session')
    expect(toToolName('update_dnt')).toBe('open_dnt_session')
    expect(toToolName('modify_dnt_answer')).toBe('write_dnt_answer')
    expect(toToolName('get_dnt_session_details')).toBe('get_dnt_state')
    expect(toToolName('get_customer_info')).toBe('get_customer_profile')
  })
  it('maps catalog operations the implementation renamed or absorbed', () => {
    expect(toToolName('get_policy_status')).toBe('get_policy_info')
    expect(toToolName('get_policy_documents')).toBe('get_policy_info')
    expect(toToolName('identify_customer')).toBe('start_channel_verification')
    expect(toToolName('resume_payment')).toBe('ensure_payment_session')
    expect(toToolName('retry_payment')).toBe('ensure_payment_session')
  })
  it('declares the two dropped list reads (M2 spec amendment)', () => {
    expect(DROPPED_OPERATIONS).toEqual(['get_application_list', 'get_quote_list'])
  })
})
