import { prisma } from '@/lib/db'
import { stripDiacritics, lookupAlias } from '@/lib/products/aliases'

export type MatchedBy = 'id' | 'code-exact' | 'code-normalized' | 'name' | 'alias'

export interface ProductResolveInput {
  productId?: string
  productCode?: string
}

export interface ResolvedProductRef {
  id: string
  code: string
  matchedBy: MatchedBy
}

export interface AvailableProductRef {
  id: string
  code: string
  name: unknown
}

function clean(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export async function resolveProductRef(
  input: ProductResolveInput,
): Promise<ResolvedProductRef | null> {
  const id = clean(input.productId)
  const rawCode = clean(input.productCode)

  if (id) {
    const hit = await prisma.product.findUnique({
      where: { id },
      select: { id: true, code: true },
    })
    if (hit) return { id: hit.id, code: hit.code, matchedBy: 'id' }
  }

  if (rawCode) {
    const exact = await prisma.product.findUnique({
      where: { code: rawCode },
      select: { id: true, code: true },
    })
    if (exact) return { id: exact.id, code: exact.code, matchedBy: 'code-exact' }

    const normalized = rawCode.toLowerCase()
    const ci = await prisma.product.findFirst({
      where: { code: { equals: normalized, mode: 'insensitive' } },
      select: { id: true, code: true },
    })
    if (ci) return { id: ci.id, code: ci.code, matchedBy: 'code-normalized' }

    const byName = await prisma.product.findMany({
      where: {
        OR: [
          { name: { path: ['ro'], string_contains: rawCode } },
          { name: { path: ['en'], string_contains: rawCode } },
        ],
      },
      select: { id: true, code: true },
    })
    if (byName.length === 1) {
      return { id: byName[0].id, code: byName[0].code, matchedBy: 'name' }
    }

    // Diacritic-insensitive code match (e.g. "locuință" -> "locuinta"). Skipped when
    // there are no diacritics, since the case-insensitive match above already covered that.
    const stripped = stripDiacritics(rawCode.toLowerCase())
    if (stripped !== rawCode.toLowerCase()) {
      const dia = await prisma.product.findFirst({
        where: { code: { equals: stripped, mode: 'insensitive' } },
        select: { id: true, code: true },
      })
      if (dia) return { id: dia.id, code: dia.code, matchedBy: 'code-normalized' }
    }

    // Alias fallback (e.g. "home"/"casa" -> property; "viata" -> LIFE)
    const alias = lookupAlias(rawCode)
    if (alias) {
      const byAlias = await prisma.product.findFirst({
        where: { code: { equals: alias.productCode, mode: 'insensitive' } },
        select: { id: true, code: true },
      })
      if (byAlias) return { id: byAlias.id, code: byAlias.code, matchedBy: 'alias' }
    }
  }

  return null
}

export async function listAvailableProductRefs(): Promise<AvailableProductRef[]> {
  return prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  })
}
