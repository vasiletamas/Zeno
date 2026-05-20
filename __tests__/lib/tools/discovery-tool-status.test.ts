import { describe, it, expect } from 'vitest'
import { getToolDefinition } from '@/lib/tools/registry'

describe('discovery tool status messages', () => {
  it('list_products has bilingual status messages', () => {
    const def = getToolDefinition('list_products')
    expect(def?.statusMessage).toBeDefined()
    expect(def?.statusMessage?.ro?.length).toBeGreaterThan(0)
    expect(def?.statusMessage?.en?.length).toBeGreaterThan(0)
  })

  it('get_product_info has bilingual status messages', () => {
    const def = getToolDefinition('get_product_info')
    expect(def?.statusMessage).toBeDefined()
    expect(def?.statusMessage?.ro?.length).toBeGreaterThan(0)
    expect(def?.statusMessage?.en?.length).toBeGreaterThan(0)
  })

  it('set_conversation_product has bilingual status messages', () => {
    const def = getToolDefinition('set_conversation_product')
    expect(def?.statusMessage).toBeDefined()
    expect(def?.statusMessage?.ro?.length).toBeGreaterThan(0)
    expect(def?.statusMessage?.en?.length).toBeGreaterThan(0)
  })
})
