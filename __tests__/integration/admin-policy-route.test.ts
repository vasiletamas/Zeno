import { describe, it, expect, beforeEach } from 'vitest'
import { resetDb } from '@/__tests__/helpers/test-db'
import { PATCH } from '@/app/api/admin/policies/[id]/status/route'
import { buildPaidPolicy, operatorRequest } from '@/__tests__/helpers/funnel-fixtures'

describe('admin policy route goes through the gateway (D4.3)', () => {
  beforeEach(async () => { await resetDb() })

  it('cannot un-cancel or jump states: activate on PENDING_SUBMISSION -> 409 with illegal_status_transition', async () => {
    const fx = await buildPaidPolicy()
    const res = await PATCH(await operatorRequest({ action: 'activate', allianzPolicyNumber: 'AZT-9' }), { params: Promise.resolve({ id: fx.policyId }) })
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('illegal_status_transition')
  })

  it('mark_submitted then activate succeeds and records the activation email send', async () => {
    const fx = await buildPaidPolicy()
    const r1 = await PATCH(await operatorRequest({ action: 'mark_submitted' }), { params: Promise.resolve({ id: fx.policyId }) })
    expect(r1.status).toBe(200)
    const res = await PATCH(await operatorRequest({ action: 'activate', allianzPolicyNumber: 'AZT-9' }), { params: Promise.resolve({ id: fx.policyId }) })
    expect(res.status).toBe(200)
    // erratum 2: the mock email provider records outbound sends
    const { getEmailProvider } = await import('@/lib/email')
    const sent = (getEmailProvider() as unknown as { sent?: { subject: string }[] }).sent
    expect(sent?.some((m) => /activat/i.test(m.subject))).toBe(true)
  })
})
