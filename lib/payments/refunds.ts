/**
 * Full-schedule refund (D4.5) — the payment-module SYSTEM effect with two
 * triggers (contradiction #5): the engine's free-look cancellation and the
 * operator's pre-activation cancellation (Allianz rejection). Refunds every
 * COMPLETED payment of the schedule at the provider and marks the rows
 * REFUNDED — the enum member finally has a writer.
 */
import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'
import { getPaymentProvider } from '@/lib/payments'

type Db = typeof prisma | Prisma.TransactionClient

export async function executeFullRefund(tx: Db, scheduleId: string): Promise<{ refundedCount: number }> {
  const payments = await tx.payment.findMany({ where: { status: 'COMPLETED', installment: { scheduleId } } })
  const provider = getPaymentProvider()
  for (const p of payments) {
    if (!p.providerPaymentId) continue
    await provider.refundPayment(p.providerPaymentId, p.amountMinor)
    await tx.payment.update({ where: { id: p.id }, data: { status: 'REFUNDED' } })
  }
  return { refundedCount: payments.length }
}
