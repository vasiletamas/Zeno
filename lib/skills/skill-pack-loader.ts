import { prisma } from '@/lib/db'
import { LRUCache } from '@/lib/cache/lru-cache'
import { logWarn } from '@/lib/errors/logger'

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
// PACK_WRITABLE_KEYS — packs may ONLY write keys in this set
// ============================================================
// Inverted from the old CONSTITUTION_KEYS approach: instead of listing
// what packs cannot write, list what they CAN. Anything else is reserved
// for system loaders backed by real DB state. See
// docs/superpowers/specs/2026-05-20-zeno-skill-pack-contract-design.md.

export const PACK_WRITABLE_KEYS = new Set(['domainGuidance'])

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

/**
 * Merge skill pack contributions into the base prompt sections.
 *
 * Packs can ONLY write keys listed in PACK_WRITABLE_KEYS. Any other key
 * appearing in a pack's promptSections is logged as a warning and
 * ignored (defense-in-depth: pack rows from before the contract change
 * are stripped at load time instead of leaking into the prompt).
 *
 * Pack constraints are appended to the base constraints (preserved
 * behavior). Higher-priority packs claim a writable key first.
 */
export function mergeSkillPackSections(
  baseSections: Record<string, string | null>,
  packs: SkillPack[],
): Record<string, string | null> {
  if (packs.length === 0) return baseSections

  const merged: Record<string, string | null> = { ...baseSections }
  const claimed = new Set<string>()
  const packConstraints: string[] = []

  for (const pack of packs) {
    for (const [key, value] of Object.entries(pack.promptSections ?? {})) {
      if (!PACK_WRITABLE_KEYS.has(key)) {
        logWarn({
          layer: 'orchestrator',
          category: 'skillpack_section_rejected',
          message: `skill pack '${pack.slug}' attempted to write reserved key '${key}' — ignored`,
          context: { packSlug: pack.slug, key },
        })
        continue
      }
      if (claimed.has(key)) continue
      merged[key] = value
      claimed.add(key)
    }

    if (pack.constraints) {
      packConstraints.push(pack.constraints)
    }
  }

  if (packConstraints.length > 0) {
    const base = merged.constraints ?? ''
    merged.constraints = [base, ...packConstraints].filter(Boolean).join('\n')
  }

  return merged
}

// ============================================================
// validatePackPromptSections — for save-time validation
// ============================================================

/**
 * Returns { valid, invalidKeys } for a candidate pack's promptSections.
 * Used by the admin endpoint that creates/updates pack rows.
 */
export function validatePackPromptSections(
  sections: Record<string, unknown>,
): { valid: boolean; invalidKeys: string[] } {
  const invalidKeys = Object.keys(sections).filter((k) => !PACK_WRITABLE_KEYS.has(k))
  return { valid: invalidKeys.length === 0, invalidKeys }
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
