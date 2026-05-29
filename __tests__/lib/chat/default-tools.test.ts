import { describe, it, expect } from 'vitest'
import { DEFAULT_DISCOVERY_TOOLS, withDefaultDiscoveryTools } from '@/lib/chat/default-tools'

describe('DEFAULT_DISCOVERY_TOOLS', () => {
  it('contains the five baseline tools', () => {
    expect(DEFAULT_DISCOVERY_TOOLS).toEqual([
      'list_products',
      'get_product_info',
      'set_candidate_product',
      'record_gdpr_consent',
      'acknowledge_ai_disclosure',
    ])
  })
})

describe('withDefaultDiscoveryTools', () => {
  it('returns all baseline tools when input is empty', () => {
    const result = withDefaultDiscoveryTools([])
    expect(result).toEqual([
      'list_products',
      'get_product_info',
      'set_candidate_product',
      'record_gdpr_consent',
      'acknowledge_ai_disclosure',
    ])
  })

  it('prepends baseline tools to workflow tools without duplicates', () => {
    const result = withDefaultDiscoveryTools(['save_application_answer', 'start_application'])
    expect(result).toEqual([
      'list_products',
      'get_product_info',
      'set_candidate_product',
      'record_gdpr_consent',
      'acknowledge_ai_disclosure',
      'save_application_answer',
      'start_application',
    ])
  })

  it('deduplicates when a workflow tool already matches a baseline tool', () => {
    const result = withDefaultDiscoveryTools(['list_products', 'save_application_answer'])
    expect(result.filter((t) => t === 'list_products')).toHaveLength(1)
    expect(result).toContain('save_application_answer')
    // all five baseline tools present
    expect(result).toEqual(expect.arrayContaining([
      'list_products', 'get_product_info',
      'set_candidate_product', 'record_gdpr_consent', 'acknowledge_ai_disclosure',
    ]))
  })
})
