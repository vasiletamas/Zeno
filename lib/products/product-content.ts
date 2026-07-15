/**
 * ProductContent publish workflow + published-content reader (E1.3, T11.D2).
 *
 * Publishing is content GOVERNANCE, not a per-conversation funnel commit —
 * it does not route through the commit gateway; its audit trail is the row
 * itself (authoredBy/approvedBy/publishedAt/retiredAt). The publish gate
 * enforces locale completeness and the no-numerals rule (E1.2) so a partial
 * or numeral-carrying version can never become the agent's claim source.
 *
 * Erratum 6 (T11 risk pin): publish invalidates ALL product-content caches —
 * this module's read cache AND the prompt-side productContext /
 * coachingBriefing / catalogOverview caches in lib/chat/context-loaders.ts;
 * a compliance retraction must never keep serving retired claims until a
 * TTL expires.
 */
import { prisma } from '@/lib/db'
import type { ProductContentField } from '@/lib/generated/prisma/client'
import {
  validateContentSet,
  resolveCoveragePlaceholders,
  type AuthoredLocale,
} from '@/lib/products/authored-content-validation'

/**
 * Erratum 6 hook: downstream caches (context-loaders' productContext /
 * coachingBriefing / catalogOverview) register a flush callback at module
 * init; publish calls every hook. Registration-over-import keeps this
 * module free of a circular dependency on the prompt layer — and a cache
 * that was never loaded has nothing to flush.
 */
const publishFlushHooks: Array<() => void> = []
export function registerPublishFlushHook(hook: () => void): void {
  publishFlushHooks.push(hook)
}

export interface PublishInput { productId: string; addonId: string | null; field: ProductContentField; version: number; approvedBy: string }
export type PublishResult =
  | { outcome: 'applied'; publishedIds: string[] }
  | { outcome: 'rejected'; reason: 'missing_locale' | 'numerals_in_authored_content' | 'content_not_found'; params?: Record<string, unknown> }

export interface PublishedFieldSet { version: number; contentIds: string[]; ro: unknown; en: unknown }
export interface PublishedProductContent {
  fields: Partial<Record<ProductContentField, PublishedFieldSet>>
  addonFields: Record<string, Partial<Record<ProductContentField, PublishedFieldSet>>>
}

const cache = new Map<string, PublishedProductContent>()
export function invalidateProductContentCache(productId?: string): void {
  if (productId) cache.delete(productId)
  else cache.clear()
}

export async function publishProductContent(input: PublishInput): Promise<PublishResult> {
  const drafts = await prisma.productContent.findMany({
    where: { productId: input.productId, addonId: input.addonId, field: input.field, version: input.version, status: 'DRAFT' },
  })
  if (drafts.length === 0) return { outcome: 'rejected', reason: 'content_not_found' }
  const verdict = validateContentSet(drafts.map((d) => ({
    field: d.field, addonCode: d.addonId, locale: d.locale as AuthoredLocale, content: d.content,
  })))
  if (!verdict.ok) return { outcome: 'rejected', reason: verdict.reason, params: verdict.params }
  await prisma.$transaction([
    prisma.productContent.updateMany({
      where: { productId: input.productId, addonId: input.addonId, field: input.field, status: 'PUBLISHED' },
      data: { status: 'RETIRED', retiredAt: new Date() },
    }),
    prisma.productContent.updateMany({
      where: { id: { in: drafts.map((d) => d.id) } },
      data: { status: 'PUBLISHED', approvedBy: input.approvedBy, publishedAt: new Date() },
    }),
  ])
  invalidateProductContentCache(input.productId)
  for (const hook of publishFlushHooks) hook()
  return { outcome: 'applied', publishedIds: drafts.map((d) => d.id) }
}

export async function getPublishedProductContent(productId: string): Promise<PublishedProductContent> {
  const cached = cache.get(productId)
  if (cached) return cached
  const rows = await prisma.productContent.findMany({ where: { productId, status: 'PUBLISHED' } })
  const coverage = await loadCoverageByCode(productId)
  const out: PublishedProductContent = { fields: {}, addonFields: {} }
  for (const row of rows) {
    const bucket = row.addonId ? (out.addonFields[row.addonId] ??= {}) : out.fields
    const set = (bucket[row.field] ??= { version: row.version, contentIds: [], ro: null, en: null })
    set.contentIds.push(row.id)
    const rendered = renderContent(row.content, coverage, row.locale as AuthoredLocale)
    if (row.locale === 'ro') set.ro = rendered
    else set.en = rendered
  }
  cache.set(productId, out)
  return out
}

/** Every published contentId across product AND addon field sets (M8 stamps). */
export function collectPublishedContentIds(published: PublishedProductContent): string[] {
  const ids: string[] = []
  for (const set of Object.values(published.fields)) ids.push(...set.contentIds)
  for (const addonFields of Object.values(published.addonFields)) {
    for (const set of Object.values(addonFields)) ids.push(...set.contentIds)
  }
  return ids
}

/** Placeholders resolve in strings AND string arrays (key points are lists). */
function renderContent(content: unknown, coverage: Record<string, { amount: number; currency: string }>, locale: AuthoredLocale): unknown {
  if (typeof content === 'string') return resolveCoveragePlaceholders(content, coverage, locale)
  if (Array.isArray(content)) return content.map((c) => renderContent(c, coverage, locale))
  return content
}

async function loadCoverageByCode(productId: string): Promise<Record<string, { amount: number; currency: string }>> {
  const amounts = await prisma.coverageAmount.findMany({
    where: { OR: [{ pricingLevel: { tier: { productId } } }, { addon: { productId } }] },
    include: { coverageType: { select: { code: true } } },
  })
  const byCode: Record<string, { amount: number; currency: string }> = {}
  for (const a of amounts) {
    const code = a.coverageType.code
    if (!byCode[code] || a.amount > byCode[code].amount) byCode[code] = { amount: a.amount, currency: a.currency }
  }
  return byCode
}
