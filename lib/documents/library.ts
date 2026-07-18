/**
 * Customer document library (T25, P5.5) — ONE query surface returning every
 * artifact the customer holds, across BOTH families:
 *   - registry Document rows (generated reports/receipts/schedules plus the
 *     static disclosures the customer ACKNOWLEDGED, stamped acknowledgedAt)
 *   - CustomerDocument uploads (id images)
 * Grouped per product where a link exists (productId directly, or through
 * the quote); everything else lands in the ungrouped bucket. The dashboard
 * page stays a thin server component over this.
 */
import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'

type Db = typeof prisma | Prisma.TransactionClient

export interface LibraryItem {
  id: string
  family: 'registry' | 'upload'
  kind: string
  version: number | null
  language: string | null
  createdAt: Date
  /** set on registry disclosures the customer acknowledged */
  acknowledgedAt: Date | null
  /** serving route (open in viewer / download) */
  url: string
}

export interface LibraryGroup {
  productId: string
  productName: Record<string, string> | null
  items: LibraryItem[]
}

export interface CustomerDocumentLibrary {
  groups: LibraryGroup[]
  ungrouped: LibraryItem[]
}

export async function listCustomerDocuments(
  customerId: string,
  db: Db = prisma,
): Promise<CustomerDocumentLibrary> {
  const [owned, acks, uploads] = await Promise.all([
    db.document.findMany({ where: { customerId }, orderBy: { generatedAt: 'desc' } }),
    db.disclosureAck.findMany({ where: { customerId }, orderBy: { acknowledgedAt: 'desc' } }),
    db.customerDocument.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } }),
  ])

  // acknowledged static disclosures live as unkeyed registry rows — pull the
  // referenced documents (deduped; first ack per document wins = latest)
  const ackByDocId = new Map<string, Date>()
  for (const a of acks) if (!ackByDocId.has(a.documentId)) ackByDocId.set(a.documentId, a.acknowledgedAt)
  const ownedIds = new Set(owned.map((d) => d.id))
  const ackedDocIds = [...ackByDocId.keys()].filter((id) => !ownedIds.has(id))
  const ackedDocs = ackedDocIds.length > 0
    ? await db.document.findMany({ where: { id: { in: ackedDocIds } } })
    : []

  const registryDocs = [...owned, ...ackedDocs]

  // product resolution: productId directly, else through the quote link
  const quoteIds = [...new Set(registryDocs.map((d) => d.quoteId).filter((q): q is string => q !== null))]
  const quotes = quoteIds.length > 0
    ? await db.quote.findMany({ where: { id: { in: quoteIds } }, select: { id: true, productId: true } })
    : []
  const productIdByQuote = new Map(quotes.map((q) => [q.id, q.productId]))

  const productIdFor = (d: (typeof registryDocs)[number]): string | null =>
    d.productId ?? (d.quoteId ? productIdByQuote.get(d.quoteId) ?? null : null)

  const productIds = [...new Set(registryDocs.map(productIdFor).filter((p): p is string => p !== null))]
  const products = productIds.length > 0
    ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
    : []
  const productNameById = new Map(products.map((p) => [p.id, p.name as Record<string, string> | null]))

  const groups = new Map<string, LibraryGroup>()
  const ungrouped: LibraryItem[] = []

  const place = (productId: string | null, item: LibraryItem) => {
    if (!productId) {
      ungrouped.push(item)
      return
    }
    const group = groups.get(productId) ?? { productId, productName: productNameById.get(productId) ?? null, items: [] }
    group.items.push(item)
    groups.set(productId, group)
  }

  for (const d of registryDocs) {
    place(productIdFor(d), {
      id: d.id,
      family: 'registry',
      kind: d.kind,
      version: d.version,
      language: d.language,
      createdAt: d.generatedAt,
      acknowledgedAt: ackByDocId.get(d.id) ?? null,
      url: `/api/documents/${d.id}`,
    })
  }
  for (const u of uploads) {
    place(null, {
      id: u.id,
      family: 'upload',
      kind: u.kind,
      version: null,
      language: u.language,
      createdAt: u.createdAt,
      acknowledgedAt: null,
      url: `/api/documents/uploads/${u.id}`,
    })
  }

  const byNewest = (a: LibraryItem, b: LibraryItem) => b.createdAt.getTime() - a.createdAt.getTime()
  for (const g of groups.values()) g.items.sort(byNewest)
  ungrouped.sort(byNewest)

  return { groups: [...groups.values()], ungrouped }
}
