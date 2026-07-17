import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { engineVersion } from '@/lib/engines/derive-and-expose'
import { loadMedicalDeclarationState } from '@/lib/engines/medical-declaration-state'
import { setDeclaredField } from '@/lib/customer/profile-service'
import { buildReadyApplication, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'

/** same age arithmetic as profile-service getAge — the tests stay green as time passes */
const ageFrom = (d: Date, now = new Date()): number => {
  let a = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--
  return a
}

const gq = (fx: { customerId: string; conversationId: string }) =>
  executeCommit({ tool: 'generate_quote', args: {}, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })

describe('generate_quote commit (D1.4)', () => {
  beforeEach(async () => { await resetDb() })

  it('issued: creates Quote(ISSUED) and freezes the application in one transaction; the suitability report registers', async () => {
    const fx = await buildReadyApplication()
    const res = await gq(fx)
    expect(res.outcome).toBe('applied')
    const quote = await prisma.quote.findUniqueOrThrow({ where: { applicationId: fx.applicationId } })
    expect(quote.status).toBe('ISSUED')
    expect(quote.paymentFrequency).toBeNull() // elected at accept, not at issue
    const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.frozenAt).not.toBeNull()
    expect(app.status).toBe('COMPLETED')
    expect((app.quoteDecision as { outcome: string }).outcome).toBe('issued')
    // C3.6 flip: the suitability report is generated AT ISSUANCE
    const doc = await prisma.document.findFirst({ where: { quoteId: quote.id, kind: 'SUITABILITY_REPORT' } })
    expect(doc).not.toBeNull()
  })

  it('referred: NO Quote row, Application REFERRED, WorkItem(REFERRAL) created, decision persisted', async () => {
    const fx = await buildReadyApplication({ escalationFlag: 'HEALTH_DECLARATION_CONFIRM' })
    const res = await gq(fx)
    expect(res.outcome).toBe('referred')
    expect(res.reason).toBe('manual_underwriting')
    expect(await prisma.quote.findUnique({ where: { applicationId: fx.applicationId } })).toBeNull()
    const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.status).toBe('REFERRED')
    expect((app.quoteDecision as { outcome: string }).outcome).toBe('referred')
    const wi = await prisma.workItem.findFirstOrThrow({ where: { kind: 'REFERRAL' } }) // E2 model
    expect(wi.refs).toMatchObject({ applicationId: fx.applicationId })
  })

  it('missing DOB and CNP: requires_identity with needs, no quote, no silent age-30 pricing', async () => {
    const fx = await buildReadyApplication({ withoutDob: true })
    const res = await gq(fx)
    expect(res.outcome).toBe('requires_identity')
    expect(res.needs).toContain('declared:cnp_or_dateOfBirth') // B3 needs vocabulary (pinned literal adapted)
    expect(await prisma.quote.findUnique({ where: { applicationId: fx.applicationId } })).toBeNull()
  })

  it('T15: show_quote payload carries unit/caps/franchise per coverage + top-level currency; message sells instead of repeating numbers', async () => {
    const fx = await buildReadyApplication()
    const res = await gq(fx)
    expect(res.outcome).toBe('applied')
    const data = res.data as Record<string, unknown>

    const ui = data._uiAction as { type: string; payload: Record<string, unknown> }
    expect(ui.type).toBe('show_quote')
    const p = ui.payload

    // existing fields stay byte-identical
    expect(p.quoteId).toBeTruthy()
    expect(p.tierName).toEqual({ en: 'Standard', ro: 'Standard' })
    expect(p.levelName).toEqual({ en: 'Level I', ro: 'Nivelul I' })
    expect(p.includesAddon).toBe(false)
    expect(p.premiumAnnual).toBe(190)
    expect(p.premiumMonthly).toBe(15.83)
    expect(typeof p.validUntil).toBe('string')

    // NEW: the quote's currency at top level
    expect(p.currency).toBe('RON')

    // NEW: per-day coverages carry every qualifier the seed already had
    const base = p.baseCoverages as Array<Record<string, unknown>>
    const hosp = base.find((c) => c.code === 'HOSPITALIZATION_ACCIDENT')
    expect(hosp).toMatchObject({ amount: 20, currency: 'RON', unit: 'per_day', maxUnits: 90, deductibleDays: 3, capPeriod: 'per_year' })
    const death = base.find((c) => c.code === 'DEATH_ANY_CAUSE')!
    expect(death.unit).toBe('lump_sum')
    expect(death).not.toHaveProperty('maxUnits')
    expect(death).not.toHaveProperty('deductibleDays')
    expect(death).not.toHaveProperty('capPeriod')

    // conduct line: the factual lead stays for grounding; prose must not re-list the card
    const msg = data._message as string
    expect(msg).toContain('Quote issued: 190 RON/year (15.83 RON/month)')
    expect(msg).toContain('The application is now frozen')
    expect(msg).toContain('A quote card with ALL the numbers is shown')
    expect(msg).toContain('do NOT repeat prices or coverage figures')
    expect(msg).toContain('ONE short personalized reason to act')
  })

  it('a quote row in ANY state makes generate_quote illegal (one-app-one-quote; no P2002 path)', async () => {
    const fx = await buildReadyApplication()
    await gq(fx)
    const second = await gq(fx)
    expect(second.outcome).toBe('rejected')
    expect(second.reason).toBe('application_frozen')
  })

  // ── T14 (P4.1): the full rating-input snapshot frozen at issuance ─────────

  describe('T14: ratingInputs — no rating factor is re-derivable after issue', () => {
    it('freezes every factor (dateOfBirth path, addon off): age+source, null band, components, tier/level, null medical hash, dntId, engineVersion, fx placeholder', async () => {
      const fx = await buildReadyApplication()
      const res = await gq(fx)
      expect(res.outcome).toBe('applied')
      const quote = await prisma.quote.findUniqueOrThrow({ where: { applicationId: fx.applicationId } })
      const ri = quote.ratingInputs as Record<string, unknown> | null
      expect(ri).toBeTruthy()
      expect(ri!.ageUsed).toBe(ageFrom(new Date('1990-01-01')))
      expect(ri!.ageSource).toBe('dateOfBirth')
      expect(ri!.band).toBeNull() // no addon → no age band participated
      expect(ri!.basePremiumAnnual).toBe(190)
      expect(ri!.addonPremiumAnnual).toBe(0)
      expect(ri!.tierCode).toBe('standard')
      expect(ri!.levelCode).toBe('level_1')
      expect(ri!.includesAddon).toBe(false)
      expect(ri!.medicalAnswersHash).toBeNull() // addon off → no sensitive set required
      const dnt = await prisma.dnt.findFirstOrThrow({ where: { customerId: fx.customerId } })
      expect(ri!.dntId).toBe(dnt.id)
      expect(ri!.fx).toBeNull() // T18 fills this; the slot exists from day one
      expect(ri!.engineVersion).toBe(engineVersion)
      expect(typeof ri!.computedAt).toBe('string')
      expect(Number.isNaN(Date.parse(ri!.computedAt as string))).toBe(false)
    })

    it('addon on: the matched age band, the addon component and the medical answersHash freeze too', async () => {
      const fx = await buildReadyApplication({ addon: true })
      const res = await gq(fx)
      expect(res.outcome).toBe('applied')
      const quote = await prisma.quote.findUniqueOrThrow({ where: { applicationId: fx.applicationId } })
      const ri = quote.ratingInputs as Record<string, unknown>
      expect(ri.includesAddon).toBe(true)
      // DOB 1990-01-01 → band 31-45 (seeded AddonPricingRule)
      expect(ri.band).toEqual({ minAge: 31, maxAge: 45 })
      expect(ri.basePremiumAnnual).toBe(190)
      expect(ri.addonPremiumAnnual).toBe(350)
      expect(quote.premiumAnnual).toBe(540)
      const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
      const medical = await loadMedicalDeclarationState(prisma, app)
      expect(ri.medicalAnswersHash).toBe(medical.currentHash)
    })

    it('ageSource declaredAge: no DOB, declaredAge BEATS the declared CNP in the age priority and the source is recorded', async () => {
      // the identity wall (IDENTITY_REQUIREMENTS) demands a declared CNP or
      // DOB to quote at all — the CNP satisfies the wall, but the derivation
      // priority (dateOfBirth → declaredAge → cnp) makes the declared age
      // the factor actually used, and THAT is what must freeze.
      const fx = await buildReadyApplication({ withoutDob: true })
      await setDeclaredField(fx.customerId, 'cnp', '1900101080012', 'fixture') // encodes 1990-01-01
      await setDeclaredField(fx.customerId, 'declaredAge', '40', 'fixture')
      const res = await gq(fx)
      expect(res.outcome).toBe('applied')
      const quote = await prisma.quote.findUniqueOrThrow({ where: { applicationId: fx.applicationId } })
      const ri = quote.ratingInputs as Record<string, unknown>
      expect(ri.ageUsed).toBe(40)
      expect(ri.ageSource).toBe('declaredAge')
    })

    it('ageSource cnp: only a CNP known — the derived age and its source are recorded', async () => {
      const fx = await buildReadyApplication({ withoutDob: true })
      await setDeclaredField(fx.customerId, 'cnp', '1900101080012', 'fixture') // encodes 1990-01-01
      const res = await gq(fx)
      expect(res.outcome).toBe('applied')
      const quote = await prisma.quote.findUniqueOrThrow({ where: { applicationId: fx.applicationId } })
      const ri = quote.ratingInputs as Record<string, unknown>
      expect(ri.ageUsed).toBe(ageFrom(new Date('1990-01-01')))
      expect(ri.ageSource).toBe('cnp')
    })
  })
})
