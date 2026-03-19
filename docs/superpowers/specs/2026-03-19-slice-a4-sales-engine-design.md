# Slice A4: Sales Engine — Design Spec

**Project:** Zeno — AI Life Insurance Sales Agent V2
**Slice:** A4 (Questionnaire Engine, Quote Engine, All Tool Handlers)
**Date:** 2026-03-19
**Status:** Approved
**Depends on:** Slices A1-A3 — complete

---

## 1. Goal

Implement all remaining tool handlers, the questionnaire engine, and the quote engine so that the agent can sell Protect + BD addon end-to-end via API. This completes Phase A — the core engine.

## 2. File structure

```
lib/engines/
  questionnaire-engine.ts   — NEW: shared Q&A logic (conditional Qs, validation, flags, progress)
  quote-engine.ts           — NEW: premium calculation (tier/level/age/addon resolution)

lib/tools/handlers/
  dnt-handlers.ts           — NEW: check_dnt_status, start_dnt_questionnaire, save_dnt_answer, sign_dnt
  application-handlers.ts   — NEW: start_application, save_application_answer, get_application_status, resume_application, cancel_application
  quote-handlers.ts         — NEW: generate_quote, get_quote_details, accept_quote, modify_quote
  product-handlers.ts       — NEW: compare_products, set_conversation_product
  profile-handlers.ts       — NEW: get_customer_profile, update_customer_profile
  objection-handlers.ts     — NEW: get_objection_strategy
  bd-handlers.ts            — NEW: check_bd_eligibility
  utility-handlers.ts       — NEW: escalate_to_human

lib/tools/registry.ts       — MODIFIED: replace stubs with real handler imports

__tests__/
  lib/engines/
    questionnaire-engine.test.ts
    quote-engine.test.ts
  integration/
    sales-flow.test.ts      — end-to-end happy path
```

## 3. Questionnaire Engine

### `lib/engines/questionnaire-engine.ts`

Shared logic for DNT, Application, and BD medical questionnaire flows. All three use the same Question/Answer tables but different QuestionGroups.

**Reference:** Read `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/questionnaire-engine.ts` for V1 patterns.

### 3.1 Core functions

```typescript
// Find next unanswered visible question across one or more groups
getNextQuestion(
  groupCodes: string[],
  conversationId: string,
): Promise<{ question: QuestionWithGroup; progress: { answered: number; total: number } } | null>

// Evaluate conditional visibility
shouldShowQuestion(
  question: { parentQuestionId: string | null; showWhenValue: string | null },
  answersMap: Map<string, string>,  // questionId → value
): boolean

// Type-specific answer validation
validateAnswer(
  question: { type: string; options: unknown; validationRules: unknown },
  value: string,
): { valid: boolean; normalizedValue: string; error?: string }

// 3-tier flag system
checkForFlags(
  question: { validationRules: unknown },
  value: string,
): { flagged: boolean; action: 'flag' | 'escalate' | 'reject' | null; reason: string | null }

// Progress calculation
calculateProgress(
  groupCodes: string[],
  conversationId: string,
): Promise<{ answered: number; total: number; percentage: number }>
```

### 3.2 Conditional question logic

Questions have optional `parentQuestionId` and `showWhenValue`:
- If `parentQuestionId` is null: always visible
- If `parentQuestionId` set: visible only if parent answer matches `showWhenValue`
- `showWhenValue` supports: exact match (string), boolean ("true"/"false"), or JSON condition `{ eq: value }` / `{ neq: value }`

### 3.3 Answer validation

| Question type | Validation |
|--------------|------------|
| BOOLEAN | Normalize "da"/"nu"/"yes"/"no"/"true"/"false"/"1"/"0" → "true"/"false" |
| MULTIPLE_CHOICE / DROPDOWN | Must match one of `options[].value` (case-insensitive, fuzzy on Romanian diacritics) |
| MULTI_SELECT | Comma-separated values, each must match an option |
| OPEN_ENDED | validationRules: minLength, maxLength, pattern (regex) |
| NUMBER | Parse to number, check min/max from validationRules |
| DATE | Parse to valid date |

**Fuzzy matching** for Romanian: strip diacritics (ă→a, î→i, ș→s, ț→t, â→a) before comparison.

### 3.4 Flag system (3-tier)

Flags are defined in `Question.validationRules` as:
```json
{
  "flags": [
    { "value": "true", "action": "reject", "reason": "BD medical condition detected" }
  ]
}
```

Actions:
- `flag` (soft): Accumulated in Application.flagsForReview array, flow continues
- `escalate`: Application.status set to PAUSED, workflow pauses, agent informs customer
- `reject`: For BD medical — any YES answer rejects the addon. Application.includesAddon set to false.

### 3.5 BD rejection rule

All 6 BD medical questions have `{ "flags": [{ "value": "true", "action": "reject", "reason": "..." }] }`. The `check_bd_eligibility` handler checks if any BD answer is "true" after all 6 are answered.

## 4. Quote Engine

### `lib/engines/quote-engine.ts`

**Pure function** — no DB access. Receives resolved pricing data as input, returns calculated quote.

```typescript
interface QuoteInput {
  tierCode: string              // "standard" or "optim"
  levelCode: string             // "level_1", "level_2", "level_3"
  customerAge: number
  includesAddon: boolean
  paymentFrequency: 'annual' | 'semi_annual' | 'quarterly'
  // Resolved pricing data passed in:
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

function calculateQuote(input: QuoteInput): QuoteResult
```

**Calculation:**
1. `basePremiumAnnual` = `pricingLevel.premiumAnnual`
2. `addonPremiumAnnual` = `addonPricingRule?.premiumAnnual ?? 0`
3. `premiumAnnual` = base + addon
4. `premiumMonthly` = annual / 12 (rounded to 2 decimals)
5. `premiumSemiAnnual` = annual / 2
6. `premiumQuarterly` = annual / 4
7. `validUntil` = now + quoteValidityDays

No rounding magic — keep exact values from DB. Frontend handles display formatting.

## 5. Tool Handlers

### 5.1 DNT Handlers (`lib/tools/handlers/dnt-handlers.ts`)

**check_dnt_status(args, context):**
- Query Answers for DNT question groups + this conversationId
- Check if all DNT questions answered → completion percentage
- Check WorkflowSession.data for signing metadata (signedAt, validUntil)
- Return: { dntExists, completionPercentage, isSigned, signedAt, validUntil }

**start_dnt_questionnaire(args, context):**
- Call `getNextQuestion(['dnt_consent', 'dnt_general', 'dnt_life_type', 'dnt_life_financial', 'dnt_life_investment', 'dnt_sustainability'], conversationId)`
- Return first question with text, type, options + progress

**save_dnt_answer(args: { answer }, context):**
- Determine current question (from getNextQuestion or args.questionId)
- Validate via `validateAnswer()`
- Save to Answer table (upsert on questionId + conversationId)
- Get next question
- If no more questions → return completion message
- Return next question + progress

**sign_dnt(args: { confirmSignature, gdprConsent }, context):**
- Verify all DNT questions answered
- Require confirmSignature=true AND gdprConsent=true
- Save to WorkflowSession.data: { dntSignedAt, dntSignatureConfirmed, dntGdprConsent, dntValidUntil: now + 365 days }
- Return success with signing confirmation

### 5.2 Application Handlers (`lib/tools/handlers/application-handlers.ts`)

**start_application(args, context):**
- Verify DNT is signed (check WorkflowSession.data.dntSignedAt)
- Check no existing OPEN application for this conversation
- Create Application record (conversationId, customerId, productId, status: OPEN)
- Return first question from 'application' group + progress

**save_application_answer(args: { answer }, context):**
- Get current question from getNextQuestion(['application'], conversationId)
- Validate answer
- Check flags → if escalate: pause application + workflow, return concern message
- Save Answer
- Update Application.currentQuestionIndex
- If BD_ADDON_INTEREST answered "true": set Application.includesAddon=true
- If PACKAGE_CHOICE answered: set Application.tierId (resolve from answer value)
- If PREMIUM_LEVEL answered: set Application.levelId (resolve from answer value)
- Get next question → if none, mark Application COMPLETED
- Return next question or completion + progress

**get_application_status(args, context):**
- Load Application for this conversation
- Return: status, progress, tierId, levelId, includesAddon, flagsForReview

**resume_application(args, context):**
- Find PAUSED application, set status=OPEN
- Return next unanswered question

**cancel_application(args: { reason? }, context):**
- Update Application status to COMPLETED (closed)
- Return confirmation

### 5.3 Quote Handlers (`lib/tools/handlers/quote-handlers.ts`)

**generate_quote(args, context):**
- Load Application (must be COMPLETED, not cancelled)
- Extract tier/level from Application.tierId/levelId
- Calculate customer age from Customer.dateOfBirth (fallback to 30 if unknown)
- Load pricing data: PricingLevel with tier, CoverageAmounts by level + age band, AddonPricingRule by age band
- Detect payment frequency from Application answers (default: annual)
- Call `calculateQuote()` from quote engine
- Create Quote record: { applicationId, productId, customerId, premiumAnnual, premiumMonthly, currency, coverages (JSON), addonsSelected (JSON), status: DRAFT, validUntil }
- Return quote summary with all coverages and pricing

**accept_quote(args: { confirmAcceptance? }, context):**
- Load Quote (must be DRAFT, not expired)
- Require confirmAcceptance=true
- Update Quote status → ACCEPTED
- Create Policy: { quoteId, customerId, productId, status: PENDING_SUBMISSION, premiumAnnual, premiumMonthly, coverageSummary (from quote), issuedAt: now }
- Update Conversation status → COMPLETED
- Return: policy created, PENDING_SUBMISSION status, next steps message
- Note: V2 uses PENDING_SUBMISSION because Allianz submission is manual (operator processes in admin panel)

**get_quote_details(args, context):**
- Load Quote with coverages
- Return formatted breakdown

**modify_quote(args, context):**
- Update current Quote status → EXPIRED
- Reset Application: clear tierId, levelId, currentQuestionIndex, status=OPEN
- Return: application reopened for package selection changes, next question

### 5.4 Product Handlers (`lib/tools/handlers/product-handlers.ts`)

**compare_products(args: { productCodes: string[] }, context):**
- Load products with pricing tiers/levels
- Format side-by-side comparison: features, pricing, coverages
- Return comparison table

**set_conversation_product(args: { productCode }, context):**
- Find product by code
- Update Conversation.productId
- Return: product set, ready for next workflow step

### 5.5 Profile Handlers (`lib/tools/handlers/profile-handlers.ts`)

**get_customer_profile(args, context):**
- Load Customer with extractedProfile
- Load recent conversations (last 5), policies, quotes
- Return formatted profile

**update_customer_profile(args: { ...fields }, context):**
- Merge provided fields into Customer.extractedProfile
- Update Customer record
- Return updated fields

### 5.6 Objection Handler (`lib/tools/handlers/objection-handlers.ts`)

**get_objection_strategy(args: { type }, context):**
- Load ObjectionStrategy for conversation's product where type matches
- Return full strategy text (verbatim Romanian)
- If no strategy found: return generic "acknowledge concern, ask to understand more" guidance

### 5.7 BD Handler (`lib/tools/handlers/bd-handlers.ts`)

**check_bd_eligibility(args, context):**
- Load all 6 BD medical answers for this conversation
- If any answer is "true" → BD rejected
- Update Application.includesAddon = false
- Return result with sensitive messaging (from brand book S16 tone rules: neutral, respectful, zero humor)

### 5.8 Utility Handler (`lib/tools/handlers/utility-handlers.ts`)

**escalate_to_human(args: { reason?, priority? }, context):**
- Update Conversation.status → IDLE
- Log escalation (console for now, DB persistence in Phase B)
- Return: escalation acknowledged, human will follow up

## 6. Registry Update

`lib/tools/registry.ts` modified:
- Import all handler files from `lib/tools/handlers/`
- Replace stub handlers with real implementations
- Keep existing tool definitions (name, description, parameters, executionMode, statusMessage) unchanged
- Only the handler function reference changes

## 7. Validation Schema Updates

`lib/tools/validation.ts` modified:
- Replace `.passthrough()` stubs with `.strict()` schemas for all tools
- Add proper field definitions matching each handler's expected args

## 8. Exit criteria

- [ ] All 23 tool handlers implemented (no stubs)
- [ ] Questionnaire engine: getNextQuestion, validateAnswer, checkForFlags, calculateProgress all working
- [ ] Quote engine: accurate premium calculation for all 6 tier/level combinations × 9 age bands × with/without addon × 3 payment frequencies
- [ ] DNT flow: start → answer all questions → sign with GDPR consent
- [ ] Application flow: start (requires signed DNT) → answer questions → BD addon interest → COMPLETED
- [ ] BD medical flow: 6 questions → eligibility check → reject or continue
- [ ] Quote flow: generate → accept → Policy created with PENDING_SUBMISSION
- [ ] Objection handling: all 9 types return full Romanian strategy text
- [ ] Workflow transitions fire correctly on tool results
- [ ] `npx tsc --noEmit` passes
- [ ] Unit tests: questionnaire engine (conditional Qs, validation, flags) + quote engine (all combinations)
- [ ] Integration test: happy path conversation producing a policy

## 9. What A4 does NOT include

- Frontend / UI (Phase B)
- Payment processing (Phase B — Stripe/PayU)
- Email notifications (Phase B)
- Allianz submission template (Phase B admin panel)
- PDF generation for DNT suitability report (Phase C)
- Re-engagement, debrief, learning loop (P2)

## 10. Testing strategy

- **questionnaire-engine.test.ts:** Conditional question visibility, answer validation (all types), flag detection (soft/escalate/reject), progress calculation, fuzzy Romanian matching
- **quote-engine.test.ts:** All 6 tier/level premiums, age-banded death coverage amounts, addon pricing by age band, payment frequency calculations, with and without addon
- **sales-flow.test.ts:** Integration test mocking LLM, walking through: set product → DNT → sign → application → package selection → BD interest → BD questions → quote → accept → policy created
