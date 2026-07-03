import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { buildIssuedQuote } from '@/__tests__/helpers/funnel-fixtures'

describe('payment frequency is elected at accept, not asked in the questionnaire (D1.8, T7.D3)', () => {
  beforeEach(async () => { await resetDb() })

  it('PAYMENT_FREQUENCY is not a seeded active question', async () => {
    expect(await prisma.question.findFirst({ where: { code: 'PAYMENT_FREQUENCY' } })).toBeNull()
  })

  it('issued quotes carry paymentFrequency null', async () => {
    const fx = await buildIssuedQuote()
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })
    expect(quote.paymentFrequency).toBeNull()
  })
})
