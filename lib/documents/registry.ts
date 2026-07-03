/**
 * Document registry (D2, T9.D1 — landed early with C3.6 which registers
 * the quote-keyed suitability report): ONE registry row per stored
 * document — kind/version/language/storageKey/sha256 behind the storage
 * provider, replacing the path-column pattern. D2 seeds IPID/TERMS and
 * wires the disclosure gate; D4 retires suitabilityReportPath.
 */
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { fsStorage } from './storage'
import type { DocumentKind, DocumentSource, Prisma } from '@/lib/generated/prisma/client'

type Db = typeof prisma | Prisma.TransactionClient

export async function createDocument(input: {
  kind: DocumentKind
  language: string
  bytes: Buffer
  source: DocumentSource
  version?: number
  productId?: string
  customerId?: string
  quoteId?: string
  policyId?: string
}, db: Db = prisma) {
  const contentHash = crypto.createHash('sha256').update(input.bytes).digest('hex')
  const version = input.version ?? 1
  const storageKey = `${input.kind}/${input.language}/v${version}/${contentHash.slice(0, 16)}.pdf`
  await fsStorage.put(storageKey, input.bytes)
  return db.document.create({
    data: {
      kind: input.kind, version, language: input.language, storageKey, contentHash,
      source: input.source, productId: input.productId, customerId: input.customerId,
      quoteId: input.quoteId, policyId: input.policyId,
    },
  })
}

export async function getProductDisclosureDocuments(productId: string, language: string) {
  // latest version per kind for the product's static disclosure docs
  const docs = await prisma.document.findMany({ where: { productId, language, kind: { in: ['IPID', 'TERMS'] } }, orderBy: { version: 'desc' } })
  const latest = new Map<string, typeof docs[number]>()
  for (const d of docs) if (!latest.has(d.kind)) latest.set(d.kind, d)
  return [...latest.values()]
}
