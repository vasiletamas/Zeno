/**
 * Document pipeline (B3.7): extract → DETERMINISTIC validation → provenance
 * flips. Extraction is not a decision — expiry, CNP checksum, and
 * declared-vs-extracted matching are pure checks; matches flip fields to
 * verified (emitting mutation events for the C1 planner), mismatches
 * surface as conflicts, and any finding queues a DOCUMENT_REVIEW WorkItem
 * (E2 queue) instead of silently passing.
 */
import { prisma } from '@/lib/db'
import { validateCnpChecksum } from '@/lib/engines/cnp-validation'
import { setVerifiedField, type ProfileFieldName } from '@/lib/customer/profile-service'
import { createWorkItem } from '@/lib/work-items/service'
import { getExtractionProvider, type DocumentExtractionProvider } from './extraction-provider'

export interface FieldVerifiedEvent {
  customerId: string
  field: string
  value: string
}

export interface ProcessResult {
  status: 'validated' | 'review'
  findings: string[]
  verifiedFields: string[]
}

const COMPARED_FIELDS = ['name', 'cnp', 'dateOfBirth'] as const satisfies readonly ProfileFieldName[]

export async function processDocument(
  documentId: string,
  opts: { onFieldVerified: (e: FieldVerifiedEvent) => void; provider?: DocumentExtractionProvider },
): Promise<ProcessResult> {
  const doc = await prisma.customerDocument.findUniqueOrThrow({ where: { id: documentId } })
  const provider = opts.provider ?? getExtractionProvider()

  // Extraction. The mock ignores the payload; when a real eKYC provider
  // lands it receives the decrypted image here (images are AES-GCM at rest
  // and NEVER leave this module — T14.D5).
  const extracted = await provider.extract(doc.encryptedData as Buffer, doc.kind)
  await prisma.customerDocument.update({
    where: { id: doc.id },
    data: { status: 'extracted', extractedFields: extracted as object },
  })

  const findings: string[] = []
  const verifiedFields: string[] = []

  // deterministic document-level checks
  if (extracted.expiryDate && new Date(extracted.expiryDate).getTime() <= Date.now()) {
    findings.push('document_expired')
  }
  const cnpValid = extracted.cnp !== undefined && validateCnpChecksum(extracted.cnp)
  if (extracted.cnp !== undefined && !cnpValid) {
    findings.push('cnp_checksum_invalid')
  }

  // per-field declared-vs-extracted via the provenance rules: normalized
  // match → verified, mismatch → conflict (both values kept)
  for (const field of COMPARED_FIELDS) {
    const value = extracted[field]
    if (value === undefined) continue
    if (field === 'cnp' && !cnpValid) continue // never write a garbage extraction
    const w = await setVerifiedField(doc.customerId, field, value, 'document_extraction', doc.id)
    if (w.outcome === 'applied' && w.provenance === 'verified') {
      verifiedFields.push(field)
      opts.onFieldVerified({ customerId: doc.customerId, field, value })
    } else {
      findings.push(`field_mismatch:${field}`)
    }
  }

  if (findings.length > 0) {
    await prisma.customerDocument.update({
      where: { id: doc.id },
      data: { status: 'review', validationFindings: findings, verifiedFields },
    })
    await createWorkItem({
      kind: 'DOCUMENT_REVIEW',
      reason: findings.join(','),
      refs: { customerId: doc.customerId, customerDocumentId: doc.id } as { customerId: string },
      createdBy: 'system',
    })
    return { status: 'review', findings, verifiedFields }
  }

  await prisma.customerDocument.update({
    where: { id: doc.id },
    data: { status: 'validated', validationFindings: [], verifiedFields },
  })
  return { status: 'validated', findings, verifiedFields }
}
