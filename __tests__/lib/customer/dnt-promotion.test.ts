/**
 * T6 (P5.6): pure DNT→profile/insight mapping. Demographic questionnaire
 * answers stop dying inside DntAnswer rows: the signature promotes them to
 * CustomerProfileField (declared/dnt) and the insight vocabulary.
 */
import { describe, it, expect } from 'vitest'
import { deriveDntPromotion } from '@/lib/customer/dnt-promotion'

describe('deriveDntPromotion', () => {
  it('maps all five demographic codes to profile fields with raw option values', () => {
    const plan = deriveDntPromotion({
      DNT_OCCUPATION: 'entrepreneur',
      DNT_FAMILY_SIZE: '3',
      DNT_MINOR_CHILDREN: '2',
      DNT_EDUCATION: 'university',
      DNT_INCOME_SOURCE: 'salary_pension,other_sources',
    })
    expect(plan.profileFields).toEqual([
      { field: 'occupation', value: 'entrepreneur' },
      { field: 'familySize', value: '3' },
      { field: 'minorChildren', value: '2' },
      { field: 'education', value: 'university' },
      { field: 'incomeSource', value: 'salary_pension,other_sources' },
    ])
  })

  it('derives the three insights: occupation as-is, familySize normalized, hasChildren boolean', () => {
    const plan = deriveDntPromotion({
      DNT_OCCUPATION: 'retired',
      DNT_FAMILY_SIZE: '2',
      DNT_MINOR_CHILDREN: '1',
    })
    expect(plan.insights).toEqual([
      { key: 'occupation', value: 'retired' },
      { key: 'familySize', value: '2' },
      { key: 'hasChildren', value: 'true' },
    ])
  })

  it("'5+' family size normalizes to '5' (Number('5+') is NaN and would fail the typed gate)", () => {
    const plan = deriveDntPromotion({ DNT_FAMILY_SIZE: '5+' })
    expect(plan.profileFields).toEqual([{ field: 'familySize', value: '5+' }]) // profile keeps the RAW option
    expect(plan.insights).toEqual([{ key: 'familySize', value: '5' }])
  })

  it("minorChildren '0' still promotes and yields hasChildren=false", () => {
    const plan = deriveDntPromotion({ DNT_MINOR_CHILDREN: '0' })
    expect(plan.profileFields).toEqual([{ field: 'minorChildren', value: '0' }])
    expect(plan.insights).toEqual([{ key: 'hasChildren', value: 'false' }])
  })

  it('missing answers are skipped entirely — never empty writes', () => {
    expect(deriveDntPromotion({})).toEqual({ profileFields: [], insights: [] })
    const partial = deriveDntPromotion({ DNT_EDUCATION: 'high_school', DNT_UNRELATED: 'x' })
    expect(partial.profileFields).toEqual([{ field: 'education', value: 'high_school' }])
    expect(partial.insights).toEqual([])
  })
})
