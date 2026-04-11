interface CacheEntry<V> {
  value: V
  expiresAt: number
}

export class LRUCache<K, V> {
  private map = new Map<K, CacheEntry<V>>()

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number,
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined

    if (Date.now() > entry.expiresAt) {
      this.map.delete(key)
      return undefined
    }

    this.map.delete(key)
    this.map.set(key, entry)
    return entry.value
  }

  set(key: K, value: V): void {
    this.map.delete(key)

    if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value!
      this.map.delete(oldestKey)
    }

    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  invalidate(key: K): void {
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }
}
