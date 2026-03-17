# Slice A1: Foundation — Design Spec

**Project:** Zeno — AI Life Insurance Sales Agent V2
**Slice:** A1 (Foundation)
**Date:** 2026-03-17
**Status:** Approved

---

## 1. Goal

Deliver a working Next.js 15 project with Docker Postgres, complete Prisma schema (26 models), and all seed data ported from V1 extraction files. This is the data foundation everything else builds on.

## 2. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Brand | Zeno | Stoic philosophy — calm, rational, prepared for anything |
| Database | Local Docker Postgres 16 | Defer managed hosting to Phase B. No ops overhead for Phase A. |
| Default LLM | GPT-5.2 primary, Anthropic equivalent fallback | Admin-configurable per agent. Low-stakes — switchable from UI. |
| Payment abstraction | PayU + Stripe interfaces | No agreements yet. Build provider interface, implement both. |
| Allianz submission | Email template | Simple for launch. Portal/API integration later. |
| Regulatory posture | Allianz Agent | Not broker or intermediary. |
| Team | Solo dev + Claude Code | One Allianz operator gets admin panel access (OPERATOR role). |
| Answer storage | String, not Json | V1's Json answers caused 36 JSON.parse workarounds. String + type coercion is cleaner. Multi-select answers stored as comma-separated values. |
| Bilingual fields | Json with { en, ro } | Proven pattern from V1. |
| Customer PII | App-level encryption for CNP | GDPR. Encrypt before write, decrypt on read. |
| IDs | cuid() | Same as V1. Prisma default. |
| Addon coverages | Normalized via CoverageAmount relation | Build plan had `coverages(json)` on Addon. V2 normalizes into CoverageAmount records with `addonId` set and `pricingLevelId` null. Better for querying. |
| Application addons | `includesAddon` Boolean | Build plan had `addons(json)`. Simplified since only one addon (BD) exists. Migrate to Json if a second addon is added. |
| Policy expiry | `effectiveUntil` | Build plan had `expiresAt`. Renamed to pair with `effectiveFrom` for consistency. |
| Payment provider ID | `providerPaymentId` | Build plan had `stripePaymentId`. Generalized since we support both Stripe and PayU. |

## 3. Project structure

```
zeno/
├── app/
│   ├── layout.tsx              # Root layout, Inter + Fraunces fonts
│   ├── page.tsx                # Placeholder landing
│   └── api/                    # API routes (Slice A2+)
├── lib/                        # Core business logic (Slice A2+)
├── components/                 # UI components (Phase B)
├── prisma/
│   ├── schema.prisma           # 26 models, 5 domains
│   └── seeds/
│       ├── index.ts            # Runs all seeds in dependency order
│       ├── seed-product.ts     # Protect product, tiers, levels, coverages, addon
│       ├── seed-questions.ts   # DNT, Application, BD medical questions
│       ├── seed-objections.ts  # 9 objection strategies (Romanian)
│       ├── seed-workflows.ts   # Sales Journey + Life Insurance Purchase
│       ├── seed-agents.ts      # 4 agent configs with provider/model
│       └── seed-model-catalog.ts # OpenAI + Anthropic models for admin dropdown
├── public/brand/               # Zeno brand assets (SVG placeholders)
├── docker-compose.yml          # PostgreSQL 16
├── .env.example
├── tailwind.config.ts          # Extended with Zeno brand tokens
├── components.json             # shadcn/ui config
├── tsconfig.json               # Strict mode
└── package.json
```

## 4. Tech stack (A1 only)

| Layer | Choice | Version |
|-------|--------|---------|
| Framework | Next.js (App Router) | 15 |
| Language | TypeScript (strict) | 5.7+ |
| Database | PostgreSQL | 16 |
| ORM | Prisma | Latest |
| UI toolkit | Tailwind CSS + shadcn/ui | Tailwind 4, shadcn latest |
| Validation | Zod | Latest |
| Container | Docker Compose | PostgreSQL only |

**Not included in A1:** LLM SDKs (openai, @anthropic-ai/sdk), streaming libraries, auth libraries, payment SDKs, email libraries, analytics.

## 5. Prisma schema

### 5.1 Domain: Core product

**Product**
- `id` String @id @default(cuid())
- `code` String @unique — e.g., "protect"
- `name` Json — { en, ro }
- `description` Json — { en, ro }
- `insuranceType` String — "LIFE"
- `subType` String — "term_life"
- `eligibility` Json — { minAge, maxAge, residency, healthRequirements, notes }
- `features` String[] — feature list
- `exclusions` String[] — exclusion list
- `defaultPlaybook` String — sales approach text
- `pricingExplanation` String — pricing explanation text
- `targetCustomer` String
- `targetAgeRange` String
- `contractTerm` String
- `gracePeriod` String
- `medicalExamRequired` Boolean @default(false)
- `territoryCoverage` String
- `premiumRange` Json? — { min, max, currency, frequency } for display
- `paymentFrequencyOptions` Json? — [{ code: "annual", multiplier: 1.0 }, { code: "semi_annual", multiplier: 0.5 }, { code: "quarterly", multiplier: 0.25 }]
- `quoteValidityDays` Int @default(30)
- `isActive` Boolean @default(true)
- `createdAt` DateTime @default(now())
- `updatedAt` DateTime @updatedAt
- Relations: pricingTiers[], addons[], questionGroups[], objectionStrategies[], conversations[], applications[]

**PricingTier**
- `id`, `productId`, `code` String, `name` Json, `description` Json?
- `orderIndex` Int
- `isActive` Boolean @default(true)
- `createdAt`, `updatedAt`
- Relations: product, levels[]
- @@unique([productId, code])

**PricingLevel**
- `id`, `tierId`, `code` String, `name` Json
- `premiumAnnual` Float — THE source of truth for premium
- `currency` String @default("RON")
- `orderIndex` Int
- `isActive` Boolean @default(true)
- `createdAt`, `updatedAt`
- Relations: tier, coverageAmounts[]
- @@unique([tierId, code])

**CoverageType**
- `id`, `code` String @unique, `name` Json, `description` Json?
- `category` String? — "life", "accident", "health"
- `unit` String? — "lump_sum", "per_day", etc. (from extraction metadata)
- `maxUnits` Int? — e.g., 90 max days for hospitalization
- `deductibleDays` Int? — e.g., 3-day deductible for hospitalization
- `createdAt`
- Relations: coverageAmounts[]

**CoverageAmount**
- `id`, `coverageTypeId`, `pricingLevelId` String?
- `addonId` String? — for addon-specific coverages
- `amount` Float
- `currency` String @default("RON")
- `isAgeBased` Boolean @default(false)
- `minAge` Int?
- `maxAge` Int?
- `createdAt`
- Relations: coverageType, pricingLevel?, addon?
- @@index([coverageTypeId, pricingLevelId])
- @@index([coverageTypeId, addonId])

**Addon**
- `id`, `productId`, `code` String, `name` Json, `description` Json?
- `waitingPeriod` String? — "180 days" for BD
- `isActive` Boolean @default(true)
- `createdAt`, `updatedAt`
- Relations: product, pricingRules[], coverageAmounts[]
- @@unique([productId, code])

**AddonPricingRule**
- `id`, `addonId`
- `minAge` Int, `maxAge` Int
- `premiumAnnual` Float
- `currency` String @default("RON")
- `createdAt`
- Relations: addon
- @@index([addonId, minAge, maxAge])

**ObjectionStrategy**
- `id`, `productId`
- `type` String — "price_base", "price_addon", "no_need", etc.
- `title` String — display title
- `strategy` String — full Romanian response text (verbatim from extraction)
- `addonContext` String? — BD-specific context
- `orderIndex` Int @default(0)
- `isActive` Boolean @default(true)
- `createdAt`, `updatedAt`
- Relations: product
- @@unique([productId, type])

### 5.2 Domain: Conversation and sales

**Customer**
- `id`, `email` String? @unique, `phone` String?
- `name` String?, `dateOfBirth` DateTime?
- `cnp` String? — encrypted at app level
- `address` Json? — { street, city, county, postalCode }
- `language` String @default("ro")
- `extractedProfile` Json? — demographics, employment, family from profile-extractor agent
- `isAnonymous` Boolean @default(true) — becomes false after data collection
- `createdAt`, `updatedAt`
- Relations: conversations[], applications[], policies[], payments[]

**Conversation**
- `id`, `customerId`, `productId` String?
- `status` ConversationStatus @default(ACTIVE)
- `channel` String @default("web")
- `language` String @default("ro")
- `messageCount` Int @default(0)
- `startedAt` DateTime @default(now())
- `completedAt` DateTime?
- `lastActivityAt` DateTime @default(now())
- `metadata` Json? — extensible for A/B test segment, referral source, etc.
- `createdAt`, `updatedAt`
- Relations: customer, product?, messages[], workflowSession?, summary?, answers[], application?, turnTraces[]

**Message**
- `id`, `conversationId`
- `role` String — "user", "assistant", "system"
- `content` String
- `toolCalls` Json? — tool invocations by assistant
- `toolResults` Json? — tool execution results
- `tokenCount` Int? — for cost tracking
- `createdAt` DateTime @default(now())
- Relations: conversation
- @@index([conversationId, createdAt])

**ConversationSummary**
- `id`, `conversationId` String @unique
- `summary` String — compressed history text
- `messagesUpTo` Int — last message index included in summary
- `tokenCount` Int?
- `createdAt`, `updatedAt`
- Relations: conversation

### 5.3 Domain: Workflow and questionnaire

**Workflow**
- `id`, `code` String @unique, `name` String, `description` String?
- `isActive` Boolean @default(true)
- `version` Int @default(1)
- `createdAt`, `updatedAt`
- Relations: steps[], sessions[]

**WorkflowStep**
- `id`, `workflowId`
- `code` String, `name` String
- `type` String — "INTERACTIVE", "AUTO", "DECISION"
- `orderIndex` Int
- `autoTool` String? — tool to auto-execute for AUTO steps
- `allowedTools` String[] — tools available at this step
- `agentInstructions` String? — prompt fragment for agent at this step
- `uiAction` String? — frontend action hint
- `createdAt`, `updatedAt`
- Relations: workflow, transitionsFrom[], transitionsTo[], workflowSessions[]
- @@unique([workflowId, code])

**StepTransition**
- `id`, `fromStepId`, `toStepId`
- `conditionType` String — "TOOL_RESULT", "DATA_CHECK"
- `conditionValue` String — the condition expression
- `label` String? — human-readable description
- `priority` Int @default(0) — higher = evaluated first
- `createdAt`
- Relations: fromStep, toStep

**WorkflowSession**
- `id`, `workflowId`, `currentStepId`, `conversationId` String @unique
- `status` WorkflowSessionStatus @default(ACTIVE)
- `data` Json? — workflow-specific context (selected tier, addon choice, etc.)
- `createdAt`, `updatedAt`
- Relations: workflow, currentStep, conversation

**QuestionGroup**
- `id`, `code` String @unique, `name` Json — { en, ro }
- `productId` String?
- `description` String?
- `orderIndex` Int @default(0)
- `createdAt`, `updatedAt`
- Relations: product?, questions[]

**Question**
- `id`, `groupId`
- `text` Json — { en, ro }
- `helpText` Json? — { en, ro }
- `type` String — "BOOLEAN", "MULTIPLE_CHOICE", "DROPDOWN", "MULTI_SELECT", "OPEN_ENDED", "NUMBER", "DATE"
- `options` Json? — for MULTIPLE_CHOICE: [{ value, label: { en, ro } }]
- `validationRules` Json? — { required, min, max, pattern, etc. }
- `parentQuestionId` String? — for conditional branching
- `showWhenValue` String? — show this question when parent answer equals this
- `orderIndex` Int
- `isRequired` Boolean @default(true)
- `createdAt`, `updatedAt`
- Relations: group, parentQuestion?, childQuestions[], answers[]
- @@index([groupId, orderIndex])

**Answer**
- `id`, `questionId`, `conversationId`
- `value` String — stored as string, coerced by type
- `answeredAt` DateTime @default(now())
- Relations: question, conversation
- @@unique([questionId, conversationId])

### 5.4 Domain: Quote and policy

**Application**
- `id`, `conversationId` String @unique, `customerId`, `productId`
- `tierId` String?, `levelId` String?, `includesAddon` Boolean @default(false)
- `status` ApplicationStatus @default(OPEN)
- `currentQuestionIndex` Int @default(0)
- `totalQuestions` Int @default(0)
- `completedAt` DateTime?
- `createdAt`, `updatedAt`
- Relations: conversation, customer, product, tier?, level?, quote?

**Quote**
- `id`, `applicationId` String @unique, `productId`, `customerId`
- `premiumAnnual` Float, `premiumMonthly` Float
- `currency` String @default("RON")
- `coverages` Json — [{ type, amount, currency }]
- `addonsSelected` Json? — [{ code, premiumAnnual }]
- `status` QuoteStatus @default(DRAFT)
- `validUntil` DateTime
- `createdAt`, `updatedAt`
- Relations: application, product, customer, policy?

**Policy**
- `id`, `quoteId` String @unique, `customerId`, `productId`
- `allianzPolicyNumber` String? — entered by operator after Allianz confirms
- `status` PolicyStatus @default(PENDING_SUBMISSION)
- `effectiveFrom` DateTime?
- `effectiveUntil` DateTime?
- `premiumAnnual` Float
- `premiumMonthly` Float
- `currency` String @default("RON")
- `coverageSummary` Json — snapshot at issuance
- `issuedAt` DateTime?
- `createdAt`, `updatedAt`
- Relations: quote, customer, product, payments[]

**Payment**
- `id`, `policyId`, `customerId`
- `amount` Float, `currency` String @default("RON")
- `provider` PaymentProvider
- `providerPaymentId` String? — Stripe/PayU transaction ID
- `status` PaymentStatus @default(PENDING)
- `paidAt` DateTime?
- `metadata` Json? — provider-specific data
- `createdAt`, `updatedAt`
- Relations: policy, customer

### 5.5 Domain: Agent and observability

**Agent**
- `id`, `slug` String @unique — "main-chat", "reasoning-gate", etc.
- `name` String, `type` AgentType
- `provider` LLMProvider @default(OPENAI)
- `model` String — e.g., "gpt-5.2"
- `fallbackProvider` LLMProvider? @default(ANTHROPIC)
- `fallbackModel` String? — e.g., "claude-sonnet-4-20250514"
- `temperature` Float @default(0.7)
- `maxTokens` Int @default(4096)
- `systemPrompt` String? — base prompt (extended by dynamic assembly)
- `constraints` String? — additional constraints text
- `isActive` Boolean @default(true)
- `createdAt`, `updatedAt`

**ModelCatalog**
- `id`, `provider` LLMProvider
- `modelId` String — API identifier, e.g., "gpt-5.2"
- `displayName` String — "GPT-5.2"
- `supportsStreaming` Boolean @default(true)
- `supportsTools` Boolean @default(true)
- `supportsStructuredOutput` Boolean @default(true)
- `costPer1kInputTokens` Float
- `costPer1kOutputTokens` Float
- `isActive` Boolean @default(true)
- `createdAt`, `updatedAt`
- @@unique([provider, modelId])

**TurnTrace**
- `id`, `conversationId`, `messageIndex` Int
- `phases` Json — pipeline phase timings and data
- `anomalies` Json? — detected issues
- `inputTokens` Int?, `outputTokens` Int?
- `cost` Float? — calculated from ModelCatalog rates
- `latencyMs` Int? — total turn latency
- `provider` String?, `model` String? — which model actually served this turn
- `createdAt` DateTime @default(now())
- Relations: conversation
- @@index([conversationId, messageIndex])

**Referral** (schema ready, logic in P1)
- `id`, `referrerCustomerId`, `referredCustomerId` String?
- `code` String @unique — unique referral code
- `status` String @default("pending") — "pending", "converted", "rewarded"
- `rewardApplied` Boolean @default(false)
- `createdAt`, `updatedAt`
- Relations: referrer (Customer), referred (Customer?)

### 5.6 Enums

```prisma
enum ConversationStatus {
  ACTIVE
  IDLE
  COMPLETED
  ABANDONED
}

enum ApplicationStatus {
  OPEN
  PAUSED
  COMPLETED
}

enum QuoteStatus {
  DRAFT
  ACCEPTED
  EXPIRED
}

enum PolicyStatus {
  PENDING_SUBMISSION
  SUBMITTED
  ACTIVE
  CANCELLED
  EXPIRED
}

enum PaymentStatus {
  PENDING
  COMPLETED
  FAILED
  REFUNDED
}

enum PaymentProvider {
  STRIPE
  PAYU
}

enum WorkflowSessionStatus {
  ACTIVE
  PAUSED
  COMPLETED
  CANCELLED
}

enum AgentType {
  MAIN_CHAT
  REASONING_GATE
  SUMMARIZER
  PROFILE_EXTRACTOR
}

enum LLMProvider {
  OPENAI
  ANTHROPIC
}

enum UserRole {
  CUSTOMER
  ADMIN
  OPERATOR
}
```

> Note: `UserRole` is defined now but consumed by the auth/User model added in Phase B. Defined here so the enum exists when seeds reference it and to avoid a migration later.

## 6. Seed data

### 6.1 seed-product.ts

Source: `extraction/product/product-catalog.json`

Seeds:
- 1 Product (Protect)
- 4 CoverageTypes (DEATH_ANY_CAUSE, PERMANENT_INVALIDITY_ACCIDENT, SURGICAL_INTERVENTION_ACCIDENT, HOSPITALIZATION_ACCIDENT)
- 2 PricingTiers (Standard, Optim)
- 6 PricingLevels (Level I/II/III per tier): Standard 190/290/390 RON, Optim 230/330/430 RON
- ~54 CoverageAmounts for DEATH_ANY_CAUSE (age-banded: 18-25, 26-30, 31-35, 36-40, 41-45, 46-50, 51-55, 56-60, 61-64 × 6 levels)
- Fixed CoverageAmounts for other types (per tier)
- 1 Addon (BD — Medical Treatment Abroad)
- 3 Addon CoverageTypes (TREATMENT_COSTS, HOSPITALIZATION_ABROAD, POST_TREATMENT_MEDICATION) — codes from extraction
- Addon CoverageAmounts (fixed: TREATMENT_COSTS 2M EUR, HOSPITALIZATION_ABROAD 100 EUR/day, POST_TREATMENT_MEDICATION 50K EUR)
- 4 age-banded AddonPricingRules from product-catalog.json: 18-30: 200 RON/yr, 31-45: 350 RON/yr, 46-55: 500 RON/yr, 56-64: 700 RON/yr
- Note: objection-handling-ro.md references 9 age bands in EUR — those are sales talking points, NOT canonical pricing. Use product-catalog.json (4 bands, RON) as source of truth.

All numbers ported exactly from extraction. No rounding, no modification.

### 6.2 seed-questions.ts

Source: `extraction/product/medical-questionnaire.json` + `extraction/product/underwriting-flow.json`

Seeds:
- QuestionGroup: "dnt_consent" — GDPR and regulatory consents (3 questions from CONSENTS section)
- QuestionGroup: "dnt_general" — General suitability questions (6 questions from GENERAL section)
- QuestionGroup: "dnt_life_type" — Life insurance type selection (1 question from LIFE_TYPE section)
- QuestionGroup: "dnt_life_financial" — Financial situation for life insurance (11 questions from LIFE_FINANCIAL section, conditional on LIFE_TYPE)
- QuestionGroup: "dnt_life_investment" — Investment preferences (3 questions from LIFE_INVESTMENT section, conditional)
- QuestionGroup: "dnt_sustainability" — Sustainability preferences (2 questions from SUSTAINABILITY section)
- QuestionGroup: "application" — Application/health declaration questions
- QuestionGroup: "bd_medical" — 6 BD medical yes/no questions (from medical-questionnaire.json)
- Only LIFE-relevant DNT sections seeded. AUTO/HEALTH/TRAVEL/PROPERTY/CIVIL_LIABILITY sections from extraction are NOT seeded (Protect is life insurance only).
- All Question records with bilingual text, type, options, validation rules, branching logic

**DNT signing metadata:** V1 tracked signing state on a dedicated DNT model (signedAt, signatureIP, signatureUserAgent, pdfPath, validFrom, expiresAt). In V2, DNT signing metadata is stored in `WorkflowSession.data` Json when the workflow reaches the dnt-sign step. This includes: signedAt, signatureIP, signatureUserAgent, and the generated pdfPath. The workflow step transition from dnt-sign validates that signing is complete before allowing progression.

### 6.3 seed-objections.ts

Source: `extraction/playbook/objection-handling-ro.md`

Seeds 9 ObjectionStrategy records:
1. price_base — "Prețul e prea mare"
2. price_addon — "BD-ul e prea scump"
3. price_total — "Total prea mult"
4. no_need — "Nu am nevoie"
5. have_insurance — "Am deja asigurare"
6. need_to_think — "Trebuie să mă gândesc"
7. no_trust — "Nu am încredere în asigurări"
8. low_benefit — "Suma asigurată e prea mică"
9. competitor — "Am văzut ceva mai ieftin"

Strategy text ported verbatim from extraction. No edits.

### 6.4 seed-workflows.ts

Source: V1's `seed-workflows.ts`

Seeds:
- Workflow: "product-discovery" (Sales Journey) — 2 steps, transitions
- Workflow: "life-insurance-purchase" — 10 steps (check-dnt → dnt-questionnaire → dnt-sign → check-application → start-application → resume-prompt → fill-application → generate-quote → review-quote → completed), ~15 transitions with conditions

### 6.5 seed-agents.ts

Source: V1's `seed-agents.ts` + build plan Section 5

Seeds 4 Agent configs:

| Slug | Type | Provider | Model | Fallback | Temp | MaxTokens |
|------|------|----------|-------|----------|------|-----------|
| main-chat | MAIN_CHAT | OPENAI | gpt-5.2 | claude-sonnet-4-20250514 | 0.7 | 4096 |
| reasoning-gate | REASONING_GATE | OPENAI | gpt-5.2-mini | claude-haiku-4-5-20251001 | 0.2 | 1024 |
| summarizer | SUMMARIZER | OPENAI | gpt-5.2-mini | claude-haiku-4-5-20251001 | 0.3 | 2048 |
| profile-extractor | PROFILE_EXTRACTOR | OPENAI | gpt-5.2-mini | claude-haiku-4-5-20251001 | 0.1 | 1024 |

System prompts ported from V1 extraction, adapted for V2 (remove V1-specific references, update capability manifest).

### 6.6 seed-model-catalog.ts

Seeds ModelCatalog with available models:

| Provider | Model ID | Display Name | Streaming | Tools | Structured |
|----------|----------|-------------|-----------|-------|------------|
| OPENAI | gpt-5.2 | GPT-5.2 | true | true | true |
| OPENAI | gpt-5.2-mini | GPT-5.2 Mini | true | true | true |
| ANTHROPIC | claude-opus-4-6 | Claude Opus 4.6 | true | true | true |
| ANTHROPIC | claude-sonnet-4-6 | Claude Sonnet 4.6 | true | true | true |
| ANTHROPIC | claude-sonnet-4-20250514 | Claude Sonnet 4 | true | true | true |
| ANTHROPIC | claude-haiku-4-5-20251001 | Claude Haiku 4.5 | true | true | true |

Cost data included per model for turn trace cost calculation.

## 7. Naming conventions

| What | Convention | Example |
|------|-----------|---------|
| Files | kebab-case | seed-product.ts, quote-engine.ts |
| DB models | PascalCase | PricingLevel, WorkflowStep |
| Enums | SCREAMING_SNAKE_CASE | PENDING_SUBMISSION |
| Tool names | snake_case | save_dnt_answer |
| TypeScript types | PascalCase | CustomerProfile |
| Constants | SCREAMING_SNAKE_CASE | MAX_MESSAGES_IN_WINDOW |
| CSS variables | kebab-case with --color- prefix | --color-forest |

## 8. Docker Compose

```yaml
services:
  db:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: zeno
      POSTGRES_PASSWORD: zeno_dev
      POSTGRES_DB: zeno
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

## 9. Exit criteria

A1 is complete when:

- [ ] `docker compose up -d` starts Postgres
- [ ] `npx prisma db push` applies schema without errors
- [ ] `npx prisma db seed` populates all data
- [ ] Prisma Studio shows: 1 product, 2 tiers, 6 levels, 72+ coverage amounts (54 age-banded death + 18 fixed per-level for other types), 1 addon with 4 pricing rules, 9 objections, 2 workflows, 12 steps, 15 transitions, 4 agents, 6+ models in catalog, 8 question groups with all questions
- [ ] `npm run dev` starts Next.js without errors
- [ ] `npx tsc --noEmit` passes (zero type errors)
- [ ] Tailwind config includes all Zeno brand tokens
- [ ] No dead code, no placeholder stubs, no empty files

## 10. Out of scope

- LLM SDKs and API calls (Slice A2)
- API routes (Slice A2-A4)
- Tool pipeline, streaming, prompt assembly (Slice A2-A3)
- UI components and pages (Phase B)
- Auth (Phase B)
- Payment integration (Phase B)
- Email system (Phase B)
- Testing framework (set up with A2 when there's logic to test)
