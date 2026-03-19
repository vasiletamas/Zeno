# Slice A4: Sales Engine Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all remaining tool handlers, the questionnaire engine, and the quote engine so the agent can sell Protect + BD addon end-to-end via API.

**Architecture:** Two business logic engines (questionnaire, quote) as pure-function modules, plus 8 handler files grouped by domain. Handlers do DB I/O, engines do computation. The existing tool registry and pipeline from A2 wire everything together.

**Tech Stack:** TypeScript, Prisma v7, Vitest, Zod

**Spec:** `docs/superpowers/specs/2026-03-19-slice-a4-sales-engine-design.md`

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `lib/engines/questionnaire-engine.ts` | Conditional Qs, validation, flags, progress (pure functions + DB wrappers) |
| `lib/engines/quote-engine.ts` | Premium calculation (pure function, no DB access) |
| `lib/tools/handlers/dnt-handlers.ts` | check_dnt_status, start_dnt_questionnaire, save_dnt_answer, sign_dnt |
| `lib/tools/handlers/application-handlers.ts` | start_application, save_application_answer, get_application_status, resume_application, cancel_application |
| `lib/tools/handlers/quote-handlers.ts` | generate_quote, get_quote_details, accept_quote, modify_quote |
| `lib/tools/handlers/product-handlers.ts` | compare_products, set_conversation_product |
| `lib/tools/handlers/profile-handlers.ts` | get_customer_profile, update_customer_profile |
| `lib/tools/handlers/objection-handlers.ts` | get_objection_strategy |
| `lib/tools/handlers/bd-handlers.ts` | check_bd_eligibility |
| `lib/tools/handlers/utility-handlers.ts` | escalate_to_human |
| `__tests__/lib/engines/questionnaire-engine.test.ts` | Conditional Qs, validation, flags tests |
| `__tests__/lib/engines/quote-engine.test.ts` | Premium calculation tests |

### Modified files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add Question.code, Application.flagsForReview, Quote payment frequency fields |
| `prisma/seeds/seed-questions.ts` | Persist question codes, remove BD per-question flags |
| `lib/tools/registry.ts` | Replace stubs with real handlers, add cancel_application + modify_quote |
| `lib/tools/validation.ts` | Replace .passthrough() stubs with .strict() schemas |

---

## Task 1: Schema Changes + Seed Updates

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seeds/seed-questions.ts`

- [ ] **Step 1: Add 3 schema changes**

Read `prisma/schema.prisma` and add:

1. Add `code String?` to Question model (after `groupId` field)
2. Add `flagsForReview Json?` to Application model (after `totalQuestions` field)
3. Add `premiumSemiAnnual Float?`, `premiumQuarterly Float?`, `paymentFrequency String?` to Quote model (after `premiumMonthly` field)

- [ ] **Step 2: Push schema**

Run: `npx prisma db push`

- [ ] **Step 3: Update seed-questions.ts to persist question codes**

Read the current `prisma/seeds/seed-questions.ts`. The seed creates questions but doesn't persist the `code` field to the DB (it uses code only as a local key for parent linking). Modify the seed to include `code` in the `prisma.question.create()` data for every question. The code values are already defined in the seed (e.g., 'DNT_CONSULTATION_CONSENT', 'BD_CANCER_HISTORY', 'PACKAGE_CHOICE', etc.).

Also: Remove any `flags` from BD medical question `validationRules`. BD rejection is handled by the `check_bd_eligibility` handler, not per-question flags.

- [ ] **Step 4: Re-seed**

Run: `npx prisma db seed`

- [ ] **Step 5: Generate Prisma client**

Run: `npx prisma generate`

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/seeds/seed-questions.ts
git commit -m "feat(a4): add Question.code, Application.flagsForReview, Quote payment fields to schema"
```

---

## Task 2: Questionnaire Engine

**Files:**
- Create: `lib/engines/questionnaire-engine.ts`
- Create: `__tests__/lib/engines/questionnaire-engine.test.ts`

- [ ] **Step 1: Create questionnaire-engine.ts**

**Read before implementing:**
- Spec Section 4 (Questionnaire Engine)
- `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/questionnaire-engine.ts` — V1 reference
- `prisma/schema.prisma` — Question, QuestionGroup, Answer models
- `prisma/seeds/seed-questions.ts` — understand question structure and codes

Implement these functions:

**Pure functions (no DB):**

```typescript
// Conditional visibility
shouldShowQuestion(
  question: { parentQuestionId: string | null; showWhenValue: string | null },
  answersMap: Map<string, string>,  // questionId → value
): boolean

// Answer validation
validateAnswer(
  question: { type: string; options: unknown; validationRules: unknown },
  value: string,
): { valid: boolean; normalizedValue: string; error?: string }

// Flag detection
checkForFlags(
  question: { validationRules: unknown },
  value: string,
): { flagged: boolean; action: 'flag' | 'escalate' | 'reject' | null; reason: string | null }
```

**DB wrapper functions:**

```typescript
// Find next unanswered question
getNextQuestion(
  groupCodes: string[],
  conversationId: string,
): Promise<{ question: QuestionData; progress: { answered: number; total: number } } | null>

// Progress calculation
calculateProgress(
  groupCodes: string[],
  conversationId: string,
): Promise<{ answered: number; total: number; percentage: number }>
```

**Validation details:**
- BOOLEAN: normalize da/nu/yes/no/true/false/1/0 → "true"/"false"
- MULTIPLE_CHOICE/DROPDOWN: case-insensitive match against options, fuzzy Romanian (strip ă→a, î→i, ș→s, ț→t, â→a)
- MULTI_SELECT: comma-separated, each must match an option
- OPEN_ENDED: minLength, maxLength, pattern (regex)
- NUMBER: parse to number, check min/max
- DATE: parse to valid date

**getNextQuestion logic:**
1. Load all questions for the given group codes, ordered by group orderIndex then question orderIndex
2. Load all answers for this conversationId
3. Build answersMap (questionId → value)
4. For each question: if shouldShowQuestion() is true and no answer exists → return it
5. Count answered (visible questions with answers) and total (all visible questions)

- [ ] **Step 2: Write questionnaire engine tests**

`__tests__/lib/engines/questionnaire-engine.test.ts`:

Tests for pure functions (no DB mocking needed):
1. shouldShowQuestion: no parent → always visible
2. shouldShowQuestion: parent answered with matching value → visible
3. shouldShowQuestion: parent answered with non-matching value → hidden
4. shouldShowQuestion: parent not answered → hidden
5. validateAnswer BOOLEAN: "da" → { valid: true, normalizedValue: "true" }
6. validateAnswer BOOLEAN: "nu" → { valid: true, normalizedValue: "false" }
7. validateAnswer DROPDOWN: valid option → success
8. validateAnswer DROPDOWN: invalid option → error
9. validateAnswer DROPDOWN: fuzzy Romanian match (diacritics stripped) → success
10. validateAnswer NUMBER: within range → success
11. validateAnswer NUMBER: out of range → error
12. validateAnswer OPEN_ENDED: pattern match → success
13. checkForFlags: value matches flag → { flagged: true, action: 'escalate', reason: '...' }
14. checkForFlags: no matching flag → { flagged: false }

- [ ] **Step 3: Run tests**

Run: `npx vitest run __tests__/lib/engines/questionnaire-engine.test.ts`

- [ ] **Step 4: Commit**

```bash
git add lib/engines/questionnaire-engine.ts __tests__/lib/engines/questionnaire-engine.test.ts
git commit -m "feat(a4): add questionnaire engine with conditional Qs, validation, and flag system"
```

---

## Task 3: Quote Engine

**Files:**
- Create: `lib/engines/quote-engine.ts`
- Create: `__tests__/lib/engines/quote-engine.test.ts`

- [ ] **Step 1: Create quote-engine.ts**

**Read before implementing:**
- Spec Section 5 (Quote Engine)
- `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/quote-engine.ts` — V1 reference
- `prisma/seeds/seed-product.ts` — exact pricing data for test validation

Pure function, no DB access:

```typescript
interface QuoteInput {
  tierCode: string
  levelCode: string
  customerAge: number
  includesAddon: boolean
  paymentFrequency: 'annual' | 'semi_annual' | 'quarterly'
  pricingLevel: { premiumAnnual: number; name: { en: string; ro: string } }
  pricingTier: { name: { en: string; ro: string } }
  baseCoverages: { code: string; name: { en: string; ro: string }; amount: number; currency: string; isAgeBased: boolean }[]
  addonPricingRule: { premiumAnnual: number } | null
  addonCoverages: { code: string; name: { en: string; ro: string }; amount: number; currency: string }[]
  quoteValidityDays: number
}

interface QuoteResult {
  premiumAnnual: number
  premiumMonthly: number
  premiumSemiAnnual: number
  premiumQuarterly: number
  basePremiumAnnual: number
  addonPremiumAnnual: number
  baseCoverages: { code: string; name: { en: string; ro: string }; amount: number; currency: string }[]
  addonCoverages: { code: string; name: { en: string; ro: string }; amount: number; currency: string }[]
  pricingTierLabel: { en: string; ro: string }
  pricingLevelLabel: { en: string; ro: string }
  validUntil: Date
}

export function calculateQuote(input: QuoteInput): QuoteResult
```

Calculation:
1. basePremiumAnnual = pricingLevel.premiumAnnual
2. addonPremiumAnnual = addonPricingRule?.premiumAnnual ?? 0
3. premiumAnnual = base + addon
4. premiumMonthly = Math.round(annual / 12 * 100) / 100
5. premiumSemiAnnual = Math.round(annual / 2 * 100) / 100
6. premiumQuarterly = Math.round(annual / 4 * 100) / 100
7. validUntil = new Date(Date.now() + quoteValidityDays * 24 * 60 * 60 * 1000)

- [ ] **Step 2: Write quote engine tests**

`__tests__/lib/engines/quote-engine.test.ts`:

Test with exact data from seed (seed-product.ts):
1. Standard Level I, age 30, no addon: premiumAnnual=190, monthly=15.83
2. Standard Level II, age 30, no addon: premiumAnnual=290
3. Optim Level III, age 30, no addon: premiumAnnual=430
4. Standard Level I, age 30, WITH addon (age 30 = 200 RON): premiumAnnual=390 (190+200)
5. Standard Level I, age 50, WITH addon (age 50 = 500 RON): premiumAnnual=690 (190+500)
6. Payment frequency: annual=690, semi=345, quarterly=172.5, monthly=57.5
7. No addon, addonPricingRule=null: addonPremiumAnnual=0
8. Covers base coverages passthrough
9. Covers addon coverages passthrough when addon included
10. validUntil is 30 days from now

- [ ] **Step 3: Run tests**

Run: `npx vitest run __tests__/lib/engines/quote-engine.test.ts`

- [ ] **Step 4: Commit**

```bash
git add lib/engines/quote-engine.ts __tests__/lib/engines/quote-engine.test.ts
git commit -m "feat(a4): add quote engine with premium calculation for all tier/level/age/addon combinations"
```

---

## Task 4: DNT + Application + BD Handlers

**Files:**
- Create: `lib/tools/handlers/dnt-handlers.ts`
- Create: `lib/tools/handlers/application-handlers.ts`
- Create: `lib/tools/handlers/bd-handlers.ts`

- [ ] **Step 1: Create DNT handlers**

**Read before implementing:**
- Spec Section 6.1 (DNT Handlers)
- `lib/engines/questionnaire-engine.ts` — functions to call
- `lib/tools/types.ts` — ToolHandler, ToolResult, ToolContext
- `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/tools/dnt-tools.ts` — V1 reference

4 handlers all using the questionnaire engine:

```typescript
export const checkDntStatus: ToolHandler
export const startDntQuestionnaire: ToolHandler
export const saveDntAnswer: ToolHandler
export const signDnt: ToolHandler
```

DNT group codes: `['dnt_consent', 'dnt_general', 'dnt_life_type', 'dnt_life_financial', 'dnt_life_investment', 'dnt_sustainability']`

**signDnt** requirements:
- All DNT questions must be answered (calculateProgress → 100%)
- args.confirmSignature must be true
- args.gdprConsent must be true
- Save to WorkflowSession.data: { dntSignedAt: ISO string, dntSignatureConfirmed: true, dntGdprConsent: true, dntValidUntil: now + 365 days }

- [ ] **Step 2: Create Application handlers**

**Read:** Spec Section 6.2, V1 `application-tools.ts`

5 handlers:

```typescript
export const startApplication: ToolHandler
export const saveApplicationAnswer: ToolHandler
export const getApplicationStatus: ToolHandler
export const resumeApplication: ToolHandler
export const cancelApplication: ToolHandler
```

**startApplication:** Check DNT signed (WorkflowSession.data.dntSignedAt), create Application record.

**saveApplicationAnswer:**
- Get current question via questionnaire engine
- Validate answer
- Check flags → if escalate: update Application.status=PAUSED
- Save Answer
- Special question handling by code:
  - PACKAGE_CHOICE → resolve PricingTier by answer value, set Application.tierId
  - PREMIUM_LEVEL → resolve PricingLevel by answer value, set Application.levelId
  - BD_ADDON_INTEREST → set Application.includesAddon = (answer === "true")
- Get next question or mark COMPLETED

- [ ] **Step 3: Create BD handlers**

**Read:** Spec Section 6.7

```typescript
export const checkBdEligibility: ToolHandler
```

- Load all answers for bd_medical group for this conversation
- If fewer than 6 answers → return error (not all questions answered)
- If any answer is "true" → BD rejected: update Application.includesAddon=false, return sensitive rejection message
- If all "false" → BD eligible, return success

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add lib/tools/handlers/dnt-handlers.ts lib/tools/handlers/application-handlers.ts lib/tools/handlers/bd-handlers.ts
git commit -m "feat(a4): add DNT, application, and BD medical tool handlers"
```

---

## Task 5: Quote + Product + Profile + Objection + Utility Handlers

**Files:**
- Create: `lib/tools/handlers/quote-handlers.ts`
- Create: `lib/tools/handlers/product-handlers.ts`
- Create: `lib/tools/handlers/profile-handlers.ts`
- Create: `lib/tools/handlers/objection-handlers.ts`
- Create: `lib/tools/handlers/utility-handlers.ts`

- [ ] **Step 1: Create Quote handlers**

**Read:** Spec Section 6.3, V1 `quote-tools.ts`, `lib/engines/quote-engine.ts`

```typescript
export const generateQuote: ToolHandler
export const getQuoteDetails: ToolHandler
export const acceptQuote: ToolHandler
export const modifyQuote: ToolHandler
```

**generateQuote:**
1. Load Application (must be COMPLETED)
2. Load PricingLevel (via Application.tierId + levelId) with PricingTier
3. Calculate age from Customer.dateOfBirth (fallback 30)
4. Load CoverageAmounts by pricingLevelId (join CoverageType). For DEATH_ANY_CAUSE: filter by age band.
5. If Application.includesAddon: load AddonPricingRule by age band, load addon CoverageAmounts
6. Detect paymentFrequency from Application answers (Question.code = 'PAYMENT_FREQUENCY')
7. Call calculateQuote()
8. Create Quote record with all fields

**acceptQuote:**
1. Load Quote (must be DRAFT, not expired)
2. Require args.confirmAcceptance === true
3. Update Quote status → ACCEPTED
4. Create Policy: { quoteId, customerId, productId, status: PENDING_SUBMISSION, premiumAnnual, premiumMonthly, coverageSummary: quote.coverages, issuedAt: now }
5. Update Conversation.status → COMPLETED
6. Return success with PENDING_SUBMISSION message

- [ ] **Step 2: Create remaining handlers**

**Product handlers** (`product-handlers.ts`):
- compare_products: load 2+ products with pricing, format comparison
- set_conversation_product: update Conversation.productId

**Profile handlers** (`profile-handlers.ts`):
- get_customer_profile: load Customer + extractedProfile + recent conversations/policies
- update_customer_profile: merge fields into extractedProfile

**Objection handler** (`objection-handlers.ts`):
- get_objection_strategy: load ObjectionStrategy by type for conversation's product

**Utility handler** (`utility-handlers.ts`):
- escalate_to_human: update Conversation.status → IDLE, log reason

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add lib/tools/handlers/
git commit -m "feat(a4): add quote, product, profile, objection, and utility handlers"
```

---

## Task 6: Registry + Validation Wiring

**Files:**
- Modify: `lib/tools/registry.ts`
- Modify: `lib/tools/validation.ts`

- [ ] **Step 1: Update registry with real handlers**

Read current `lib/tools/registry.ts`. For each of the 23 existing tool registrations, replace the stub handler with the imported real handler from `lib/tools/handlers/`.

Also add 2 NEW tool registrations:
- `cancel_application`: blocking, silent, null statusMessage, allowedRoles: [CUSTOMER, ADMIN, OPERATOR]
- `modify_quote`: blocking, silent, null statusMessage, allowedRoles: [CUSTOMER, ADMIN, OPERATOR]

Import all handler files:
```typescript
import { checkDntStatus, startDntQuestionnaire, saveDntAnswer, signDnt } from './handlers/dnt-handlers'
import { startApplication, saveApplicationAnswer, getApplicationStatus, resumeApplication, cancelApplication } from './handlers/application-handlers'
import { generateQuote, getQuoteDetails, acceptQuote, modifyQuote } from './handlers/quote-handlers'
import { compareProducts, setConversationProduct } from './handlers/product-handlers'
import { getCustomerProfile, updateCustomerProfile } from './handlers/profile-handlers'
import { getObjectionStrategy } from './handlers/objection-handlers'
import { checkBdEligibility } from './handlers/bd-handlers'
import { escalateToHuman } from './handlers/utility-handlers'
```

- [ ] **Step 2: Update validation schemas**

Read current `lib/tools/validation.ts`. Replace all `.passthrough()` stubs with `.strict()` schemas matching the handler args. Add schemas for cancel_application and modify_quote.

Key schemas:
- save_dnt_answer: `{ answer: string, questionId?: string }`
- sign_dnt: `{ confirmSignature: boolean, gdprConsent: boolean }` (both required true)
- save_application_answer: `{ answer: string }`
- generate_quote: `{}` (no args needed — loads from context)
- accept_quote: `{ confirmAcceptance: boolean }`
- get_objection_strategy: `{ type: string }`
- check_bd_eligibility: `{}` (no args)
- cancel_application: `{ reason?: string }`
- modify_quote: `{}`

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add lib/tools/registry.ts lib/tools/validation.ts
git commit -m "feat(a4): wire all handlers into registry and update validation schemas"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (prompt-builder + reasoning-gate + questionnaire-engine + quote-engine).

- [ ] **Step 3: Re-seed database**

Run: `npx prisma db push --force-reset` (reset to pick up schema changes)
Then: `npx prisma db seed`

- [ ] **Step 4: Verify dev server**

Run: `npm run dev` (start, verify compiles, stop)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(a4): complete Slice A4 — sales engine with all tool handlers, questionnaire + quote engines"
```

---

## Notes for Implementer

1. **Import paths:** Use `@/` alias. PrismaClient from `@/lib/generated/prisma/client`. Tool types from `@/lib/tools/types`.

2. **V1 reference files** (read for implementation patterns):
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/tools/dnt-tools.ts`
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/tools/application-tools.ts`
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/tools/quote-tools.ts`
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/tools/product-tools.ts`
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/tools/profile-tools.ts`
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/tools/utility-tools.ts`
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/quote-engine.ts`
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/questionnaire-engine.ts`

3. **Handler pattern:** Every handler follows the same pattern:
   ```typescript
   export const handlerName: ToolHandler = async (args, context) => {
     try {
       // ... business logic
       return { success: true, data: { ... }, message: '...' }
     } catch (error) {
       return { success: false, error: String(error) }
     }
   }
   ```

4. **Question codes for special handling:** Look up questions by `code` field:
   - `PACKAGE_CHOICE` → sets Application.tierId
   - `PREMIUM_LEVEL` → sets Application.levelId
   - `BD_ADDON_INTEREST` → sets Application.includesAddon
   - `PAYMENT_FREQUENCY` → used by quote generation

5. **BD rejection is handler-level:** The `check_bd_eligibility` handler checks all 6 answers after completion. Individual BD questions do NOT have per-question flags. Use sensitive, neutral messaging (brand book S16 tone rules).

6. **Policy status is PENDING_SUBMISSION:** V2's quote acceptance creates policies with PENDING_SUBMISSION (not ACTIVE) because Allianz submission is manual. The operator activates the policy in the admin panel.

7. **Premium arithmetic is always in RON.** Base and addon premiums are both RON. Coverage display amounts may be EUR (BD coverages) but that's for display only.

8. **Prisma Json fields:** Cast through `unknown` when reading. Use `Prisma.JsonNull` (or `Prisma.DbNull` in v7) for null Json values.
