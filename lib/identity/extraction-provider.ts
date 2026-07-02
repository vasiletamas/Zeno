/**
 * Document extraction provider seam (B3.7) — provider-pluggable per T4-R3:
 * extraction is OCR, not a decision; every judgement (checksum, expiry,
 * declared-vs-extracted) is made deterministically by the pipeline. A real
 * eKYC provider slots in via DOCUMENT_EXTRACTION_PROVIDER; the default mock
 * returns the fixture set by tests.
 */

export interface ExtractedIdFields {
  name?: string
  cnp?: string
  dateOfBirth?: string
  expiryDate?: string
}

export interface DocumentExtractionProvider {
  extract(data: Buffer, kind: 'id_card'): Promise<ExtractedIdFields>
}

let mockFixture: ExtractedIdFields = {}

/** Test seam: the next MockExtractionProvider.extract returns these fields. */
export function setMockExtraction(fields: ExtractedIdFields): void {
  mockFixture = fields
}

export class MockExtractionProvider implements DocumentExtractionProvider {
  async extract(_data: Buffer, _kind: 'id_card'): Promise<ExtractedIdFields> {
    return mockFixture
  }
}

export function getExtractionProvider(): DocumentExtractionProvider {
  const name = (process.env.DOCUMENT_EXTRACTION_PROVIDER ?? 'mock').toLowerCase()
  if (name === 'mock') return new MockExtractionProvider()
  throw new Error(`Unknown document extraction provider: "${name}". Valid options: mock`)
}
