/**
 * T6 (P5.6): sign_dnt promotes the demographic answers to durable
 * customer facts in the SAME commit — CustomerProfileField rows
 * (provenance 'declared', source 'dnt') plus the occupation/familySize/
 * hasChildren insights at confidence 0.9 (declared beats inferred),
 * following the marketing-consent lift precedent.
 */
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, seedMinimalProtectFixture, signDntWithFacts } from '../helpers/test-db'

beforeEach(async () => { await resetDb() })

it('signature lifts DNT demographics to profile fields + insights', async () => {
  const fx = await seedMinimalProtectFixture()
  await signDntWithFacts(fx, {
    DNT_LIFE_SUBTYPE: 'simple_protection',
    DNT_OCCUPATION: 'freelancer',
    DNT_FAMILY_SIZE: '5+',
    DNT_MINOR_CHILDREN: '2',
    DNT_EDUCATION: 'postgraduate',
    DNT_INCOME_SOURCE: 'salary_pension',
  })

  const rows = await prisma.customerProfileField.findMany({ where: { customerId: fx.customerId } })
  const byField = Object.fromEntries(rows.map((r) => [r.field, r]))
  for (const [field, value] of [
    ['occupation', 'freelancer'],
    ['familySize', '5+'],
    ['minorChildren', '2'],
    ['education', 'postgraduate'],
    ['incomeSource', 'salary_pension'],
  ] as const) {
    expect(byField[field]).toMatchObject({ value, provenance: 'declared', source: 'dnt' })
  }

  const insights = await prisma.customerInsight.findMany({ where: { customerId: fx.customerId } })
  const insightByKey = Object.fromEntries(insights.map((i) => [i.key, i]))
  expect(insightByKey.occupation).toMatchObject({ value: 'freelancer', confidence: 0.9, source: fx.conversationId })
  expect(insightByKey.familySize).toMatchObject({ value: '5', confidence: 0.9 }) // '5+' normalized
  expect(insightByKey.hasChildren).toMatchObject({ value: 'true', confidence: 0.9 })
})

it('no minor children → hasChildren false; the Dnt itself still signs', async () => {
  const fx = await seedMinimalProtectFixture()
  await signDntWithFacts(fx, {
    DNT_LIFE_SUBTYPE: 'simple_protection',
    DNT_MINOR_CHILDREN: '0',
  })
  expect(await prisma.dnt.count({ where: { customerId: fx.customerId, status: 'ACTIVE' } })).toBe(1)
  const hasChildren = await prisma.customerInsight.findUnique({
    where: { customerId_key: { customerId: fx.customerId, key: 'hasChildren' } },
  })
  expect(hasChildren?.value).toBe('false')
})
