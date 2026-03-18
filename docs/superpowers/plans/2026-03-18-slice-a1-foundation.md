# Slice A1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working Next.js 15 project with Docker Postgres, 27-model Prisma schema, and all seed data ported from V1 extraction files.

**Architecture:** Next.js 15 App Router with TypeScript strict mode. PostgreSQL 16 via Docker Compose. Prisma ORM for schema and seeding. Tailwind CSS extended with Zeno brand tokens from the brand book.

**Tech Stack:** Next.js 15, TypeScript 5.7+, Prisma (latest), PostgreSQL 16, Tailwind CSS, shadcn/ui, Zod, Docker Compose

**Spec:** `docs/superpowers/specs/2026-03-17-slice-a1-foundation-design.md`

**Extraction source:** `C:/GitHub/ai_sales_agent_crm/extraction/`

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies and scripts |
| `tsconfig.json` | TypeScript strict config |
| `next.config.ts` | Next.js 15 config |
| `docker-compose.yml` | PostgreSQL 16 container |
| `.env.example` | Environment template |
| `.env` | Local environment (gitignored) |
| `.gitignore` | Git ignore rules |
| `tailwind.config.ts` | Zeno brand tokens |
| `app/globals.css` | Global styles with CSS variables |
| `app/layout.tsx` | Root layout with Inter + Fraunces fonts |
| `app/page.tsx` | Placeholder landing page |
| `lib/db.ts` | Prisma client singleton |
| `prisma/schema.prisma` | 27 models, 10 enums |
| `prisma/seeds/index.ts` | Seed orchestrator |
| `prisma/seeds/seed-product.ts` | Product, tiers, levels, coverages, addon |
| `prisma/seeds/seed-questions.ts` | DNT, application, BD medical questions |
| `prisma/seeds/seed-objections.ts` | 9 objection strategies |
| `prisma/seeds/seed-workflows.ts` | 2 workflows, 12 steps, 15 transitions |
| `prisma/seeds/seed-agents.ts` | 4 agent configs with prompts |
| `prisma/seeds/seed-model-catalog.ts` | LLM model catalog |
| `public/brand/.gitkeep` | Brand assets directory (SVGs added in Phase B) |
| `components.json` | shadcn/ui config |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `.env.example`, `.env`, `docker-compose.yml`, `lib/db.ts`

- [ ] **Step 1: Create Next.js 15 project**

Run:
```bash
cd C:/GitHub/v2_ai_sales_agent
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --turbopack --yes
```

If directory is not empty, the tool may prompt. Answer yes to proceed in existing directory.

- [ ] **Step 2: Install additional dependencies**

Run:
```bash
npm install prisma @prisma/client zod
npm install -D tsx
```

- [ ] **Step 3: Create docker-compose.yml**

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

- [ ] **Step 4: Create .env.example and .env**

`.env.example`:
```
DATABASE_URL="postgresql://zeno:zeno_dev@localhost:5432/zeno?schema=public"
```

`.env` (same content, gitignored):
```
DATABASE_URL="postgresql://zeno:zeno_dev@localhost:5432/zeno?schema=public"
```

- [ ] **Step 5: Update .gitignore**

Append to existing .gitignore:
```
.env
.env.local
```

- [ ] **Step 6: Create Prisma client singleton**

`lib/db.ts`:
```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 7: Add seed script to package.json**

Add to `package.json`:
```json
{
  "prisma": {
    "seed": "tsx prisma/seeds/index.ts"
  }
}
```

- [ ] **Step 8: Start Docker and verify Postgres**

Run:
```bash
docker compose up -d
```
Expected: Postgres container running on port 5432.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js 15 project with Docker Postgres"
```

---

## Task 2: Prisma Schema

**Files:**
- Create: `prisma/schema.prisma`

This is the complete 26-model schema. Write it as one file since Prisma schemas are a single unit.

- [ ] **Step 1: Initialize Prisma**

Run:
```bash
npx prisma init --datasource-provider postgresql
```

This creates `prisma/schema.prisma` with defaults. We will overwrite it.

- [ ] **Step 2: Write complete schema**

Overwrite `prisma/schema.prisma` with the complete schema from the spec. All 26 models, 11 enums, all relations, all indexes. The full schema content follows:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ==========================================
// ENUMS
// ==========================================

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

// ==========================================
// DOMAIN: CORE PRODUCT
// ==========================================

model Product {
  id                      String   @id @default(cuid())
  code                    String   @unique
  name                    Json     // { en, ro }
  description             Json     // { en, ro }
  insuranceType           String   // "LIFE"
  subType                 String   // "term_life"
  eligibility             Json     // { minAge, maxAge, residency, healthRequirements, notes }
  features                String[]
  exclusions              String[]
  defaultPlaybook         String   @db.Text
  pricingExplanation      String   @db.Text
  targetCustomer          String
  targetAgeRange          String
  contractTerm            String
  gracePeriod             String
  medicalExamRequired     Boolean  @default(false)
  territoryCoverage       String
  premiumRange            Json?    // { min, max, currency, frequency }
  paymentFrequencyOptions Json?    // [{ code, multiplier }]
  quoteValidityDays       Int      @default(30)
  isActive                Boolean  @default(true)
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt

  pricingTiers        PricingTier[]
  addons              Addon[]
  questionGroups      QuestionGroup[]
  objectionStrategies ObjectionStrategy[]
  conversations       Conversation[]
  applications        Application[]
  quotes              Quote[]
  policies            Policy[]
}

model PricingTier {
  id          String   @id @default(cuid())
  productId   String
  code        String
  name        Json     // { en, ro }
  description Json?
  orderIndex  Int
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  product      Product        @relation(fields: [productId], references: [id])
  levels       PricingLevel[]
  applications Application[]

  @@unique([productId, code])
}

model PricingLevel {
  id            String   @id @default(cuid())
  tierId        String
  code          String
  name          Json     // { en, ro }
  premiumAnnual Float
  currency      String   @default("RON")
  orderIndex    Int
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  tier            PricingTier      @relation(fields: [tierId], references: [id])
  coverageAmounts CoverageAmount[]
  applications    Application[]

  @@unique([tierId, code])
}

model CoverageType {
  id             String   @id @default(cuid())
  code           String   @unique
  name           Json     // { en, ro }
  description    Json?
  category       String?  // "life", "accident", "health"
  unit           String?  // "lump_sum", "per_day"
  maxUnits       Int?     // e.g. 90 max days
  deductibleDays Int?     // e.g. 3-day deductible
  createdAt      DateTime @default(now())

  coverageAmounts CoverageAmount[]
}

model CoverageAmount {
  id              String   @id @default(cuid())
  coverageTypeId  String
  pricingLevelId  String?
  addonId         String?
  amount          Float
  currency        String   @default("RON")
  isAgeBased      Boolean  @default(false)
  minAge          Int?
  maxAge          Int?
  createdAt       DateTime @default(now())

  coverageType CoverageType  @relation(fields: [coverageTypeId], references: [id])
  pricingLevel PricingLevel? @relation(fields: [pricingLevelId], references: [id])
  addon        Addon?        @relation(fields: [addonId], references: [id])

  @@index([coverageTypeId, pricingLevelId])
  @@index([coverageTypeId, addonId])
}

model Addon {
  id            String   @id @default(cuid())
  productId     String
  code          String
  name          Json     // { en, ro }
  description   Json?
  waitingPeriod String?  // "180 days"
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  product         Product            @relation(fields: [productId], references: [id])
  pricingRules    AddonPricingRule[]
  coverageAmounts CoverageAmount[]

  @@unique([productId, code])
}

model AddonPricingRule {
  id            String   @id @default(cuid())
  addonId       String
  minAge        Int
  maxAge        Int
  premiumAnnual Float
  currency      String   @default("RON")
  createdAt     DateTime @default(now())

  addon Addon @relation(fields: [addonId], references: [id])

  @@index([addonId, minAge, maxAge])
}

model ObjectionStrategy {
  id           String   @id @default(cuid())
  productId    String
  type         String
  title        String
  strategy     String   @db.Text
  addonContext String?  @db.Text
  orderIndex   Int      @default(0)
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  product Product @relation(fields: [productId], references: [id])

  @@unique([productId, type])
}

// ==========================================
// DOMAIN: CONVERSATION AND SALES
// ==========================================

model Customer {
  id               String    @id @default(cuid())
  email            String?   @unique
  phone            String?
  name             String?
  dateOfBirth      DateTime?
  cnp              String?   // encrypted at app level
  address          Json?     // { street, city, county, postalCode }
  language         String    @default("ro")
  extractedProfile Json?     // demographics from profile-extractor
  isAnonymous      Boolean   @default(true)
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  conversations     Conversation[]
  applications      Application[]
  quotes            Quote[]
  policies          Policy[]
  payments          Payment[]
  referralsMade     Referral[] @relation("referrer")
  referralsReceived Referral[] @relation("referred")
}

model Conversation {
  id             String             @id @default(cuid())
  customerId     String
  productId      String?
  status         ConversationStatus @default(ACTIVE)
  channel        String             @default("web")
  language       String             @default("ro")
  messageCount   Int                @default(0)
  startedAt      DateTime           @default(now())
  completedAt    DateTime?
  lastActivityAt DateTime           @default(now())
  metadata       Json?
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt

  customer        Customer             @relation(fields: [customerId], references: [id])
  product         Product?             @relation(fields: [productId], references: [id])
  messages        Message[]
  workflowSession WorkflowSession?
  summary         ConversationSummary?
  answers         Answer[]
  application     Application?
  turnTraces      TurnTrace[]
}

model Message {
  id             String   @id @default(cuid())
  conversationId String
  role           String   // "user", "assistant", "system"
  content        String   @db.Text
  toolCalls      Json?
  toolResults    Json?
  tokenCount     Int?
  createdAt      DateTime @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id])

  @@index([conversationId, createdAt])
}

model ConversationSummary {
  id             String   @id @default(cuid())
  conversationId String   @unique
  summary        String   @db.Text
  messagesUpTo   Int
  tokenCount     Int?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  conversation Conversation @relation(fields: [conversationId], references: [id])
}

// ==========================================
// DOMAIN: WORKFLOW AND QUESTIONNAIRE
// ==========================================

model Workflow {
  id          String   @id @default(cuid())
  code        String   @unique
  name        String
  description String?
  isActive    Boolean  @default(true)
  version     Int      @default(1)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  steps    WorkflowStep[]
  sessions WorkflowSession[]
}

model WorkflowStep {
  id                String   @id @default(cuid())
  workflowId        String
  code              String
  name              String
  type              String   // "INTERACTIVE", "AUTO", "DECISION"
  orderIndex        Int
  autoTool          String?
  allowedTools      String[]
  agentInstructions String?  @db.Text
  uiAction          String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  workflow         Workflow          @relation(fields: [workflowId], references: [id])
  transitionsFrom  StepTransition[]  @relation("fromStep")
  transitionsTo    StepTransition[]  @relation("toStep")
  workflowSessions WorkflowSession[]

  @@unique([workflowId, code])
}

model StepTransition {
  id             String   @id @default(cuid())
  fromStepId     String
  toStepId       String
  conditionType  String   // "TOOL_RESULT", "DATA_CHECK"
  conditionValue String
  label          String?
  priority       Int      @default(0)
  createdAt      DateTime @default(now())

  fromStep WorkflowStep @relation("fromStep", fields: [fromStepId], references: [id])
  toStep   WorkflowStep @relation("toStep", fields: [toStepId], references: [id])
}

model WorkflowSession {
  id             String                @id @default(cuid())
  workflowId     String
  currentStepId  String
  conversationId String                @unique
  status         WorkflowSessionStatus @default(ACTIVE)
  data           Json?
  createdAt      DateTime              @default(now())
  updatedAt      DateTime              @updatedAt

  workflow     Workflow     @relation(fields: [workflowId], references: [id])
  currentStep  WorkflowStep @relation(fields: [currentStepId], references: [id])
  conversation Conversation @relation(fields: [conversationId], references: [id])
}

model QuestionGroup {
  id          String   @id @default(cuid())
  code        String   @unique
  name        Json     // { en, ro }
  productId   String?
  description String?
  orderIndex  Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  product   Product?   @relation(fields: [productId], references: [id])
  questions Question[]
}

model Question {
  id               String   @id @default(cuid())
  groupId          String
  text             Json     // { en, ro }
  helpText         Json?    // { en, ro }
  type             String   // "BOOLEAN", "MULTIPLE_CHOICE", "DROPDOWN", "MULTI_SELECT", "OPEN_ENDED", "NUMBER", "DATE"
  options          Json?    // [{ value, label: { en, ro } }]
  validationRules  Json?    // { required, min, max, pattern }
  parentQuestionId String?
  showWhenValue    String?
  orderIndex       Int
  isRequired       Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  group          QuestionGroup @relation(fields: [groupId], references: [id])
  parentQuestion Question?     @relation("questionBranching", fields: [parentQuestionId], references: [id])
  childQuestions Question[]    @relation("questionBranching")
  answers        Answer[]

  @@index([groupId, orderIndex])
}

model Answer {
  id             String   @id @default(cuid())
  questionId     String
  conversationId String
  value          String
  answeredAt     DateTime @default(now())

  question     Question     @relation(fields: [questionId], references: [id])
  conversation Conversation @relation(fields: [conversationId], references: [id])

  @@unique([questionId, conversationId])
}

// ==========================================
// DOMAIN: QUOTE AND POLICY
// ==========================================

model Application {
  id                   String            @id @default(cuid())
  conversationId       String            @unique
  customerId           String
  productId            String
  tierId               String?
  levelId              String?
  includesAddon        Boolean           @default(false)
  status               ApplicationStatus @default(OPEN)
  currentQuestionIndex Int               @default(0)
  totalQuestions        Int               @default(0)
  completedAt          DateTime?
  createdAt            DateTime          @default(now())
  updatedAt            DateTime          @updatedAt

  conversation Conversation  @relation(fields: [conversationId], references: [id])
  customer     Customer      @relation(fields: [customerId], references: [id])
  product      Product       @relation(fields: [productId], references: [id])
  tier         PricingTier?  @relation(fields: [tierId], references: [id])
  level        PricingLevel? @relation(fields: [levelId], references: [id])
  quote        Quote?
}

model Quote {
  id             String      @id @default(cuid())
  applicationId  String      @unique
  productId      String
  customerId     String
  premiumAnnual  Float
  premiumMonthly Float
  currency       String      @default("RON")
  coverages      Json        // [{ type, amount, currency }]
  addonsSelected Json?       // [{ code, premiumAnnual }]
  status         QuoteStatus @default(DRAFT)
  validUntil     DateTime
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  application Application @relation(fields: [applicationId], references: [id])
  product     Product     @relation(fields: [productId], references: [id])
  customer    Customer    @relation(fields: [customerId], references: [id])
  policy      Policy?
}

model Policy {
  id                  String       @id @default(cuid())
  quoteId             String       @unique
  customerId          String
  productId           String
  allianzPolicyNumber String?
  status              PolicyStatus @default(PENDING_SUBMISSION)
  effectiveFrom       DateTime?
  effectiveUntil      DateTime?
  premiumAnnual       Float
  premiumMonthly      Float
  currency            String       @default("RON")
  coverageSummary     Json
  issuedAt            DateTime?
  createdAt           DateTime     @default(now())
  updatedAt           DateTime     @updatedAt

  quote    Quote     @relation(fields: [quoteId], references: [id])
  customer Customer  @relation(fields: [customerId], references: [id])
  product  Product   @relation(fields: [productId], references: [id])
  payments Payment[]
}

model Payment {
  id                String        @id @default(cuid())
  policyId          String
  customerId        String
  amount            Float
  currency          String        @default("RON")
  provider          PaymentProvider
  providerPaymentId String?
  status            PaymentStatus @default(PENDING)
  paidAt            DateTime?
  metadata          Json?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt

  policy   Policy   @relation(fields: [policyId], references: [id])
  customer Customer @relation(fields: [customerId], references: [id])
}

// ==========================================
// DOMAIN: AGENT AND OBSERVABILITY
// ==========================================

model Agent {
  id               String      @id @default(cuid())
  slug             String      @unique
  name             String
  type             AgentType
  provider         LLMProvider  @default(OPENAI)
  model            String
  fallbackProvider LLMProvider? @default(ANTHROPIC)
  fallbackModel    String?
  temperature      Float       @default(0.7)
  maxTokens        Int         @default(4096)
  systemPrompt     String?     @db.Text
  constraints      String?     @db.Text
  isActive         Boolean     @default(true)
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt
}

model ModelCatalog {
  id                       String      @id @default(cuid())
  provider                 LLMProvider
  modelId                  String
  displayName              String
  supportsStreaming         Boolean     @default(true)
  supportsTools            Boolean     @default(true)
  supportsStructuredOutput Boolean     @default(true)
  costPer1kInputTokens     Float
  costPer1kOutputTokens    Float
  isActive                 Boolean     @default(true)
  createdAt                DateTime    @default(now())
  updatedAt                DateTime    @updatedAt

  @@unique([provider, modelId])
}

model TurnTrace {
  id             String   @id @default(cuid())
  conversationId String
  messageIndex   Int
  phases         Json
  anomalies      Json?
  inputTokens    Int?
  outputTokens   Int?
  cost           Float?
  latencyMs      Int?
  provider       String?
  model          String?
  createdAt      DateTime @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id])

  @@index([conversationId, messageIndex])
}

model Referral {
  id                  String   @id @default(cuid())
  referrerCustomerId  String
  referredCustomerId  String?
  code                String   @unique
  status              String   @default("pending")
  rewardApplied       Boolean  @default(false)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  referrer Customer  @relation("referrer", fields: [referrerCustomerId], references: [id])
  referred Customer? @relation("referred", fields: [referredCustomerId], references: [id])
}
```

- [ ] **Step 3: Push schema to database**

Run:
```bash
npx prisma db push
```
Expected: Schema applied successfully, all 26 models created.

- [ ] **Step 4: Generate Prisma client**

Run:
```bash
npx prisma generate
```
Expected: Client generated successfully.

- [ ] **Step 5: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma lib/db.ts
git commit -m "feat: add complete Prisma schema with 26 models and 11 enums"
```

---

## Task 3: Seed — Product Data

**Files:**
- Create: `prisma/seeds/seed-product.ts`

This is the most complex seed. All data comes from `C:/GitHub/ai_sales_agent_crm/extraction/product/product-catalog.json`.

- [ ] **Step 1: Write seed-product.ts**

```typescript
import { PrismaClient } from '@prisma/client'

export async function seedProduct(prisma: PrismaClient) {
  console.log('Seeding product data...')

  // 1. Coverage Types (catalog)
  const coverageTypes = [
    {
      code: 'DEATH_ANY_CAUSE',
      name: { en: 'Death from any cause', ro: 'Deces din orice cauza' },
      description: { en: 'Lump sum payment to beneficiaries upon death from any cause', ro: 'Plata sumei forfetare catre beneficiari in caz de deces din orice cauza' },
      category: 'life',
      unit: 'lump_sum',
    },
    {
      code: 'PERMANENT_INVALIDITY_ACCIDENT',
      name: { en: 'Permanent invalidity from accident', ro: 'Invaliditate permanenta din accident' },
      description: { en: 'Coverage for permanent disability resulting from accidents', ro: 'Acoperire pentru invaliditate permanenta rezultata din accidente' },
      category: 'accident',
      unit: 'lump_sum',
    },
    {
      code: 'SURGICAL_INTERVENTION_ACCIDENT',
      name: { en: 'Surgical intervention from accident', ro: 'Interventie chirurgicala din accident' },
      description: { en: 'Coverage for surgical procedures needed due to accidents', ro: 'Acoperire pentru interventii chirurgicale necesare din cauza accidentelor' },
      category: 'accident',
      unit: 'lump_sum',
    },
    {
      code: 'HOSPITALIZATION_ACCIDENT',
      name: { en: 'Hospitalization from accident', ro: 'Spitalizare din accident' },
      description: { en: 'Daily indemnity during hospitalization due to accident', ro: 'Indemnizatie zilnica pe durata spitalizarii din cauza accidentului' },
      category: 'accident',
      unit: 'per_day',
      maxUnits: 90,
      deductibleDays: 3,
    },
    // Addon coverage types
    {
      code: 'TREATMENT_COSTS',
      name: { en: 'Medical treatment abroad', ro: 'Tratament medical in strainatate' },
      description: { en: 'Coverage for medical treatment at top clinics worldwide', ro: 'Acoperire pentru tratament medical in clinici de top din intreaga lume' },
      category: 'health',
      unit: 'lump_sum',
    },
    {
      code: 'HOSPITALIZATION_ABROAD',
      name: { en: 'Hospitalization abroad', ro: 'Spitalizare in strainatate' },
      description: { en: 'Daily indemnity during hospitalization abroad', ro: 'Indemnizatie zilnica pe durata spitalizarii in strainatate' },
      category: 'health',
      unit: 'per_day',
      maxUnits: 60,
    },
    {
      code: 'POST_TREATMENT_MEDICATION',
      name: { en: 'Post-treatment medication', ro: 'Medicatie post-tratament' },
      description: { en: 'Coverage for medication after treatment abroad', ro: 'Acoperire pentru medicatie dupa tratamentul in strainatate' },
      category: 'health',
      unit: 'lump_sum',
    },
  ]

  for (const ct of coverageTypes) {
    await prisma.coverageType.upsert({
      where: { code: ct.code },
      update: ct,
      create: ct,
    })
  }

  // 2. Product
  const product = await prisma.product.upsert({
    where: { code: 'protect' },
    update: {},
    create: {
      code: 'protect',
      name: { en: 'Protect', ro: 'Protect' },
      description: {
        en: 'Term life insurance with accident coverage and optional medical treatment abroad for severe conditions. Two packages available: Standard and Optim.',
        ro: 'Asigurare de viata pe termen cu acoperire de accidente si optional tratament medical in strainatate pentru afectiuni grave. Doua pachete disponibile: Standard si Optim.',
      },
      insuranceType: 'LIFE',
      subType: 'term_life',
      eligibility: {
        minAge: 18,
        maxAge: 64,
        residency: 'Romania',
        healthRequirements: 'Simplified health declaration',
        notes: 'Maximum cumulative sum at risk across all life policies: 50,000 EUR',
      },
      features: [
        'Two packages: Standard and Optim',
        'Three premium levels per package (I, II, III)',
        'Death from any cause coverage',
        'Permanent invalidity from accident coverage',
        'Surgical intervention from accident coverage',
        'Hospitalization from accident coverage',
        'Worldwide territorial coverage',
        '1-year contract with automatic renewal',
        '60-day grace period for premium payment',
        'No medical examination for base product',
        'Optional: Medical Treatment Abroad (BD) up to 2M EUR',
      ],
      exclusions: [
        'See Protect insurance conditions for detailed exclusions',
        'BD addon excludes treatment in Romania, Japan, Switzerland, USA',
        'BD addon requires passing 6-question medical questionnaire',
        'Maximum cumulative sum at risk across all life policies: 50,000 EUR',
      ],
      defaultPlaybook: `PRODUCT: Protect - Life Insurance with Medical Treatment Abroad

SALES APPROACH:
This is a simple, affordable product. The selling cycle should be SHORT - one conversation to close.

KEY VALUE PROPOSITION:
- Lead with the Medical Treatment Abroad (BD) addon - this is the differentiator
- EUR 2M coverage for cancer, cardiovascular surgery, neurosurgery, and transplants at top clinics worldwide
- The base life insurance is the vehicle, the BD addon is the destination
- Frame it: For the price of a coffee per week, your family is protected AND you have access to EUR 2M in world-class medical treatment

PACKAGE SELECTION:
- Budget-conscious: Standard Level I (190 RON/year)
- Balanced: Standard Level II or Optim Level I
- Maximum protection: Optim Level III (430 RON/year)
- ALWAYS suggest adding BD addon

OBJECTION HANDLING: Use get_objection_strategy tool for all customer objections. Do not improvise - the tool has tested, product-specific strategies.

BD ADDON MEDICAL QUESTIONNAIRE:
- 6 YES/NO health questions required
- ANY yes answer means BD addon is REJECTED
- If rejected, still offer base Protect
- Be sensitive about health disclosures`,
      pricingExplanation: 'Protect has a simple pricing structure. TWO PACKAGES (Standard and Optim) determine accident coverage levels. THREE PREMIUM LEVELS (I, II, III) determine the death benefit amount. Higher premium = higher death benefit. Death benefit also varies by age (younger = higher). Annual premiums: Standard I=190, II=290, III=390 RON. Optim I=230, II=330, III=430 RON. If adding Medical Treatment Abroad (BD), additional premium applies. Payment: annual, semi-annual, or quarterly. 60-day grace period.',
      targetCustomer: 'Young active individuals 25-45, medium+ income, families with dependents, employed professionals',
      targetAgeRange: '25-45',
      contractTerm: '1-year with automatic renewal',
      gracePeriod: '60 days for premium payment',
      medicalExamRequired: false,
      territoryCoverage: 'Worldwide',
      premiumRange: { min: 190, max: 430, currency: 'RON', frequency: 'annual' },
      paymentFrequencyOptions: [
        { code: 'annual', multiplier: 1.0, label: { en: 'Annual', ro: 'Anual' } },
        { code: 'semi_annual', multiplier: 0.5, label: { en: 'Semi-annual', ro: 'Semestrial' } },
        { code: 'quarterly', multiplier: 0.25, label: { en: 'Quarterly', ro: 'Trimestrial' } },
      ],
      quoteValidityDays: 30,
    },
  })

  // 3. Pricing Tiers
  const standardTier = await prisma.pricingTier.upsert({
    where: { productId_code: { productId: product.id, code: 'standard' } },
    update: {},
    create: {
      productId: product.id,
      code: 'standard',
      name: { en: 'Standard', ro: 'Standard' },
      description: { en: 'Standard accident coverage package', ro: 'Pachet standard de acoperire accidente' },
      orderIndex: 0,
    },
  })

  const optimTier = await prisma.pricingTier.upsert({
    where: { productId_code: { productId: product.id, code: 'optim' } },
    update: {},
    create: {
      productId: product.id,
      code: 'optim',
      name: { en: 'Optim', ro: 'Optim' },
      description: { en: 'Enhanced accident coverage package', ro: 'Pachet imbunatatit de acoperire accidente' },
      orderIndex: 1,
    },
  })

  // 4. Pricing Levels
  const levelData = [
    { tier: standardTier, code: 'level_1', name: { en: 'Level I', ro: 'Nivelul I' }, premium: 190, order: 0 },
    { tier: standardTier, code: 'level_2', name: { en: 'Level II', ro: 'Nivelul II' }, premium: 290, order: 1 },
    { tier: standardTier, code: 'level_3', name: { en: 'Level III', ro: 'Nivelul III' }, premium: 390, order: 2 },
    { tier: optimTier, code: 'level_1', name: { en: 'Level I', ro: 'Nivelul I' }, premium: 230, order: 0 },
    { tier: optimTier, code: 'level_2', name: { en: 'Level II', ro: 'Nivelul II' }, premium: 330, order: 1 },
    { tier: optimTier, code: 'level_3', name: { en: 'Level III', ro: 'Nivelul III' }, premium: 430, order: 2 },
  ]

  const levels: Record<string, { id: string; tierId: string }> = {}

  for (const ld of levelData) {
    const level = await prisma.pricingLevel.upsert({
      where: { tierId_code: { tierId: ld.tier.id, code: ld.code } },
      update: {},
      create: {
        tierId: ld.tier.id,
        code: ld.code,
        name: ld.name,
        premiumAnnual: ld.premium,
        orderIndex: ld.order,
      },
    })
    levels[`${ld.tier.code}_${ld.code}`] = { id: level.id, tierId: ld.tier.id }
  }

  // 5. Coverage Amounts — DEATH_ANY_CAUSE (age-banded, per level)
  const deathCovType = await prisma.coverageType.findUniqueOrThrow({ where: { code: 'DEATH_ANY_CAUSE' } })

  // Age bands: same death amounts for Standard and Optim at same level
  const deathAmounts: Record<string, number[]> = {
    // [18-25, 26-30, 31-35, 36-40, 41-45, 46-50, 51-55, 56-60, 61-64]
    level_1: [40000, 30000, 22000, 16000, 10000, 6000, 4000, 3000, 2000],
    level_2: [64000, 52000, 40000, 29000, 18000, 11000, 7500, 5500, 3500],
    level_3: [85000, 69000, 54000, 40000, 26000, 16000, 11000, 8000, 5000],
  }

  const ageBands = [
    { min: 18, max: 25 },
    { min: 26, max: 30 },
    { min: 31, max: 35 },
    { min: 36, max: 40 },
    { min: 41, max: 45 },
    { min: 46, max: 50 },
    { min: 51, max: 55 },
    { min: 56, max: 60 },
    { min: 61, max: 64 },
  ]

  // Delete existing death coverage amounts to avoid duplicates on re-seed
  await prisma.coverageAmount.deleteMany({
    where: { coverageTypeId: deathCovType.id, pricingLevelId: { not: null } },
  })

  for (const [levelCode, amounts] of Object.entries(deathAmounts)) {
    // Same amounts for standard and optim at same level code
    for (const tierCode of ['standard', 'optim']) {
      const levelKey = `${tierCode}_${levelCode}`
      const level = levels[levelKey]
      if (!level) continue

      for (let i = 0; i < ageBands.length; i++) {
        await prisma.coverageAmount.create({
          data: {
            coverageTypeId: deathCovType.id,
            pricingLevelId: level.id,
            amount: amounts[i],
            currency: 'RON',
            isAgeBased: true,
            minAge: ageBands[i].min,
            maxAge: ageBands[i].max,
          },
        })
      }
    }
  }

  // 6. Coverage Amounts — Fixed per tier (PERMANENT_INVALIDITY, SURGICAL, HOSPITALIZATION)
  const fixedCoverages = [
    { code: 'PERMANENT_INVALIDITY_ACCIDENT', standard: 10000, optim: 20000 },
    { code: 'SURGICAL_INTERVENTION_ACCIDENT', standard: 4000, optim: 6000 },
    { code: 'HOSPITALIZATION_ACCIDENT', standard: 20, optim: 30 },
  ]

  for (const fc of fixedCoverages) {
    const covType = await prisma.coverageType.findUniqueOrThrow({ where: { code: fc.code } })

    // Delete existing to avoid duplicates
    await prisma.coverageAmount.deleteMany({
      where: { coverageTypeId: covType.id, pricingLevelId: { not: null } },
    })

    // Standard levels all get the same fixed amount
    for (const levelCode of ['level_1', 'level_2', 'level_3']) {
      const sLevel = levels[`standard_${levelCode}`]
      await prisma.coverageAmount.create({
        data: {
          coverageTypeId: covType.id,
          pricingLevelId: sLevel.id,
          amount: fc.standard,
          currency: 'RON',
        },
      })

      const oLevel = levels[`optim_${levelCode}`]
      await prisma.coverageAmount.create({
        data: {
          coverageTypeId: covType.id,
          pricingLevelId: oLevel.id,
          amount: fc.optim,
          currency: 'RON',
        },
      })
    }
  }

  // 7. Addon — BD (Medical Treatment Abroad)
  const addon = await prisma.addon.upsert({
    where: { productId_code: { productId: product.id, code: 'bd_medical_treatment_abroad' } },
    update: {},
    create: {
      productId: product.id,
      code: 'bd_medical_treatment_abroad',
      name: { en: 'Medical Treatment Abroad (BD)', ro: 'Tratament Medical in Strainatate (BD)' },
      description: {
        en: 'Access to medical treatment at top clinics worldwide for severe conditions including cancer, cardiovascular surgery, neurosurgery, and organ transplants. Coverage up to 2,000,000 EUR.',
        ro: 'Acces la tratament medical in clinici de top din intreaga lume pentru afectiuni grave inclusiv cancer, chirurgie cardiovasculara, neurochirurgie si transplant de organe. Acoperire pana la 2.000.000 EUR.',
      },
      waitingPeriod: '180 days',
    },
  })

  // 8. Addon Pricing Rules (4 age bands from product-catalog.json)
  await prisma.addonPricingRule.deleteMany({ where: { addonId: addon.id } })

  const addonPricing = [
    { minAge: 18, maxAge: 30, premiumAnnual: 200 },
    { minAge: 31, maxAge: 45, premiumAnnual: 350 },
    { minAge: 46, maxAge: 55, premiumAnnual: 500 },
    { minAge: 56, maxAge: 64, premiumAnnual: 700 },
  ]

  for (const ap of addonPricing) {
    await prisma.addonPricingRule.create({
      data: { addonId: addon.id, ...ap, currency: 'RON' },
    })
  }

  // 9. Addon Coverage Amounts (fixed, not tied to pricing levels)
  await prisma.coverageAmount.deleteMany({ where: { addonId: addon.id } })

  const addonCoverages = [
    { code: 'TREATMENT_COSTS', amount: 2000000, currency: 'EUR' },
    { code: 'HOSPITALIZATION_ABROAD', amount: 100, currency: 'EUR' },
    { code: 'POST_TREATMENT_MEDICATION', amount: 50000, currency: 'EUR' },
  ]

  for (const ac of addonCoverages) {
    const covType = await prisma.coverageType.findUniqueOrThrow({ where: { code: ac.code } })
    await prisma.coverageAmount.create({
      data: {
        coverageTypeId: covType.id,
        addonId: addon.id,
        amount: ac.amount,
        currency: ac.currency,
      },
    })
  }

  console.log('Product data seeded successfully.')
}
```

- [ ] **Step 2: Verify seed compiles**

Run:
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add prisma/seeds/seed-product.ts
git commit -m "feat: add product seed with tiers, levels, coverages, and BD addon"
```

---

## Task 4: Seed — Questions

**Files:**
- Create: `prisma/seeds/seed-questions.ts`

Source: `extraction/product/medical-questionnaire.json` + `extraction/product/underwriting-flow.json`

- [ ] **Step 1: Write seed-questions.ts**

```typescript
import { PrismaClient } from '@prisma/client'

export async function seedQuestions(prisma: PrismaClient) {
  console.log('Seeding questions...')

  const product = await prisma.product.findUniqueOrThrow({ where: { code: 'protect' } })

  // Helper to create a group and its questions
  async function seedGroup(
    code: string,
    name: { en: string; ro: string },
    orderIndex: number,
    productId: string | null,
    description: string | null,
    questions: Array<{
      code: string
      text: { en: string; ro: string }
      helpText?: { en: string; ro: string }
      type: string
      options?: Array<{ value: string; label: { en: string; ro: string } }>
      validationRules?: Record<string, unknown>
      isRequired?: boolean
      orderIndex: number
      parentCode?: string
      showWhenValue?: string
    }>
  ) {
    const group = await prisma.questionGroup.upsert({
      where: { code },
      update: { name, orderIndex, description },
      create: { code, name, productId, orderIndex, description },
    })

    // Delete existing questions for idempotency
    await prisma.question.deleteMany({ where: { groupId: group.id } })

    // First pass: create all questions without parent links
    const createdQuestions: Record<string, string> = {}
    for (const q of questions) {
      const created = await prisma.question.create({
        data: {
          groupId: group.id,
          text: q.text,
          helpText: q.helpText ?? null,
          type: q.type,
          options: q.options ?? null,
          validationRules: q.validationRules ?? null,
          isRequired: q.isRequired ?? true,
          orderIndex: q.orderIndex,
        },
      })
      createdQuestions[q.code] = created.id
    }

    // Second pass: set parent links
    for (const q of questions) {
      if (q.parentCode && createdQuestions[q.parentCode]) {
        await prisma.question.update({
          where: { id: createdQuestions[q.code] },
          data: {
            parentQuestionId: createdQuestions[q.parentCode],
            showWhenValue: q.showWhenValue ?? null,
          },
        })
      }
    }

    return group
  }

  // ==========================================
  // DNT CONSENT (3 questions)
  // ==========================================
  await seedGroup(
    'dnt_consent',
    { en: 'Consent', ro: 'Consimtamant' },
    0,
    null,
    'GDPR and regulatory consent questions',
    [
      {
        code: 'DNT_CONSULTATION_CONSENT',
        text: {
          en: 'Do you want the Allianz-Tiriac intermediary to provide consultation for all products according to your needs?',
          ro: 'Doriti ca intermediarul Allianz-Tiriac sa va ofere consultanta pentru toate produsele conform nevoilor dumneavoastra?',
        },
        type: 'DROPDOWN',
        options: [
          { value: 'yes_all', label: { en: 'Yes, for all products', ro: 'Da, pentru toate produsele' } },
          { value: 'no', label: { en: 'No', ro: 'Nu' } },
        ],
        orderIndex: 0,
      },
      {
        code: 'DNT_MARKETING_CONSENT',
        text: {
          en: 'Do you agree to receive marketing communications from Allianz-Tiriac?',
          ro: 'Sunteti de acord sa primiti comunicari de marketing de la Allianz-Tiriac?',
        },
        type: 'BOOLEAN',
        orderIndex: 1,
      },
      {
        code: 'DNT_ELECTRONIC_COMMUNICATION',
        text: {
          en: 'Do you agree to receive all pre-contractual correspondence exclusively electronically?',
          ro: 'Sunteti de acord sa primiti toata corespondenta pre-contractuala exclusiv in format electronic?',
        },
        type: 'BOOLEAN',
        orderIndex: 2,
      },
    ]
  )

  // ==========================================
  // DNT GENERAL (6 questions)
  // ==========================================
  await seedGroup(
    'dnt_general',
    { en: 'General Information', ro: 'Informatii Generale' },
    1,
    null,
    'General suitability questions for needs assessment',
    [
      {
        code: 'DNT_CNP',
        text: { en: 'Personal identification number (CNP)', ro: 'Cod numeric personal (CNP)' },
        type: 'OPEN_ENDED',
        validationRules: { pattern: '^[1-9]\\d{12}$', minLength: 13, maxLength: 13 },
        orderIndex: 0,
      },
      {
        code: 'DNT_INCOME_SOURCE',
        text: { en: 'Source of income', ro: 'Sursa veniturilor' },
        type: 'MULTI_SELECT',
        options: [
          { value: 'salary_pension', label: { en: 'Salary / Pension', ro: 'Salariu / Pensie' } },
          { value: 'other_sources', label: { en: 'Other sources', ro: 'Alte surse' } },
        ],
        orderIndex: 1,
      },
      {
        code: 'DNT_OCCUPATION',
        text: { en: 'Occupation', ro: 'Ocupatia' },
        type: 'DROPDOWN',
        options: [
          { value: 'employee', label: { en: 'Employee', ro: 'Angajat' } },
          { value: 'entrepreneur', label: { en: 'Entrepreneur', ro: 'Antreprenor' } },
          { value: 'freelancer', label: { en: 'Freelancer', ro: 'Liber profesionist' } },
          { value: 'unemployed', label: { en: 'Unemployed', ro: 'Fara loc de munca' } },
          { value: 'retired', label: { en: 'Retired', ro: 'Pensionar' } },
          { value: 'student', label: { en: 'Student', ro: 'Student' } },
        ],
        orderIndex: 2,
      },
      {
        code: 'DNT_FAMILY_SIZE',
        text: { en: 'Family size', ro: 'Numarul membrilor familiei' },
        type: 'DROPDOWN',
        options: [
          { value: '1', label: { en: '1 person', ro: '1 persoana' } },
          { value: '2', label: { en: '2 persons', ro: '2 persoane' } },
          { value: '3', label: { en: '3 persons', ro: '3 persoane' } },
          { value: '4', label: { en: '4 persons', ro: '4 persoane' } },
          { value: '5+', label: { en: '5 or more', ro: '5 sau mai multe' } },
        ],
        orderIndex: 3,
      },
      {
        code: 'DNT_MINOR_CHILDREN',
        text: { en: 'Number of minor children', ro: 'Numarul copiilor minori' },
        type: 'DROPDOWN',
        options: [
          { value: '0', label: { en: 'None', ro: 'Niciunul' } },
          { value: '1', label: { en: '1 child', ro: '1 copil' } },
          { value: '2', label: { en: '2 children', ro: '2 copii' } },
          { value: '3', label: { en: '3 children', ro: '3 copii' } },
          { value: '4+', label: { en: '4 or more', ro: '4 sau mai multi' } },
        ],
        orderIndex: 4,
      },
      {
        code: 'DNT_EDUCATION',
        text: { en: 'Education level', ro: 'Nivelul de educatie' },
        type: 'DROPDOWN',
        options: [
          { value: 'middle_school', label: { en: 'Middle school', ro: 'Gimnaziu' } },
          { value: 'high_school', label: { en: 'High school', ro: 'Liceu' } },
          { value: 'university', label: { en: 'University', ro: 'Universitate' } },
          { value: 'postgraduate', label: { en: 'Postgraduate', ro: 'Postuniversitar' } },
        ],
        orderIndex: 5,
      },
    ]
  )

  // ==========================================
  // DNT LIFE TYPE (1 question, branching)
  // ==========================================
  await seedGroup(
    'dnt_life_type',
    { en: 'Life Insurance Type', ro: 'Tip Asigurare de Viata' },
    2,
    product.id,
    'Life insurance subtype selection',
    [
      {
        code: 'DNT_LIFE_SUBTYPE',
        text: { en: 'What type of life insurance are you interested in?', ro: 'Ce tip de asigurare de viata va intereseaza?' },
        type: 'DROPDOWN',
        options: [
          { value: 'simple_protection', label: { en: 'Simple protection (death + accident)', ro: 'Protectie simpla (deces + accident)' } },
          { value: 'financial_protection', label: { en: 'Financial protection', ro: 'Protectie financiara' } },
          { value: 'financial_and_investment', label: { en: 'Financial protection with investment', ro: 'Protectie financiara cu componenta de investitii' } },
        ],
        orderIndex: 0,
      },
    ]
  )

  // ==========================================
  // DNT LIFE FINANCIAL (11 questions)
  // ==========================================
  await seedGroup(
    'dnt_life_financial',
    { en: 'Financial Situation', ro: 'Situatia Financiara' },
    3,
    product.id,
    'Financial situation for life insurance needs assessment',
    [
      {
        code: 'DNT_LIFE_NEEDS_PRIORITY',
        text: { en: 'Rank your insurance needs by priority (1-6)', ro: 'Clasati nevoile de asigurare in ordinea prioritatii (1-6)' },
        type: 'OPEN_ENDED',
        helpText: { en: 'Rank from 1 (most important) to 6 (least important)', ro: 'Clasati de la 1 (cel mai important) la 6 (cel mai putin important)' },
        orderIndex: 0,
      },
      {
        code: 'DNT_LIFE_FAMILY_INCOME',
        text: { en: 'Family monthly income', ro: 'Venitul lunar al familiei' },
        type: 'DROPDOWN',
        options: [
          { value: 'under_2000', label: { en: 'Under 2,000 RON', ro: 'Sub 2.000 RON' } },
          { value: '2000_5000', label: { en: '2,000 - 5,000 RON', ro: '2.000 - 5.000 RON' } },
          { value: '5000_10000', label: { en: '5,000 - 10,000 RON', ro: '5.000 - 10.000 RON' } },
          { value: 'over_10000', label: { en: 'Over 10,000 RON', ro: 'Peste 10.000 RON' } },
        ],
        orderIndex: 1,
      },
      {
        code: 'DNT_LIFE_MONTHLY_EXPENSES',
        text: { en: 'Monthly household expenses (RON)', ro: 'Cheltuieli lunare ale gospodariei (RON)' },
        type: 'NUMBER',
        validationRules: { min: 0, max: 100000 },
        orderIndex: 2,
      },
      {
        code: 'DNT_LIFE_INSURANCE_VALIDITY',
        text: { en: 'Desired insurance validity period', ro: 'Perioada dorita de valabilitate a asigurarii' },
        type: 'DROPDOWN',
        options: [
          { value: '1_4_years', label: { en: '1-4 years', ro: '1-4 ani' } },
          { value: '5_9_years', label: { en: '5-9 years', ro: '5-9 ani' } },
          { value: 'over_10_years', label: { en: 'Over 10 years', ro: 'Peste 10 ani' } },
        ],
        orderIndex: 3,
      },
      {
        code: 'DNT_LIFE_ACCIDENT_COVERAGE',
        text: { en: 'Do you want accident coverage?', ro: 'Doriti acoperire pentru accidente?' },
        type: 'BOOLEAN',
        orderIndex: 4,
      },
      {
        code: 'DNT_LIFE_ILLNESS_COVERAGE',
        text: { en: 'Do you want illness coverage?', ro: 'Doriti acoperire pentru boli?' },
        type: 'BOOLEAN',
        orderIndex: 5,
      },
      {
        code: 'DNT_LIFE_SEVERE_CONDITIONS',
        text: { en: 'Do you want coverage for severe medical conditions?', ro: 'Doriti acoperire pentru afectiuni medicale grave?' },
        type: 'BOOLEAN',
        orderIndex: 6,
      },
      {
        code: 'DNT_LIFE_INVALIDITY_COVERAGE',
        text: { en: 'Do you want invalidity coverage?', ro: 'Doriti acoperire pentru invaliditate?' },
        type: 'BOOLEAN',
        orderIndex: 7,
      },
      {
        code: 'DNT_LIFE_INDEXATION',
        text: { en: 'Do you want premium indexation?', ro: 'Doriti indexarea primei de asigurare?' },
        type: 'BOOLEAN',
        orderIndex: 8,
      },
      {
        code: 'DNT_LIFE_PAYMENT_FREQUENCY',
        text: { en: 'Preferred payment frequency', ro: 'Frecventa preferata de plata' },
        type: 'DROPDOWN',
        options: [
          { value: 'monthly', label: { en: 'Monthly', ro: 'Lunar' } },
          { value: 'quarterly', label: { en: 'Quarterly', ro: 'Trimestrial' } },
          { value: 'semi_annual', label: { en: 'Semi-annual', ro: 'Semestrial' } },
          { value: 'annual', label: { en: 'Annual', ro: 'Anual' } },
          { value: 'integral', label: { en: 'Single payment', ro: 'Plata integrala' } },
        ],
        orderIndex: 9,
      },
      {
        code: 'DNT_LIFE_BUDGET',
        text: { en: 'Budget for insurance (RON)', ro: 'Bugetul pentru asigurare (RON)' },
        type: 'NUMBER',
        validationRules: { min: 0, max: 100000 },
        orderIndex: 10,
      },
    ]
  )

  // ==========================================
  // DNT LIFE INVESTMENT (3 questions)
  // ==========================================
  await seedGroup(
    'dnt_life_investment',
    { en: 'Investment Preferences', ro: 'Preferinte de Investitii' },
    4,
    product.id,
    'Investment preferences for unit-linked life insurance',
    [
      {
        code: 'DNT_LIFE_INVEST_KNOWLEDGE',
        text: { en: 'Your knowledge of financial instruments', ro: 'Cunostintele dumneavoastra despre instrumentele financiare' },
        type: 'DROPDOWN',
        options: [
          { value: 'high', label: { en: 'High', ro: 'Ridicat' } },
          { value: 'low', label: { en: 'Low', ro: 'Scazut' } },
          { value: 'none', label: { en: 'None', ro: 'Inexistent' } },
        ],
        orderIndex: 0,
      },
      {
        code: 'DNT_LIFE_INVEST_OBJECTIVES',
        text: { en: 'Investment objectives', ro: 'Obiective de investitii' },
        type: 'MULTI_SELECT',
        options: [
          { value: 'capital_accumulation', label: { en: 'Capital accumulation', ro: 'Acumulare de capital' } },
          { value: 'periodic_income', label: { en: 'Periodic income', ro: 'Venit periodic' } },
          { value: 'partial_withdrawal', label: { en: 'Partial withdrawal', ro: 'Rascumparare partiala' } },
        ],
        orderIndex: 1,
      },
      {
        code: 'DNT_LIFE_RISK_TOLERANCE',
        text: { en: 'Risk tolerance', ro: 'Toleranta la risc' },
        type: 'DROPDOWN',
        options: [
          { value: 'none', label: { en: 'No risk', ro: 'Fara risc' } },
          { value: 'low', label: { en: 'Low risk', ro: 'Risc scazut' } },
          { value: 'moderate', label: { en: 'Moderate risk', ro: 'Risc moderat' } },
          { value: 'high', label: { en: 'High risk', ro: 'Risc ridicat' } },
        ],
        orderIndex: 2,
      },
    ]
  )

  // ==========================================
  // DNT SUSTAINABILITY (2 questions)
  // ==========================================
  await seedGroup(
    'dnt_sustainability',
    { en: 'Sustainability Preferences', ro: 'Preferinte de Sustenabilitate' },
    5,
    null,
    'Sustainability preferences for investment products',
    [
      {
        code: 'DNT_SUSTAINABILITY_IMPORTANCE',
        text: { en: 'How important is sustainability in your investment decisions?', ro: 'Cat de importanta este sustenabilitatea in deciziile dumneavoastra de investitii?' },
        type: 'DROPDOWN',
        options: [
          { value: 'not_necessary', label: { en: 'Not necessary', ro: 'Nu este necesar' } },
          { value: 'somewhat', label: { en: 'Somewhat important', ro: 'Oarecum importanta' } },
          { value: 'quite_important', label: { en: 'Quite important', ro: 'Destul de importanta' } },
          { value: 'very_important', label: { en: 'Very important', ro: 'Foarte importanta' } },
        ],
        orderIndex: 0,
      },
      {
        code: 'DNT_SUSTAINABILITY_PREFERENCE',
        text: { en: 'Sustainability preference', ro: 'Preferinta de sustenabilitate' },
        type: 'DROPDOWN',
        options: [
          { value: 'no_preference', label: { en: 'No specific preference', ro: 'Fara preferinta specifica' } },
          { value: 'specific', label: { en: 'Specific sustainability criteria', ro: 'Criterii specifice de sustenabilitate' } },
        ],
        orderIndex: 1,
      },
    ]
  )

  // ==========================================
  // APPLICATION (health declaration + package selection + payment)
  // ==========================================
  await seedGroup(
    'application',
    { en: 'Application', ro: 'Cerere' },
    6,
    product.id,
    'Application/underwriting questions for Protect product',
    [
      {
        code: 'HEALTH_DECLARATION_CONFIRM',
        text: {
          en: 'I confirm that I am in good health and have no pre-existing conditions that would affect coverage.',
          ro: 'Confirm ca sunt sanatos/sanatoasa si nu am afectiuni preexistente care ar afecta acoperirea.',
        },
        type: 'BOOLEAN',
        orderIndex: 0,
      },
      {
        code: 'PACKAGE_CHOICE',
        text: { en: 'Select your preferred package', ro: 'Selectati pachetul preferat' },
        type: 'DROPDOWN',
        options: [
          { value: 'standard', label: { en: 'Standard', ro: 'Standard' } },
          { value: 'optim', label: { en: 'Optim', ro: 'Optim' } },
        ],
        orderIndex: 1,
      },
      {
        code: 'PREMIUM_LEVEL',
        text: { en: 'Select your premium level', ro: 'Selectati nivelul primei' },
        type: 'DROPDOWN',
        options: [
          { value: 'level_1', label: { en: 'Level I', ro: 'Nivelul I' } },
          { value: 'level_2', label: { en: 'Level II', ro: 'Nivelul II' } },
          { value: 'level_3', label: { en: 'Level III', ro: 'Nivelul III' } },
        ],
        orderIndex: 2,
      },
      {
        code: 'BD_ADDON_INTEREST',
        text: {
          en: 'Would you like to add Medical Treatment Abroad (BD) coverage?',
          ro: 'Doriti sa adaugati acoperirea pentru Tratament Medical in Strainatate (BD)?',
        },
        type: 'BOOLEAN',
        orderIndex: 3,
      },
      {
        code: 'PAYMENT_FREQUENCY',
        text: { en: 'Payment frequency', ro: 'Frecventa de plata' },
        type: 'DROPDOWN',
        options: [
          { value: 'annual', label: { en: 'Annual', ro: 'Anual' } },
          { value: 'semi_annual', label: { en: 'Semi-annual', ro: 'Semestrial' } },
          { value: 'quarterly', label: { en: 'Quarterly', ro: 'Trimestrial' } },
        ],
        orderIndex: 4,
      },
    ]
  )

  // ==========================================
  // BD MEDICAL QUESTIONNAIRE (6 questions)
  // ==========================================
  await seedGroup(
    'bd_medical',
    { en: 'BD Medical Questionnaire', ro: 'Chestionar Medical BD' },
    7,
    product.id,
    'Medical questionnaire for BD (Medical Treatment Abroad) addon. Any YES = BD rejected.',
    [
      {
        code: 'BD_CANCER_HISTORY',
        text: {
          en: 'Have you ever been diagnosed with or treated for cancer, pre-cancerous conditions, or tumors?',
          ro: 'Ati fost vreodata diagnosticat(a) sau tratat(a) pentru cancer, stari pre-canceroase sau tumori?',
        },
        type: 'BOOLEAN',
        orderIndex: 0,
      },
      {
        code: 'BD_CARDIOVASCULAR',
        text: {
          en: 'Have you been diagnosed with or treated for cardiovascular conditions requiring surgery?',
          ro: 'Ati fost diagnosticat(a) sau tratat(a) pentru afectiuni cardiovasculare care necesita interventie chirurgicala?',
        },
        type: 'BOOLEAN',
        orderIndex: 1,
      },
      {
        code: 'BD_NEUROLOGICAL',
        text: {
          en: 'Have you been diagnosed with or treated for neurological conditions requiring neurosurgery?',
          ro: 'Ati fost diagnosticat(a) sau tratat(a) pentru afectiuni neurologice care necesita neurochirurgie?',
        },
        type: 'BOOLEAN',
        orderIndex: 2,
      },
      {
        code: 'BD_TRANSPLANT',
        text: {
          en: 'Have you ever required or been evaluated for organ or bone marrow transplant?',
          ro: 'Ati necesitat vreodata sau ati fost evaluat(a) pentru transplant de organe sau maduva osoasa?',
        },
        type: 'BOOLEAN',
        orderIndex: 3,
      },
      {
        code: 'BD_CHRONIC_CONDITIONS',
        text: {
          en: 'Do you have any chronic medical conditions currently under treatment?',
          ro: 'Aveti afectiuni medicale cronice aflate in prezent sub tratament?',
        },
        type: 'BOOLEAN',
        orderIndex: 4,
      },
      {
        code: 'BD_HOSPITALIZATION_RECENT',
        text: {
          en: 'Have you been hospitalized in the last 12 months for any reason other than accidents?',
          ro: 'Ati fost internat(a) in ultimele 12 luni din alte motive decat accidente?',
        },
        type: 'BOOLEAN',
        orderIndex: 5,
      },
    ]
  )

  console.log('Questions seeded successfully.')
}
```

- [ ] **Step 2: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add prisma/seeds/seed-questions.ts
git commit -m "feat: add question seeds for DNT, application, and BD medical"
```

---

## Task 5: Seed — Objection Strategies

**Files:**
- Create: `prisma/seeds/seed-objections.ts`

Source: `extraction/playbook/objection-handling-ro.md` — strategy text ported verbatim.

- [ ] **Step 1: Write seed-objections.ts**

Create `prisma/seeds/seed-objections.ts`. This file contains 9 ObjectionStrategy records with full Romanian strategy text. The strategy text is long (each is 500-2000 words of Romanian sales scripts). Port the complete text from `C:/GitHub/ai_sales_agent_crm/extraction/playbook/objection-handling-ro.md` verbatim into template literals.

Read the full content of `C:/GitHub/ai_sales_agent_crm/extraction/playbook/objection-handling-ro.md` and create the seed file with this structure:

```typescript
import { PrismaClient } from '@prisma/client'

export async function seedObjections(prisma: PrismaClient) {
  console.log('Seeding objection strategies...')

  const product = await prisma.product.findUniqueOrThrow({ where: { code: 'protect' } })

  const strategies = [
    {
      type: 'price_base',
      title: 'Pretul de baza e prea mare',
      orderIndex: 0,
      strategy: `<PASTE FULL ROMANIAN TEXT FROM EXTRACTION FOR price_base>`,
    },
    {
      type: 'price_addon',
      title: 'Addon-ul BD e prea scump',
      orderIndex: 1,
      strategy: `<PASTE FULL ROMANIAN TEXT FROM EXTRACTION FOR price_addon>`,
    },
    {
      type: 'price_total',
      title: 'Totalul e prea mare (baza + addon)',
      orderIndex: 2,
      strategy: `<PASTE FULL ROMANIAN TEXT FROM EXTRACTION FOR price_total>`,
    },
    {
      type: 'no_need',
      title: 'Nu am nevoie / Sunt sanatos',
      orderIndex: 3,
      strategy: `<PASTE FULL ROMANIAN TEXT FROM EXTRACTION FOR no_need>`,
    },
    {
      type: 'have_insurance',
      title: 'Am deja o asigurare',
      orderIndex: 4,
      strategy: `<PASTE FULL ROMANIAN TEXT FROM EXTRACTION FOR have_insurance>`,
    },
    {
      type: 'need_to_think',
      title: 'Trebuie sa ma gandesc / Sa vorbesc cu sotul/sotia',
      orderIndex: 5,
      strategy: `<PASTE FULL ROMANIAN TEXT FROM EXTRACTION FOR need_to_think>`,
    },
    {
      type: 'no_trust',
      title: 'Nu am incredere in asigurari / Asigurarile sunt o teapa',
      orderIndex: 6,
      strategy: `<PASTE FULL ROMANIAN TEXT FROM EXTRACTION FOR no_trust>`,
    },
    {
      type: 'low_benefit',
      title: 'Suma asigurata e prea mica',
      orderIndex: 7,
      strategy: `<PASTE FULL ROMANIAN TEXT FROM EXTRACTION FOR low_benefit>`,
    },
    {
      type: 'competitor',
      title: 'Am vazut mai ieftin / Mai bun in alta parte',
      orderIndex: 8,
      strategy: `<PASTE FULL ROMANIAN TEXT FROM EXTRACTION FOR competitor>`,
    },
  ]

  for (const s of strategies) {
    await prisma.objectionStrategy.upsert({
      where: { productId_type: { productId: product.id, type: s.type } },
      update: { strategy: s.strategy, title: s.title, orderIndex: s.orderIndex },
      create: { productId: product.id, ...s },
    })
  }

  console.log('Objection strategies seeded successfully.')
}
```

**IMPORTANT:** The `<PASTE FULL ROMANIAN TEXT>` placeholders must be replaced with the COMPLETE verbatim text from the extraction file. Read the file at `C:/GitHub/ai_sales_agent_crm/extraction/playbook/objection-handling-ro.md`, extract each of the 9 sections, and paste the full text into the template literals. Do not summarize or truncate.

- [ ] **Step 2: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add prisma/seeds/seed-objections.ts
git commit -m "feat: add 9 objection strategy seeds with Romanian scripts"
```

---

## Task 6: Seed — Workflows

**Files:**
- Create: `prisma/seeds/seed-workflows.ts`

Source: V1's `prisma/seed-workflows.ts` at `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/prisma/seed-workflows.ts`

- [ ] **Step 1: Write seed-workflows.ts**

Read the complete V1 workflow seed file and port it. The file defines 2 workflows with 12 total steps and ~15 transitions. Port the complete `agentInstructions` text for each step verbatim. Use upserts for idempotency.

```typescript
import { PrismaClient } from '@prisma/client'

export async function seedWorkflows(prisma: PrismaClient) {
  console.log('Seeding workflows...')

  // ==========================================
  // WORKFLOW 1: Sales Journey (Product Discovery)
  // ==========================================
  const salesJourney = await prisma.workflow.upsert({
    where: { code: 'product-discovery' },
    update: {},
    create: {
      code: 'product-discovery',
      name: 'Sales Journey',
      description: 'Initial product discovery and recommendation workflow',
    },
  })

  // Delete existing steps and transitions for idempotency
  await prisma.stepTransition.deleteMany({
    where: { fromStep: { workflowId: salesJourney.id } },
  })
  await prisma.workflowStep.deleteMany({ where: { workflowId: salesJourney.id } })

  const sjStep1 = await prisma.workflowStep.create({
    data: {
      workflowId: salesJourney.id,
      code: 'needs_discovery',
      name: 'Needs Discovery & Product Recommendation',
      type: 'INTERACTIVE',
      orderIndex: 0,
      allowedTools: [
        'list_products', 'get_product_info', 'compare_products',
        'get_customer_profile', 'update_customer_profile',
        'set_conversation_product', 'get_objection_strategy',
      ],
      agentInstructions: `<PORT FULL agentInstructions FROM V1 seed-workflows.ts FOR needs_discovery STEP>`,
    },
  })

  const sjStep2 = await prisma.workflowStep.create({
    data: {
      workflowId: salesJourney.id,
      code: 'product_confirmed',
      name: 'Product Confirmed',
      type: 'AUTO',
      orderIndex: 1,
      allowedTools: [],
      agentInstructions: `<PORT FULL agentInstructions FROM V1 FOR product_confirmed STEP>`,
    },
  })

  await prisma.stepTransition.create({
    data: {
      fromStepId: sjStep1.id,
      toStepId: sjStep2.id,
      conditionType: 'TOOL_RESULT',
      conditionValue: 'product_selected',
      label: 'Product selected by customer',
    },
  })

  // ==========================================
  // WORKFLOW 2: Life Insurance Purchase
  // ==========================================
  const lifeInsurance = await prisma.workflow.upsert({
    where: { code: 'life-insurance-purchase' },
    update: {},
    create: {
      code: 'life-insurance-purchase',
      name: 'Life Insurance Purchase',
      description: 'Complete life insurance purchase flow: DNT -> Application -> Quote -> Policy',
    },
  })

  await prisma.stepTransition.deleteMany({
    where: { fromStep: { workflowId: lifeInsurance.id } },
  })
  await prisma.workflowStep.deleteMany({ where: { workflowId: lifeInsurance.id } })

  // Create all 10 steps
  // Port each step's agentInstructions from V1's seed-workflows.ts verbatim
  // Steps: dnt_check, dnt_questionnaire, dnt_sign, application_check,
  //         application_start, application_resume_prompt, application_fill,
  //         generate_quote, quote_review, completed

  // <CREATE ALL 10 STEPS WITH FULL agentInstructions FROM V1>
  // <CREATE ALL ~13 TRANSITIONS WITH CONDITIONS FROM V1>

  console.log('Workflows seeded successfully.')
}
```

**IMPORTANT:** Read the complete V1 file at `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/prisma/seed-workflows.ts` and port ALL step definitions with their complete `agentInstructions` text and ALL transitions with their conditions. The agentInstructions contain detailed guidance for the AI agent at each step — they must be ported verbatim.

- [ ] **Step 2: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add prisma/seeds/seed-workflows.ts
git commit -m "feat: add workflow seeds with 12 steps and 15 transitions"
```

---

## Task 7: Seed — Agent Configs

**Files:**
- Create: `prisma/seeds/seed-agents.ts`

Source: V1's `prisma/seed-agents.ts` + `extraction/prompts/main-agent-prompt.md` + `extraction/prompts/synthesizer-prompt.md`

- [ ] **Step 1: Write seed-agents.ts**

Port 4 agent configs (V2 launches with 4, not V1's 8). System prompts adapted for V2 (remove V1-specific references, update for Zeno branding).

```typescript
import { PrismaClient, AgentType, LLMProvider } from '@prisma/client'

export async function seedAgents(prisma: PrismaClient) {
  console.log('Seeding agent configs...')

  const agents = [
    {
      slug: 'main-chat',
      name: 'Zeno Main Chat',
      type: AgentType.MAIN_CHAT,
      provider: LLMProvider.OPENAI,
      model: 'gpt-5.2',
      fallbackProvider: LLMProvider.ANTHROPIC,
      fallbackModel: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: `<PORT AND ADAPT MAIN CHAT PROMPT FROM extraction/prompts/main-agent-prompt.md>

Key adaptations for V2:
- Replace generic "AI insurance sales consultant" with Zeno persona
- Keep all CORE BEHAVIORS, CUSTOMER SIGNAL AWARENESS, PACING, CONSTRAINTS, CUSTOMER AUTONOMY verbatim
- Update OFF-TOPIC to reference Zeno brand
- Remove any V1-specific tool references that don't exist in V2`,
      constraints: `NO INVENTED LINKS OR URLS
NO FAKE FORMS
NO PROMISES WITHOUT ACTIONS
USE PAST TENSE FOR COMPLETED ACTIONS
WHEN IN DOUBT, BE HONEST
Insurance and financial services only`,
    },
    {
      slug: 'reasoning-gate',
      name: 'Reasoning Gate',
      type: AgentType.REASONING_GATE,
      provider: LLMProvider.OPENAI,
      model: 'gpt-5.2-mini',
      fallbackProvider: LLMProvider.ANTHROPIC,
      fallbackModel: 'claude-haiku-4-5-20251001',
      temperature: 0.2,
      maxTokens: 1024,
      systemPrompt: `<PORT REASONING GATE PROMPT FROM extraction/prompts/synthesizer-prompt.md>

Port the complete system prompt including:
- Complexity assessment rules (simple/moderate/complex)
- Section selection logic (required/excluded)
- Concern detection categories (price, trust, need, timing, complexity, comparison, family, health, commitment)
- Indirect signal detection
- Concern lifecycle management
- Contradiction resolution priority
- Briefing rules
- JSON output format specification`,
      constraints: `JSON-only output
Must complete within 8 seconds
Briefing must be under 200 words
Never block the main agent - advisory only`,
    },
    {
      slug: 'summarizer',
      name: 'Conversation Summarizer',
      type: AgentType.SUMMARIZER,
      provider: LLMProvider.OPENAI,
      model: 'gpt-5.2-mini',
      fallbackProvider: LLMProvider.ANTHROPIC,
      fallbackModel: 'claude-haiku-4-5-20251001',
      temperature: 0.3,
      maxTokens: 2048,
      systemPrompt: `You are a conversation summarizer for an insurance sales platform. Create concise but complete summaries of conversations.

Focus on:
- Customer needs and stated preferences
- Products discussed and customer reactions
- Concerns raised and whether they were resolved
- Current sales stage and next steps
- Key personal details shared (age, family, budget)
- Any commitments made by either party

Keep summaries factual and actionable. Use bullet points for clarity. Include enough context that the conversation can be resumed naturally.`,
      constraints: null,
    },
    {
      slug: 'profile-extractor',
      name: 'Profile Extractor',
      type: AgentType.PROFILE_EXTRACTOR,
      provider: LLMProvider.OPENAI,
      model: 'gpt-5.2-mini',
      fallbackProvider: LLMProvider.ANTHROPIC,
      fallbackModel: 'claude-haiku-4-5-20251001',
      temperature: 0.1,
      maxTokens: 1024,
      systemPrompt: `<PORT PROFILE EXTRACTOR PROMPT FROM V1 seed-agents.ts>

Extract customer demographics from conversation. Output JSON with fields:
- demographics: { age, gender, city, county }
- employment: { occupation, status, employer, monthlyIncome }
- family: { familySize, hasSpouse, hasChildren, numberOfChildren, childrenAges }
- health: { smokingStatus, healthConditions, exerciseFrequency }
- interests: { motivations, concerns }

Only extract what is explicitly stated or strongly implied. Never infer or guess.
Return only changed/new fields, not the entire profile.`,
      constraints: `JSON-only output
Only extract explicitly stated information
Never infer or guess demographics`,
    },
  ]

  for (const agent of agents) {
    await prisma.agent.upsert({
      where: { slug: agent.slug },
      update: {
        systemPrompt: agent.systemPrompt,
        constraints: agent.constraints,
        provider: agent.provider,
        model: agent.model,
        fallbackProvider: agent.fallbackProvider,
        fallbackModel: agent.fallbackModel,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
      },
      create: agent,
    })
  }

  console.log('Agent configs seeded successfully.')
}
```

**IMPORTANT:** The `<PORT ...>` placeholders must be replaced with the actual prompt text. Read the extraction files and V1 seed file and port the complete prompts, adapting for V2/Zeno branding.

- [ ] **Step 2: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add prisma/seeds/seed-agents.ts
git commit -m "feat: add 4 agent config seeds with system prompts"
```

---

## Task 8: Seed — Model Catalog

**Files:**
- Create: `prisma/seeds/seed-model-catalog.ts`

- [ ] **Step 1: Write seed-model-catalog.ts**

```typescript
import { PrismaClient, LLMProvider } from '@prisma/client'

export async function seedModelCatalog(prisma: PrismaClient) {
  console.log('Seeding model catalog...')

  const models = [
    {
      provider: LLMProvider.OPENAI,
      modelId: 'gpt-5.2',
      displayName: 'GPT-5.2',
      supportsStreaming: true,
      supportsTools: true,
      supportsStructuredOutput: true,
      costPer1kInputTokens: 0.003,
      costPer1kOutputTokens: 0.015,
    },
    {
      provider: LLMProvider.OPENAI,
      modelId: 'gpt-5.2-mini',
      displayName: 'GPT-5.2 Mini',
      supportsStreaming: true,
      supportsTools: true,
      supportsStructuredOutput: true,
      costPer1kInputTokens: 0.0004,
      costPer1kOutputTokens: 0.0016,
    },
    {
      provider: LLMProvider.ANTHROPIC,
      modelId: 'claude-opus-4-6',
      displayName: 'Claude Opus 4.6',
      supportsStreaming: true,
      supportsTools: true,
      supportsStructuredOutput: true,
      costPer1kInputTokens: 0.015,
      costPer1kOutputTokens: 0.075,
    },
    {
      provider: LLMProvider.ANTHROPIC,
      modelId: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet 4.6',
      supportsStreaming: true,
      supportsTools: true,
      supportsStructuredOutput: true,
      costPer1kInputTokens: 0.003,
      costPer1kOutputTokens: 0.015,
    },
    {
      provider: LLMProvider.ANTHROPIC,
      modelId: 'claude-sonnet-4-20250514',
      displayName: 'Claude Sonnet 4',
      supportsStreaming: true,
      supportsTools: true,
      supportsStructuredOutput: true,
      costPer1kInputTokens: 0.003,
      costPer1kOutputTokens: 0.015,
    },
    {
      provider: LLMProvider.ANTHROPIC,
      modelId: 'claude-haiku-4-5-20251001',
      displayName: 'Claude Haiku 4.5',
      supportsStreaming: true,
      supportsTools: true,
      supportsStructuredOutput: true,
      costPer1kInputTokens: 0.0008,
      costPer1kOutputTokens: 0.004,
    },
  ]

  for (const model of models) {
    await prisma.modelCatalog.upsert({
      where: {
        provider_modelId: { provider: model.provider, modelId: model.modelId },
      },
      update: model,
      create: model,
    })
  }

  console.log('Model catalog seeded successfully.')
}
```

- [ ] **Step 2: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add prisma/seeds/seed-model-catalog.ts
git commit -m "feat: add model catalog seed with OpenAI and Anthropic models"
```

---

## Task 9: Seed Index + Run

**Files:**
- Create: `prisma/seeds/index.ts`

- [ ] **Step 1: Write seed index**

```typescript
import { PrismaClient } from '@prisma/client'
import { seedProduct } from './seed-product'
import { seedQuestions } from './seed-questions'
import { seedObjections } from './seed-objections'
import { seedWorkflows } from './seed-workflows'
import { seedAgents } from './seed-agents'
import { seedModelCatalog } from './seed-model-catalog'

const prisma = new PrismaClient()

async function main() {
  console.log('Starting seed...\n')

  // Order matters: product first (others reference it)
  // Single PrismaClient shared across all seed functions
  await seedProduct(prisma)
  await seedQuestions(prisma)
  await seedObjections(prisma)
  await seedWorkflows(prisma)
  await seedAgents(prisma)
  await seedModelCatalog(prisma)

  console.log('\nAll seeds completed successfully!')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
```

- [ ] **Step 2: Run seeds**

Run:
```bash
npx prisma db seed
```
Expected: All seeds complete without errors.

- [ ] **Step 3: Verify data in Prisma Studio**

Run:
```bash
npx prisma studio
```

Check counts:
- Product: 1
- CoverageType: 7
- PricingTier: 2
- PricingLevel: 6
- CoverageAmount: 72+ (54 death age-banded + 18 fixed)
- Addon: 1
- AddonPricingRule: 4
- ObjectionStrategy: 9
- Workflow: 2
- WorkflowStep: 12
- StepTransition: ~15
- Agent: 4
- ModelCatalog: 6
- QuestionGroup: 8

- [ ] **Step 4: Commit**

```bash
git add prisma/seeds/index.ts
git commit -m "feat: add seed orchestrator and verify all data"
```

---

## Task 10: Tailwind Brand Config

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Update globals.css with Tailwind 4 theme and CSS variables**

Tailwind 4 uses CSS-first configuration via `@theme` blocks instead of a JS config file. Read the existing `app/globals.css` and replace with Zeno brand tokens defined via Tailwind 4's `@theme` directive:

```css
@import "tailwindcss";

@theme {
  /* Zeno brand colors */
  --color-forest: #1A3A2F;
  --color-sage: #2D6B52;
  --color-sand: #D4A574;
  --color-linen: #F5EDE3;
  --color-soft-white: #FAF8F5;
  --color-night: #1C1C1A;
  --color-muted: #8A8680;
  --color-warm-border: #E5E0D8;
  --color-success: #2D6B52;
  --color-warning: #B8860B;
  --color-error: #8B2D2D;
  --color-info: #2A5A7B;

  /* Zeno brand fonts */
  --font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;

  /* Border radius */
  --radius-bubble: 16px;

  /* Spacing */
  --spacing-1: 4px;
  --spacing-2: 8px;
  --spacing-3: 12px;
  --spacing-4: 16px;
  --spacing-5: 24px;
  --spacing-6: 32px;
  --spacing-7: 48px;
  --spacing-8: 64px;
}

/* CSS custom properties for use outside Tailwind utilities */
:root {
  --transition-fast: 150ms ease;
  --transition-normal: 200ms ease;
  --transition-slow: 300ms ease;

  --shadow-sm: 0 1px 2px rgba(28, 28, 26, 0.05);
  --shadow-md: 0 4px 12px rgba(28, 28, 26, 0.08);
  --shadow-lg: 0 8px 24px rgba(28, 28, 26, 0.12);
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-forest: #3A7D5E;
    --color-sage: #5DCAA5;
    --color-sand: #D4A574;
    --color-linen: #282826;
    --color-soft-white: #141413;
    --color-night: #E8E4DC;
    --color-muted: #A09A90;
    --color-warm-border: #3A3835;
    --color-success: #5DCAA5;
    --color-warning: #D4A574;
    --color-error: #E07070;
    --color-info: #6AADDB;
  }
}

body {
  background-color: var(--color-soft-white);
  color: var(--color-night);
  font-family: var(--font-sans);
}
```

- [ ] **Step 2: Remove or simplify tailwind.config.ts**

Tailwind 4 auto-detects content sources so the JS config is no longer needed for theme customization. If `create-next-app` generated a `tailwind.config.ts`, delete it — all theme config is now in `globals.css` via `@theme`. If Next.js or shadcn/ui requires the file, leave it minimal:

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
}

export default config
```

Note: Check the version of Tailwind installed by `create-next-app`. If it installs Tailwind 3 instead of 4, the `@theme` syntax won't work. In that case, use the Tailwind 3 approach with `theme.extend` in the JS config instead. Adapt based on which version is actually installed.

- [ ] **Step 3: Update layout.tsx with fonts**

Read the existing `app/layout.tsx` and update to load Inter and Fraunces via next/font:

```tsx
import type { Metadata } from 'next'
import { Inter, Fraunces } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
})

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  weight: ['500'],
})

export const metadata: Metadata = {
  title: 'Zeno — Pregatit pentru orice',
  description: 'Asigurare de viata Allianz-Tiriac. Acces la tratament de top. Oriunde in lume.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ro" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
```

- [ ] **Step 4: Update page.tsx with placeholder**

Replace `app/page.tsx` with a minimal Zeno-branded placeholder:

```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-soft-white">
      <h1 className="font-display text-5xl font-medium text-forest">Zeno</h1>
      <p className="mt-2 text-sm text-muted">powered by Allianz-Tiriac</p>
      <p className="mt-8 max-w-md text-center text-lg text-night">
        Pregatit pentru orice.
      </p>
    </main>
  )
}
```

- [ ] **Step 5: Create public/brand directory**

Run:
```bash
mkdir -p public/brand && touch public/brand/.gitkeep
```

This reserves the directory for brand assets (SVGs) that will be added in Phase B.

- [ ] **Step 6: Verify dev server starts**

Run:
```bash
npm run dev
```
Expected: Server starts, page loads at http://localhost:3000 showing "Zeno" in Fraunces font with forest green color.

- [ ] **Step 7: Run type check**

Run:
```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add tailwind.config.ts app/globals.css app/layout.tsx app/page.tsx public/brand/.gitkeep
git commit -m "feat: add Zeno brand tokens, fonts, and CSS variables"
```

---

## Task 11: shadcn/ui Setup

**Files:**
- Create/Modify: `components.json`

- [ ] **Step 1: Initialize shadcn/ui**

Run:
```bash
npx shadcn@latest init
```

When prompted:
- Style: Default
- Base color: Neutral (we override with Zeno colors)
- CSS variables: Yes

- [ ] **Step 2: Verify components.json exists and is correct**

Check that `components.json` was created with correct paths.

- [ ] **Step 3: Commit**

```bash
git add components.json
git commit -m "feat: initialize shadcn/ui"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Full type check**

Run:
```bash
npx tsc --noEmit
```
Expected: Zero errors.

- [ ] **Step 2: Reset and re-seed database**

Run:
```bash
npx prisma db push --force-reset && npx prisma db seed
```
Expected: Schema applied and all seeds complete.

- [ ] **Step 3: Verify seed counts in Prisma Studio**

Run:
```bash
npx prisma studio
```

Verify ALL these counts:
- Product: 1
- CoverageType: 7 (4 base + 3 addon)
- PricingTier: 2 (Standard, Optim)
- PricingLevel: 6 (3 per tier)
- CoverageAmount: 72+ (54 death + 18 fixed)
- Addon: 1 (BD)
- AddonPricingRule: 4
- ObjectionStrategy: 9
- QuestionGroup: 8
- Question: 37 (3+6+1+11+3+2+5+6)
- Workflow: 2
- WorkflowStep: 12
- StepTransition: ~15
- Agent: 4
- ModelCatalog: 6

- [ ] **Step 4: Verify dev server**

Run:
```bash
npm run dev
```
Expected: Page loads at localhost:3000 with Zeno branding.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Slice A1 Foundation — schema, seeds, and brand setup"
```

---

## Notes for Implementer

1. **Seed scripts with `<PASTE ...>` or `<PORT ...>` placeholders:** These must be filled with actual content from the extraction files. Read the source files listed and copy the complete text verbatim. The extraction files are at `C:/GitHub/ai_sales_agent_crm/extraction/`.

2. **V1 reference files:** The V1 codebase is at `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/`. Key files to read:
   - `prisma/seed-workflows.ts` — complete workflow definitions
   - `prisma/seed-agents.ts` — agent prompts and configs
   - `extraction/playbook/objection-handling-ro.md` — full objection text
   - `extraction/prompts/main-agent-prompt.md` — main chat system prompt
   - `extraction/prompts/synthesizer-prompt.md` — reasoning gate prompt

3. **Idempotent seeds:** All seeds use `upsert` or `deleteMany` + `create` patterns. Safe to re-run.

4. **No tests in A1:** This slice is schema + data. There's no business logic to test. Testing starts in Slice A2 when we add the LLM gateway and tool pipeline.

5. **Prisma schema single file:** Prisma requires all models in one file. Don't split it.
