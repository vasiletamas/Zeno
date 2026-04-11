import { LRUCache } from '@/lib/cache/lru-cache'
import { getToolDefinition } from './registry'
import type { ToolResult } from './types'

const DEFAULT_TTL_MS = 300_000
const MAX_CACHE_SIZE = 50
// Use a very large TTL on the LRUCache itself — we manage per-entry TTL manually
const CACHE_CONTAINER_TTL = Number.MAX_SAFE_INTEGER

interface CachedEntry {
  result: ToolResult
  expiresAt: number
}

const cache = new LRUCache<string, CachedEntry>(MAX_CACHE_SIZE, CACHE_CONTAINER_TTL)
const keysByTool = new Map<string, Set<string>>()

function buildCacheKey(toolName: string, args: Record<string, unknown>): string {
  const sortedArgs = JSON.stringify(args, Object.keys(args).sort())
  return `${toolName}:${sortedArgs}`
}

function getTtlForTool(toolName: string): number {
  const def = getToolDefinition(toolName)
  return def?.cacheTtlMs ?? DEFAULT_TTL_MS
}

export function isToolCacheable(toolName: string): boolean {
  const def = getToolDefinition(toolName)
  return def?.cacheable === true
}

export function getCachedResult(
  toolName: string,
  args: Record<string, unknown>,
): ToolResult | undefined {
  const key = buildCacheKey(toolName, args)
  const entry = cache.get(key)
  if (!entry) return undefined

  if (Date.now() > entry.expiresAt) {
    cache.invalidate(key)
    return undefined
  }

  return entry.result
}

export function setCachedResult(
  toolName: string,
  args: Record<string, unknown>,
  result: ToolResult,
): void {
  const key = buildCacheKey(toolName, args)
  const ttl = getTtlForTool(toolName)
  cache.set(key, { result, expiresAt: Date.now() + ttl })

  let keys = keysByTool.get(toolName)
  if (!keys) {
    keys = new Set()
    keysByTool.set(toolName, keys)
  }
  keys.add(key)
}

export function invalidateToolCache(toolName?: string): void {
  if (!toolName) {
    cache.clear()
    keysByTool.clear()
    return
  }

  const keys = keysByTool.get(toolName)
  if (keys) {
    for (const key of keys) {
      cache.invalidate(key)
    }
    keysByTool.delete(toolName)
  }
}
