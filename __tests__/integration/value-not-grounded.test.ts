/**
 * P0-1 write-guard integration: agent-actor value writes with no anchor in
 * the customer's recent messages are REJECTED value_not_grounded; grounded
 * writes and GUI-actor writes (card clicks = the customer's own input) pass.
 * Evidence lineage: family-size "2" persisted after five bare "da" replies
 * (production-readiness P0 #1).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, seedMinimalProtectFixture } from '../helpers/test-db'
import { openDntSession, writeDntAnswer } from '@/lib/tools/handlers/dnt-handlers'
import { writeQuestionAnswer } from '@/lib/tools/handlers/application-handlers'
import { collectCustomerField } from '@/lib/tools/handlers/data-handlers'
import type { ToolContext } from '@/lib/tools/types'

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>
beforeEach(async () => {
  await resetDb()
  fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: false })
})

const ctx = (actor: 'agent' | 'gui' = 'agent') =>
  ({ customerId: fx.customerId, conversationId: fx.conversationId, language: 'ro', db: prisma, actor } as unknown as ToolContext)

async function say(role: 'user' | 'assistant', content: string) {
  await prisma.message.create({ data: { conversationId: fx.conversationId, role, content } })
}

describe('P0-1 write-guard — value_not_grounded', () => {
  it('write_dnt_answer: numeric value with no anchor is rejected (the original family-size fabrication)', async () => {
    await openDntSession({}, ctx())
    for (const m of ['da', 'da', 'da', 'da', 'da']) await say('user', m)
    const r = await writeDntAnswer({ questionCode: 'DNT_FAMILY_SIZE', value: '2' }, ctx())
    expect(r.success).toBe(false)
    expect(r.error).toContain('value_not_grounded')
  })

  it('write_dnt_answer: the same value grounded in the customer words applies', async () => {
    await openDntSession({}, ctx())
    await say('user', 'suntem 2 in familie')
    const r = await writeDntAnswer({ questionCode: 'DNT_FAMILY_SIZE', value: '2' }, ctx())
    expect(r.success).toBe(true)
  })

  it('write_dnt_answer: enum token grounded via the option label ("din salariu" -> salary_pension)', async () => {
    await openDntSession({}, ctx())
    await say('user', 'venitul meu provine din salariu')
    const r = await writeDntAnswer({ questionCode: 'DNT_INCOME_SOURCE', value: 'salary_pension' }, ctx())
    expect(r.success).toBe(true)
  })

  it('write_question_answer: a boolean answered without any customer da/nu is rejected', async () => {
    await say('user', 'ce inseamna intrebarea asta?')
    const r = await writeQuestionAnswer({ answer: 'da', questionCode: 'HEALTH_DECLARATION_CONFIRM' }, ctx())
    expect(r.success).toBe(false)
    expect(r.error).toContain('value_not_grounded')
  })

  it('write_question_answer: the customer\'s own "da" grounds the boolean', async () => {
    await say('user', 'da')
    const r = await writeQuestionAnswer({ answer: 'da', questionCode: 'HEALTH_DECLARATION_CONFIRM' }, ctx())
    expect(r.success).toBe(true)
  })

  it('collect_customer_field: an email the customer never uttered is rejected; the uttered one applies', async () => {
    await say('user', 'da, continuam')
    const bad = await collectCustomerField({ field: 'email', value: 'invented@example.com' }, ctx())
    expect(bad.success).toBe(false)
    expect(bad.error).toContain('value_not_grounded')

    await say('user', 'emailul meu este ion.sim@example.com')
    const good = await collectCustomerField({ field: 'email', value: 'ion.sim@example.com' }, ctx())
    expect(good.success).toBe(true)
  })

  it('GUI actor bypasses the guard (the card click IS the customer input)', async () => {
    const r = await collectCustomerField({ field: 'email', value: 'from.card@example.com' }, ctx('gui'))
    expect(r.success).toBe(true)
  })

  it('confirmed proposal passes: agent proposed the value, customer said da', async () => {
    await openDntSession({}, ctx())
    await say('assistant', 'Înțeleg că venitul provine din salariu sau pensie — confirmi?')
    await say('user', 'da')
    const r = await writeDntAnswer({ questionCode: 'DNT_INCOME_SOURCE', value: 'salary_pension' }, ctx())
    expect(r.success).toBe(true)
  })
})
