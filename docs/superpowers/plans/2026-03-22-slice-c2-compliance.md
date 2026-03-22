# Slice C2: Compliance Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate IDD-compliant DNT suitability report PDFs, encrypt CNP with AES-256-GCM, verify GDPR consents, and provide data deletion for right to erasure.

**Architecture:** Encryption utilities + compliance modules + API endpoints. PDF generation via jspdf. Encryption integrated into existing tool handlers. Consent check added to quote generation flow.

**Tech Stack:** jspdf + jspdf-autotable, Node.js crypto (AES-256-GCM), Prisma

**Spec:** `docs/superpowers/specs/2026-03-22-slice-c2-compliance-design.md`

---

## File Map

| File | Type | Responsibility |
|------|------|---------------|
| `lib/security/encryption.ts` | New | AES-256-GCM encrypt/decrypt/maskCnp |
| `lib/compliance/dnt-report.ts` | New | Generate DNT suitability report PDF |
| `lib/compliance/consent-check.ts` | New | Verify GDPR consents exist |
| `app/api/documents/dnt-report/[policyId]/route.ts` | New | PDF download (authenticated) |
| `app/api/gdpr/delete-data/route.ts` | New | GDPR data deletion endpoint |
| `prisma/schema.prisma` | Modified | CNP encryption fields, Policy.suitabilityReportPath |
| `lib/tools/handlers/data-handlers.ts` | Modified | Encrypt CNP on collect |
| `lib/tools/handlers/quote-handlers.ts` | Modified | Consent check before quote |
| `lib/payments/post-payment.ts` | Modified | Trigger PDF generation |
| `components/dashboard/document-list.tsx` | Modified | Link to real PDF |
| `.env.example` | Modified | ENCRYPTION_KEY, REPORTS_PATH |

---

## Task 1: Schema + Encryption + Dependencies

- [ ] **Step 1: Install deps**
```bash
npm install jspdf jspdf-autotable
```

- [ ] **Step 2: Schema changes**
In `prisma/schema.prisma`:
- Customer: replace `cnp String?` with `cnpEncrypted String?`, `cnpIv String?`, `cnpTag String?`
- Policy: add `suitabilityReportPath String?`
- Push + generate

- [ ] **Step 3: Create encryption module**
`lib/security/encryption.ts` with encrypt, decrypt, maskCnp functions per spec Section 5.

- [ ] **Step 4: Update data-handlers.ts**
When field='cnp': encrypt value, save to cnpEncrypted/cnpIv/cnpTag instead of cnp.

- [ ] **Step 5: Update .env.example**
Add ENCRYPTION_KEY and REPORTS_PATH.

- [ ] **Step 6: Verify + commit**

---

## Task 2: DNT Report PDF + Consent Check

- [ ] **Step 1: Create consent-check.ts**
`lib/compliance/consent-check.ts`: verify DNT consents + signed status.

- [ ] **Step 2: Update quote handler**
In `lib/tools/handlers/quote-handlers.ts` generateQuote: call verifyConsents() before generating. Block if missing.

- [ ] **Step 3: Create dnt-report.ts**
`lib/compliance/dnt-report.ts`: generate full PDF using jspdf. Load all data (policy, customer, answers, coverages, signing metadata). Save to filesystem.

Read spec Section 6 for exact report structure (Romanian text, tables, legal disclaimer).

- [ ] **Step 4: Update post-payment flow**
In `lib/payments/post-payment.ts`: after payment confirmed, call generateDntReport(). Save path to Policy.suitabilityReportPath. Try/catch — don't block payment on PDF failure.

- [ ] **Step 5: Verify + commit**

---

## Task 3: API Endpoints + Dashboard Integration

- [ ] **Step 1: PDF download endpoint**
`app/api/documents/dnt-report/[policyId]/route.ts`: authenticated GET, serves PDF file.

- [ ] **Step 2: GDPR deletion endpoint**
`app/api/gdpr/delete-data/route.ts`: authenticated DELETE, anonymizes PII per spec Section 8.

- [ ] **Step 3: Update dashboard document list**
Link DNT report to real download endpoint when suitabilityReportPath exists.

- [ ] **Step 4: Verify + commit**

---

## Task 4: Final Verification

- [ ] **Step 1:** `npx tsc --noEmit`
- [ ] **Step 2:** `npm run build`
- [ ] **Step 3:** `npx vitest run` (84 unit tests)
- [ ] **Step 4:** Re-seed DB
- [ ] **Step 5:** Final commit

---

## Notes

1. **ENCRYPTION_KEY:** Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. **jspdf in Node.js:** Use `const { jsPDF } = require('jspdf')` or configure for ESM. May need `jspdf-autotable` imported for side effects.
3. **PDF filesystem:** Create `REPORTS_PATH` directory if it doesn't exist. Default `./tmp/reports`.
4. **CNP migration:** If any existing test data has plain cnp values, they'll be lost (null). Re-seed after schema change.
5. **Report path:** Store relative path on Policy. Resolve to absolute at serve time.
