import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LRUCache } from '@/lib/cache/lru-cache'

describe('LRUCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns undefined for missing keys', () => {
    const cache = new LRUCache<string, number>(10, 60_000)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('stores and retrieves values', () => {
    const cache = new LRUCache<string, number>(10, 60_000)
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)
  })

  it('evicts oldest entry when maxSize is exceeded', () => {
    const cache = new LRUCache<string, number>(2, 60_000)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
  })

  it('expires entries past TTL', () => {
    const cache = new LRUCache<string, number>(10, 1000)
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)
    vi.advanceTimersByTime(1001)
    expect(cache.get('a')).toBeUndefined()
  })

  it('refreshes position on get (LRU behavior)', () => {
    const cache = new LRUCache<string, number>(2, 60_000)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a')
    cache.set('c', 3)
    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe(3)
  })

  it('invalidate removes a specific key', () => {
    const cache = new LRUCache<string, number>(10, 60_000)
    cache.set('a', 1)
    cache.invalidate('a')
    expect(cache.get('a')).toBeUndefined()
  })

  it('clear removes all entries', () => {
    const cache = new LRUCache<string, number>(10, 60_000)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.clear()
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeUndefined()
  })

  it('overwrites existing key without increasing size', () => {
    const cache = new LRUCache<string, number>(2, 60_000)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 10)
    cache.set('c', 3)
    expect(cache.get('a')).toBe(10)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe(3)
  })
})
