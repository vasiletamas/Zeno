# Slice C2: Compliance — PDF + GDPR — Design Spec

**Project:** Zeno — AI Life Insurance Sales Agent V2
**Slice:** C2 (DNT Suitability Report PDF, GDPR Encryption + Consent + Deletion)
**Date:** 2026-03-22
**Status:** Approved
**Depends on:** Phase B (complete), C1 (E2E tests)

---

## 1. Goal

Generate IDD-compliant DNT suitability report PDFs for every completed sale, encrypt CNP at application level (AES-256-GCM), verify GDPR consents before quote generation, and provide a data deletion endpoint for right to erasure.

## 2. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| PDF library | jspdf + jspdf-autotable | Lightweight, server-side, perfect for structured reports. No Chrome binary needed. |
| CNP encryption | AES-256-GCM via Node.js crypto | Standard, auditable. Explicit encrypt/decrypt calls (no magic middleware). |
| What gets encrypted | CNP only | Most sensitive PII (national identifier). Other fields stay plain for search/display. |
| Data deletion | Anonymize PII, retain business records | GDPR right to erasure. Policies/payments kept (legal/financial requirement). |
| Consent check | Explicit verification before quote | Safety layer on top of DNT questionnaire flow. |

## 3. Schema Changes

**Customer model — replace cnp with encrypted fields:**
```prisma
// Remove:  cnp String?
// Add:
cnpEncrypted String?
cnpIv        String?
cnpTag       String?
```

**Policy model — add:**
```prisma
suitabilityReportPath String?
```

## 4. File Structure

```
lib/security/
  encryption.ts              — AES-256-GCM encrypt/decrypt utilities

lib/compliance/
  dnt-report.ts              — Generate DNT suitability report PDF
  consent-check.ts           — Verify GDPR consents exist

app/api/
  documents/
    dnt-report/[policyId]/route.ts — GET: serve PDF download (authenticated)
  gdpr/
    delete-data/route.ts     — DELETE: anonymize customer PII
```

## 5. PII Encryption

### `lib/security/encryption.ts`

```typescript
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const TAG_LENGTH = 16

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key || key.length !== 64) throw new Error('ENCRYPTION_KEY must be a 64-char hex string (32 bytes)')
  return Buffer.from(key, 'hex')
}

export function encrypt(plaintext: string): { encrypted: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag().toString('hex')
  return { encrypted, iv: iv.toString('hex'), tag }
}

export function decrypt(encrypted: string, iv: string, tag: string): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, 'hex'))
  decipher.setAuthTag(Buffer.from(tag, 'hex'))
  let plaintext = decipher.update(encrypted, 'hex', 'utf8')
  plaintext += decipher.final('utf8')
  return plaintext
}

// Mask CNP for display: 1880****3456
export function maskCnp(cnp: string): string {
  if (cnp.length !== 13) return '***'
  return cnp.slice(0, 4) + '*'.repeat(6) + cnp.slice(10)
}
```

**Where encryption is called:**
- `collect_customer_field` handler (data-handlers.ts): when field='cnp', encrypt before saving
- `dnt-report.ts`: decrypt for PDF (display masked)
- Admin application detail: decrypt for display (full for ADMIN, masked for OPERATOR)

## 6. DNT Suitability Report PDF

### `lib/compliance/dnt-report.ts`

```typescript
import jsPDF from 'jspdf'
import 'jspdf-autotable'

export async function generateDntReport(policyId: string): Promise<Buffer>
```

**Report structure:**

Page 1: Header + Customer Data
```
═══════════════════════════════════════════
RAPORT DE SUITABILITATE (DNT)
Conform Directivei (UE) 2016/97 privind
distribuția de asigurări (IDD)
═══════════════════════════════════════════

Număr raport: DNT-{policyId-short}-{date}
Data generării: {date in Romanian format}
Agent: Zeno (sistem automatizat)
Asigurător: Allianz-Țiriac Asigurări S.A.

DATELE CLIENTULUI
─────────────────
Nume: {name}
CNP: {masked CNP}
Data nașterii: {DOB}
Adresa: {address}
Email: {email}
Telefon: {phone}
```

Page 2+: DNT Questionnaire Answers (table format)
```
ANALIZA NEVOILOR ȘI CERINȚELOR (DNT)
─────────────────────────────────────

Secțiunea: Consimțământ
┌───────────────────────────┬──────────┐
│ Întrebare                 │ Răspuns  │
├───────────────────────────┼──────────┤
│ Consultanță pentru toate  │ Da       │
│ produsele                 │          │
│ Comunicări marketing      │ Nu       │
│ Corespondență electronică │ Da       │
└───────────────────────────┴──────────┘

Secțiunea: Informații generale
... (all groups with all answers)
```

Page 3+: Product Recommendation + Coverage
```
RECOMANDAREA PRODUSULUI
──────────────────────
Produs recomandat: Protect Standard Nivelul II
Addon: Tratament Medical în Străinătate (BD)

Motivare: Pe baza analizei nevoilor clientului
(venitul familiei, număr de dependenți, preferința
pentru protecție simplă cu acoperire de accidente),
produsul Protect Standard Nivelul II oferă cel mai
bun raport între acoperire și cost.

ACOPERIRI INCLUSE
┌───────────────────────────┬──────────────┐
│ Acoperire                 │ Sumă         │
├───────────────────────────┼──────────────┤
│ Deces din orice cauză     │ 40.000 RON   │
│ Invaliditate permanentă   │ 10.000 RON   │
│ Intervenție chirurgicală  │ 4.000 RON    │
│ Spitalizare               │ 20 RON/zi    │
│ Tratament străinătate     │ 2.000.000 EUR│
│ Spitalizare străinătate   │ 100 EUR/zi   │
│ Medicație post-tratament  │ 50.000 EUR   │
└───────────────────────────┴──────────────┘

PRIMA DE ASIGURARE
Prima anuală: 490 RON (290 bază + 200 addon BD)
Prima lunară: 40.83 RON
Frecvența plății: Anuală
```

Last page: Signatures + Legal
```
CONFIRMAREA CLIENTULUI
─────────────────────
Clientul a confirmat semnătura electronică: Da
Consimțământ GDPR: Da
Data semnării: {date}
Validitate: {date + 1 year}

DISCLAIMER LEGAL
────────────────
Acest raport a fost generat automat de sistemul
Zeno în conformitate cu cerințele Directivei IDD
(UE) 2016/97 și reglementările ASF.

Distribuitor: {company name}
Agent de asigurare pentru Allianz-Țiriac Asigurări S.A.
```

**Data loading:**
1. Load Policy with Quote, Application, Customer
2. Load all Answers for the conversation, joined with Questions (for text + group)
3. Load CoverageAmounts for the quote's tier/level
4. Decrypt CNP for masked display
5. Load WorkflowSession.data for signing metadata

**PDF output:** Returns a `Buffer` (Node.js). Saved to filesystem at `REPORTS_PATH/{policyId}.pdf`.

**When generated:**
- Called from `runPostPaymentFlow()` after payment confirmed
- Also callable on-demand from admin panel (regenerate)
- Triggered when Policy status changes to ACTIVE (operator action)

## 7. Consent Verification

### `lib/compliance/consent-check.ts`

```typescript
export async function verifyConsents(conversationId: string): Promise<{
  valid: boolean
  missing: string[]
}>
```

Checks existence of answers for these question codes:
- `DNT_CONSULTATION_CONSENT` — must exist
- `DNT_ELECTRONIC_COMMUNICATION` — must exist
- `DNT_MARKETING_CONSENT` — must exist (value can be true or false)

Also checks that DNT is signed (WorkflowSession.data.dntSignedAt exists).

**Called from:** `generateQuote` handler in `lib/tools/handlers/quote-handlers.ts`. If consents are missing, quote generation is blocked with an error message.

## 8. Data Deletion Endpoint

### `DELETE /api/gdpr/delete-data`

```typescript
Body: { customerId: string, confirmDeletion: true }
Auth: CUSTOMER (own data only) or ADMIN (any customer)
```

Flow:
1. Verify auth + confirm customerId matches session (for CUSTOMER role)
2. Require `confirmDeletion === true`
3. Anonymize Customer:
   - Set: name=null, email=null, phone=null, cnpEncrypted=null, cnpIv=null, cnpTag=null
   - Set: address=null, extractedProfile=null, dateOfBirth=null
   - Set: isAnonymous=true, magicLinkToken=null
4. Delete all Answers where conversationId in customer's conversations
5. Anonymize user Messages: update content to "[Deleted per GDPR request]" for role='user'
6. Deactivate User: set isActive=false
7. Log: timestamp, requestedBy, customerId, what was deleted (console for now)
8. Return: `{ success: true, deletedFields: [...], retainedRecords: [...] }`

**Retained (legal/financial requirement):**
- Conversation records (audit trail, anonymized)
- Policy records (legal obligation)
- Payment records (financial records)
- TurnTrace records (operational, no PII)
- Assistant messages (agent's responses, no customer PII)

## 9. PDF Download Endpoint

### `GET /api/documents/dnt-report/[policyId]`

Auth: CUSTOMER (own policy only) or ADMIN/OPERATOR (any policy).

1. Load Policy, verify auth
2. Check `suitabilityReportPath` exists
3. Read file from filesystem
4. Return as `application/pdf` with `Content-Disposition: attachment; filename="raport-dnt-{policyId}.pdf"`

If report doesn't exist yet: return 404 with message "Report not yet generated."

## 10. Integration Changes

**`lib/payments/post-payment.ts`:**
- After payment confirmed + policy status updated
- Call `generateDntReport(policyId)` → save PDF → update Policy.suitabilityReportPath
- Wrap in try/catch — PDF failure should not block payment completion (log error, continue)

**`lib/tools/handlers/quote-handlers.ts` (generateQuote):**
- Before generating quote: call `verifyConsents(conversationId)`
- If missing consents: return error `{ success: false, error: 'GDPR consents required before quote generation' }`

**`lib/tools/handlers/data-handlers.ts` (collectCustomerField):**
- When field='cnp': encrypt value before saving to Customer
- Save cnpEncrypted, cnpIv, cnpTag instead of plain cnp

**`app/admin/applications/[id]/client.tsx`:**
- Decrypt CNP for display (call a server action or API to decrypt)
- ADMIN sees full CNP, OPERATOR sees masked (first 4 + last 3)

**`components/dashboard/document-list.tsx`:**
- "Polita PDF" → placeholder (no policy PDF yet)
- "Raport suitabilitate (DNT)" → link to `/api/documents/dnt-report/{policyId}` if suitabilityReportPath exists
- "Chitanta plata" → placeholder

## 11. New Dependencies

```bash
npm install jspdf jspdf-autotable
npm install -D @types/jspdf
```

## 12. Environment Variables

```
ENCRYPTION_KEY=your-64-character-hex-string-representing-32-bytes
REPORTS_PATH=./tmp/reports
```

## 13. Exit Criteria

- [ ] AES-256-GCM encryption module with encrypt/decrypt/maskCnp
- [ ] CNP encrypted in DB (cnpEncrypted, cnpIv, cnpTag fields)
- [ ] collect_customer_field encrypts CNP before saving
- [ ] DNT suitability report PDF generated for completed sales
- [ ] PDF contains: customer data, all DNT answers, product recommendation, coverages, signatures, legal disclaimer
- [ ] PDF saved to filesystem, path on Policy.suitabilityReportPath
- [ ] PDF download endpoint (authenticated)
- [ ] Dashboard documents section links to real PDF
- [ ] Consent verification before quote generation
- [ ] GDPR deletion endpoint anonymizes PII, retains business records
- [ ] Admin panel shows decrypted CNP (masked for OPERATOR)
- [ ] Post-payment flow triggers PDF generation
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds

## 14. What C2 does NOT include

- Policy PDF (separate document from DNT report — not required for IDD)
- Email attachment of PDF (linked from dashboard)
- GDPR audit log table (console logging for now)
- Cookie consent banner (no tracking cookies)
- Data portability/export endpoint
- CNP validation against Romanian algorithm (pattern check is sufficient)
