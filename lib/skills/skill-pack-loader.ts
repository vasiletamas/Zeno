import { prisma } from '@/lib/db'
import { LRUCache } from '@/lib/cache/lru-cache'

// ============================================================
// TYPES
// ============================================================

export interface SkillPack {
  id: string
  slug: string
  name: string
  category: string
  description: string
  promptSections: Record<string, string>
  allowedTools: string[]
  constraints: string | null
  flags: Record<string, unknown> | null
  isActive: boolean
  priority: number
  createdAt: Date
  updatedAt: Date
}

// ============================================================
// CONSTITUTION KEYS — never overridden by skill packs
// ============================================================

const CONSTITUTION_KEYS = new Set(['agentIdentity', 'constraints', 'capabilityManifest'])

// ============================================================
// CACHE — 5-minute TTL, up to 100 entries
// ============================================================

const FIVE_MINUTES_MS = 5 * 60 * 1000

const skillPackCache = new LRUCache<string, SkillPack>(100, FIVE_MINUTES_MS)

// ============================================================
// getSkillPack
// ============================================================

export async function getSkillPack(slug: string): Promise<SkillPack> {
  const cached = skillPackCache.get(slug)
  if (cached !== undefined) return cached

  const pack = await prisma.skillPack.findUnique({
    where: { slug },
  })

  if (pack === null) {
    throw new Error(`SkillPack ${slug} not found`)
  }

  if (!pack.isActive) {
    throw new Error(`SkillPack ${slug} is inactive`)
  }

  const result = pack as unknown as SkillPack
  skillPackCache.set(slug, result)
  return result
}

// ============================================================
// getActiveSkillPacks
// ============================================================

export async function getActiveSkillPacks(slugs: string[]): Promise<SkillPack[]> {
  if (slugs.length === 0) return []

  const packs = await prisma.skillPack.findMany({
    where: { slug: { in: slugs } },
  })

  return (packs as unknown as SkillPack[])
    .filter((p) => p.isActive)
    .sort((a, b) => b.priority - a.priority)
}

// ============================================================
// mergeSkillPackSections
// ============================================================

export function mergeSkillPackSections(
  baseSections: Record<string, string | null>,
  packs: SkillPack[],
): Record<string, string | null> {
  if (packs.length === 0) return baseSections

  const merged: Record<string, string | null> = { ...baseSections }

  // Track which non-constitution keys have been claimed (first/highest-priority pack wins)
  const claimed = new Set<string>()

  // Collect all pack constraints to append
  const packConstraints: string[] = []

  for (const pack of packs) {
    // Merge promptSections — skip constitution keys, first pack wins on conflict
    for (const [key, value] of Object.entries(pack.promptSections ?? {})) {
      if (CONSTITUTION_KEYS.has(key)) continue
      if (claimed.has(key)) continue
      merged[key] = value
      claimed.add(key)
    }

    // Collect constraints for appending
    if (pack.constraints) {
      packConstraints.push(pack.constraints)
    }
  }

  // Append pack constraints to base constraints (never replace)
  if (packConstraints.length > 0) {
    const base = merged.constraints ?? ''
    const parts = [base, ...packConstraints].filter(Boolean)
    merged.constraints = parts.join('\n')
  }

  return merged
}

// ============================================================
// computeAllowedTools
// ============================================================

/**
 * Compute the set of tools available to the LLM for this turn.
 *
 * Returns the UNION of workflow-step tools and all tools allowed by active
 * skill packs. Duplicates are removed. Workflow tools come first, then pack
 * tools in pack order.
 *
 * Previous behaviour was intersection, which zeroed out pack tools whenever
 * workflow tools were empty (pre-workflow conversations). The union semantics
 * align with subsystem D: default discovery tools are baseline, workflow and
 * packs add to that.
 */
export function computeAllowedTools(
  workflowStepTools: string[],
  packs: SkillPack[],
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const t of workflowStepTools) {
    if (!seen.has(t)) {
      seen.add(t)
      result.push(t)
    }
  }
  for (const pack of packs) {
    for (const t of pack.allowedTools) {
      if (!seen.has(t)) {
        seen.add(t)
        result.push(t)
      }
    }
  }
  return result
}

// ============================================================
// flushSkillPackCache
// ============================================================

export function flushSkillPackCache(): void {
  skillPackCache.clear()
}
