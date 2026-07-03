import { describe, it, expect } from 'vitest'
import { deriveSchedulePosition } from '@/lib/engines/payment-position'

const now = new Date('2026-06-12T12:00:00Z')
const inst = (seq: number, status: string, amountMinor = 7500) => ({ id: `i${seq}`, sequence: seq, status, amountMinor, dueAt: new Date('2026-06-01T00:00:00Z') })
// erratum 3: payment rows carry id + providerPaymentId — the ensure apply
// dereferences them for provider cancel / CAS supersede / resumed lookup
const pay = (installmentId: string, status: string, createdAt: Date, n = 1) => ({ id: `p${n}`, installmentId, status, createdAt, providerPaymentId: `prov_${n}` })

describe('deriveSchedulePosition (D3.1)', () => {
  it('reports nextDue as the lowest-sequence PENDING/FAILED installment and counts captures', () => {
    const pos = deriveSchedulePosition({ installments: [inst(1, 'PAID'), inst(2, 'PENDING'), inst(3, 'PENDING')], payments: [], now })
    expect(pos.capturedCount).toBe(1)
    expect(pos.nextDue?.sequence).toBe(2)
    expect(pos.settled).toBe(false)
  })

  it('mode resolution: no attempt -> started; open PENDING attempt -> resumed; last attempt FAILED -> retried', () => {
    const base = { installments: [inst(1, 'PENDING')], now }
    expect(deriveSchedulePosition({ ...base, payments: [] }).recoveryMode).toBe('started')
    expect(deriveSchedulePosition({ ...base, payments: [pay('i1', 'PENDING', now)] }).recoveryMode).toBe('resumed')
    expect(deriveSchedulePosition({ installments: [inst(1, 'FAILED')], payments: [pay('i1', 'FAILED', now)], now }).recoveryMode).toBe('retried')
  })

  it('flags a PENDING attempt older than the staleness window as abandoned (read-time, no cron)', () => {
    const old = new Date(now.getTime() - 25 * 3600_000)
    const pos = deriveSchedulePosition({ installments: [inst(1, 'PENDING')], payments: [pay('i1', 'PENDING', old)], now, staleAfterHours: 24 })
    expect(pos.openAttemptStale).toBe(true)
    expect(pos.openAttempt?.providerPaymentId).toBe('prov_1')
  })

  it('fully PAID schedule is settled with no nextDue', () => {
    const pos = deriveSchedulePosition({ installments: [inst(1, 'PAID'), inst(2, 'PAID')], payments: [], now })
    expect(pos.settled).toBe(true)
    expect(pos.nextDue).toBeNull()
  })
})
