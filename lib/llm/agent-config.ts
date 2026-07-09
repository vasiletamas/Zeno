/**
 * Agent Configuration Loader
 *
 * Loads Agent records from the database by slug with 5-minute in-memory caching.
 * Each agent config drives which provider, model, temperature, etc. the gateway uses.
 */

import { prisma } from '@/lib/db'
import type { Agent, LLMProvider } from '@/lib/generated/prisma/client'

// ==============================================
// AGENT CONFIG TYPE
// ==============================================

export interface AgentConfig {
  slug: string
  name: string
  role: string
  provider: LLMProvider
  model: string
  fallbackProvider: LLMProvider | null
  fallbackModel: string | null
  temperature: number
  maxTokens: number
  systemPrompt: string | null
  /** E1: phase-/turn-scoped sections keyed by SECTION_REGISTRY key; null = pre-split row. */
  promptSections: Record<string, string> | null
  constraints: string | null
  isActive: boolean
}

// ==============================================
// CACHE
// ==============================================

interface CacheEntry {
  config: AgentConfig
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const cache = new Map<string, CacheEntry>()

// ==============================================
// PUBLIC API
// ==============================================

/**
 * Load an agent config by slug. Returns cached result if fresh,
 * otherwise queries the database. Throws if not found or inactive.
 */
export async function getAgentConfig(slug: string): Promise<AgentConfig> {
  const now = Date.now()
  const cached = cache.get(slug)

  if (cached && cached.expiresAt > now) {
    return cached.config
  }

  const agent = await prisma.agent.findUnique({ where: { slug } })

  if (!agent) {
    throw new Error(`Agent not found: ${slug}`)
  }

  if (!agent.isActive) {
    throw new Error(`Agent is inactive: ${slug}`)
  }

  const config: AgentConfig = {
    slug: agent.slug,
    name: agent.name,
    role: agent.role,
    provider: agent.provider,
    model: agent.model,
    fallbackProvider: agent.fallbackProvider,
    fallbackModel: agent.fallbackModel,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    systemPrompt: agent.systemPrompt,
    promptSections: parsePromptSections(agent.promptSections),
    constraints: agent.constraints,
    isActive: agent.isActive,
  }

  cache.set(slug, { config, expiresAt: now + CACHE_TTL_MS })

  return config
}

/**
 * Defensive parse of the Agent.promptSections Json column: accept only a
 * flat string→string map; anything else degrades to null (systemPrompt
 * fallback — the section simply doesn't render).
 */
function parsePromptSections(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Flush all cached agent configs. Useful after admin updates agent settings.
 */
export function flushAgentConfigCache(): void {
  cache.clear()
}
