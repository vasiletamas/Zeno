/**
 * Pure schedule-position derivation (D3.1, contradiction #3) — no DB.
 *
 * From installment + payment-attempt rows: the next due installment
 * (lowest-sequence PENDING/FAILED), the captured count, the canonical open
 * attempt, its read-time staleness (no cron — T8.D4's abandoned signal is
 * derived at read), and the engine-determined recovery mode
 * (started|resumed|retried) that ensure_payment_session OUTPUTS, never
 * takes as input. Payment rows carry id + providerPaymentId (D3 erratum 3)
 * so the ensure apply can cancel/supersede/resume against the provider.
 */
export interface PositionInput {
  installments: { id: string; sequence: number; status: string; amountMinor: number; dueAt: Date }[]
  payments: { id: string; installmentId: string; status: string; createdAt: Date; providerPaymentId: string | null }[]
  now: Date
  staleAfterHours?: number
}

export function deriveSchedulePosition(i: PositionInput) {
  const sorted = [...i.installments].sort((a, b) => a.sequence - b.sequence)
  const capturedCount = sorted.filter((x) => x.status === 'PAID').length
  const nextDue = sorted.find((x) => x.status === 'PENDING' || x.status === 'FAILED') ?? null
  const attempts = nextDue ? i.payments.filter((p) => p.installmentId === nextDue.id) : []
  const open = attempts.find((p) => p.status === 'PENDING') ?? null
  const lastFailed = attempts.some((p) => p.status === 'FAILED')
  const recoveryMode: 'started' | 'resumed' | 'retried' = open ? 'resumed' : lastFailed ? 'retried' : 'started'
  const staleMs = (i.staleAfterHours ?? 24) * 3600_000
  const openAttemptStale = open !== null && i.now.getTime() - open.createdAt.getTime() > staleMs
  return { capturedCount, nextDue, recoveryMode, openAttempt: open, openAttemptStale, settled: nextDue === null }
}
