import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/tools/registry', () => ({
  getToolDefinition: vi.fn((name: string) => {
    if (name === 'get_product_info') return { cacheable: true, cacheTtlMs: 5000 }
    if (name === 'list_products') return { cacheable: true }
    if (name === 'save_dnt_answer') return { cacheable: false }
    return {}
  }),
}))

const { isToolCacheable, getCachedResult, setCachedResult, invalidateToolCache } = await import('@/lib/tools/cache')

describe('Tool Result Cache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    invalidateToolCache()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('isToolCacheable returns true for cacheable tools', () => {
    expect(isToolCacheable('get_product_info')).toBe(true)
    expect(isToolCacheable('list_products')).toBe(true)
  })

  it('isToolCacheable returns false for non-cacheable tools', () => {
    expect(isToolCacheable('save_dnt_answer')).toBe(false)
    expect(isToolCacheable('unknown_tool')).toBe(false)
  })

  it('returns undefined on cache miss', () => {
    expect(getCachedResult('get_product_info', { productCode: 'protect' })).toBeUndefined()
  })

  it('stores and retrieves cached results', () => {
    const result = { success: true, data: { name: 'Protect' } }
    setCachedResult('get_product_info', { productCode: 'protect' }, result)
    const cached = getCachedResult('get_product_info', { productCode: 'protect' })
    expect(cached).toEqual(result)
  })

  it('generates deterministic cache keys regardless of arg order', () => {
    const result = { success: true, data: { products: [] } }
    setCachedResult('list_products', { type: 'LIFE', active: true }, result)
    const cached = getCachedResult('list_products', { active: true, type: 'LIFE' })
    expect(cached).toEqual(result)
  })

  it('expires entries after TTL', () => {
    const result = { success: true, data: { name: 'Protect' } }
    setCachedResult('get_product_info', { productCode: 'protect' }, result)
    expect(getCachedResult('get_product_info', { productCode: 'protect' })).toEqual(result)
    vi.advanceTimersByTime(5001)
    expect(getCachedResult('get_product_info', { productCode: 'protect' })).toBeUndefined()
  })

  it('invalidateToolCache clears all entries', () => {
    setCachedResult('get_product_info', { productCode: 'protect' }, { success: true })
    setCachedResult('list_products', {}, { success: true, data: { products: [] } })
    invalidateToolCache()
    expect(getCachedResult('get_product_info', { productCode: 'protect' })).toBeUndefined()
    expect(getCachedResult('list_products', {})).toBeUndefined()
  })

  it('invalidateToolCache with toolName clears only that tool', () => {
    setCachedResult('get_product_info', { productCode: 'protect' }, { success: true })
    setCachedResult('list_products', {}, { success: true, data: { products: [] } })
    invalidateToolCache('get_product_info')
    expect(getCachedResult('get_product_info', { productCode: 'protect' })).toBeUndefined()
    expect(getCachedResult('list_products', {})).toEqual({ success: true, data: { products: [] } })
  })
})
