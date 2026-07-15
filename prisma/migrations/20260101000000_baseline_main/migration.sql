-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'IDLE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('OPEN', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'ACCEPTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('PENDING_SUBMISSION', 'SUBMITTED', 'ACTIVE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'PAYU', 'MOCK');

-- CreateEnum
CREATE TYPE "WorkflowSessionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LLMProvider" AS ENUM ('OPENAI', 'ANTHROPIC');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'ADMIN', 'OPERATOR');

-- CreateEnum
CREATE TYPE "InsightCategory" AS ENUM ('DEMOGRAPHIC', 'PREFERENCE', 'OBJECTION_PATTERN', 'BUYING_SIGNAL', 'RISK_FACTOR');

-- CreateEnum
CREATE TYPE "KnowledgeCategory" AS ENUM ('OBJECTION_RESPONSE', 'TOOL_SEQUENCE', 'CONVERSATION_PATTERN', 'PROMPT_FRAGMENT');

-- CreateEnum
CREATE TYPE "ProposalType" AS ENUM ('KNOWLEDGE_CREATE', 'KNOWLEDGE_UPDATE', 'SKILLPACK_UPDATE', 'INSIGHT');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "insuranceType" TEXT NOT NULL,
    "subType" TEXT NOT NULL,
    "eligibility" JSONB NOT NULL,
    "features" TEXT[],
    "exclusions" TEXT[],
    "defaultPlaybook" TEXT NOT NULL,
    "pricingExplanation" TEXT NOT NULL,
    "targetCustomer" TEXT NOT NULL,
    "targetAgeRange" TEXT NOT NULL,
    "contractTerm" TEXT NOT NULL,
    "gracePeriod" TEXT NOT NULL,
    "medicalExamRequired" BOOLEAN NOT NULL DEFAULT false,
    "territoryCoverage" TEXT NOT NULL,
    "premiumRange" JSONB,
    "paymentFrequencyOptions" JSONB,
    "insightKeys" JSONB,
    "quoteValidityDays" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingTier" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "orderIndex" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingLevel" (
    "id" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "premiumAnnual" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "orderIndex" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "category" TEXT,
    "unit" TEXT,
    "maxUnits" INTEGER,
    "deductibleDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageAmount" (
    "id" TEXT NOT NULL,
    "coverageTypeId" TEXT NOT NULL,
    "pricingLevelId" TEXT,
    "addonId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "isAgeBased" BOOLEAN NOT NULL DEFAULT false,
    "minAge" INTEGER,
    "maxAge" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageAmount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Addon" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "waitingPeriod" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Addon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddonPricingRule" (
    "id" TEXT NOT NULL,
    "addonId" TEXT NOT NULL,
    "minAge" INTEGER NOT NULL,
    "maxAge" INTEGER NOT NULL,
    "premiumAnnual" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddonPricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectionStrategy" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "addonContext" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectionStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "name" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "cnpEncrypted" TEXT,
    "cnpIv" TEXT,
    "cnpTag" TEXT,
    "address" JSONB,
    "language" TEXT NOT NULL DEFAULT 'ro',
    "extractedProfile" JSONB,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT true,
    "magicLinkToken" TEXT,
    "magicLinkExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "gdprConsentAt" TIMESTAMP(3),
    "gdprConsentScope" TEXT,
    "aiDisclosureAcknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT,
    "candidateProductId" TEXT,
    "candidateConfidence" INTEGER,
    "candidateSetAt" TIMESTAMP(3),
    "dntSignedAt" TIMESTAMP(3),
    "dntValidUntil" TIMESTAMP(3),
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "channel" TEXT NOT NULL DEFAULT 'web',
    "language" TEXT NOT NULL DEFAULT 'ro',
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "mode" TEXT NOT NULL DEFAULT 'SALES',
    "activeSkillPacks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "toolResults" JSONB,
    "tokenCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationSummary" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "messagesUpTo" INTEGER NOT NULL,
    "tokenCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStep" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "autoTool" TEXT,
    "allowedTools" TEXT[],
    "agentInstructions" TEXT,
    "salesPlaybook" TEXT,
    "uiAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepTransition" (
    "id" TEXT NOT NULL,
    "fromStepId" TEXT NOT NULL,
    "toStepId" TEXT NOT NULL,
    "conditionType" TEXT NOT NULL,
    "conditionValue" TEXT NOT NULL,
    "label" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowSession" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "currentStepId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "WorkflowSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "productId" TEXT,
    "phase" TEXT,
    "description" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "code" TEXT,
    "text" JSONB NOT NULL,
    "helpText" JSONB,
    "type" TEXT NOT NULL,
    "options" JSONB,
    "validationRules" JSONB,
    "insightKey" TEXT,
    "parentQuestionId" TEXT,
    "showWhenValue" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tierId" TEXT,
    "levelId" TEXT,
    "includesAddon" BOOLEAN NOT NULL DEFAULT false,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'OPEN',
    "currentQuestionIndex" INTEGER NOT NULL DEFAULT 0,
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "flagsForReview" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "premiumAnnual" DOUBLE PRECISION NOT NULL,
    "premiumMonthly" DOUBLE PRECISION NOT NULL,
    "premiumSemiAnnual" DOUBLE PRECISION,
    "premiumQuarterly" DOUBLE PRECISION,
    "paymentFrequency" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "coverages" JSONB NOT NULL,
    "addonsSelected" JSONB,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "allianzPolicyNumber" TEXT,
    "status" "PolicyStatus" NOT NULL DEFAULT 'PENDING_SUBMISSION',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveUntil" TIMESTAMP(3),
    "premiumAnnual" DOUBLE PRECISION NOT NULL,
    "premiumMonthly" DOUBLE PRECISION NOT NULL,
    "paymentFrequency" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "coverageSummary" JSONB NOT NULL,
    "suitabilityReportPath" TEXT,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "provider" "PaymentProvider" NOT NULL,
    "providerPaymentId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "provider" "LLMProvider" NOT NULL DEFAULT 'OPENAI',
    "model" TEXT NOT NULL,
    "fallbackProvider" "LLMProvider" DEFAULT 'ANTHROPIC',
    "fallbackModel" TEXT,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "systemPrompt" TEXT,
    "constraints" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillPack" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "promptSections" JSONB NOT NULL,
    "allowedTools" TEXT[],
    "constraints" TEXT,
    "flags" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelCatalog" (
    "id" TEXT NOT NULL,
    "provider" "LLMProvider" NOT NULL,
    "modelId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "supportsStreaming" BOOLEAN NOT NULL DEFAULT true,
    "supportsTools" BOOLEAN NOT NULL DEFAULT true,
    "supportsStructuredOutput" BOOLEAN NOT NULL DEFAULT true,
    "costPer1kInputTokens" DOUBLE PRECISION NOT NULL,
    "costPer1kOutputTokens" DOUBLE PRECISION NOT NULL,
    "contextWindow" INTEGER NOT NULL DEFAULT 128000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurnTrace" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageIndex" INTEGER NOT NULL,
    "phases" JSONB NOT NULL,
    "anomalies" JSONB,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cost" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "provider" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TurnTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurnDebug" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageIndex" INTEGER NOT NULL,
    "traceId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TurnDebug_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerCustomerId" TEXT NOT NULL,
    "referredCustomerId" TEXT,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rewardApplied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "customerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerInsight" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT,
    "category" "InsightCategory" NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "source" TEXT NOT NULL,
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentKnowledge" (
    "id" TEXT NOT NULL,
    "category" "KnowledgeCategory" NOT NULL,
    "trigger" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "successRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "workflowStepCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationScore" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "quoteGenerated" BOOLEAN NOT NULL,
    "applicationSubmitted" BOOLEAN NOT NULL,
    "policyPurchased" BOOLEAN NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "messageCount" INTEGER NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "totalLatencyMs" INTEGER NOT NULL,
    "anomalyCount" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "skillPackSlugs" TEXT[],
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImprovementProposal" (
    "id" TEXT NOT NULL,
    "type" "ProposalType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "diff" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "adminNotes" TEXT,
    "appliedAt" TIMESTAMP(3),
    "baselineMetrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImprovementProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ABTestVariant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "skillPackSlugA" TEXT NOT NULL,
    "skillPackSlugB" TEXT NOT NULL,
    "splitRatio" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "conversationsA" INTEGER NOT NULL DEFAULT 0,
    "conversationsB" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ABTestVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "totalScenarios" INTEGER NOT NULL,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "avgScore" DOUBLE PRECISION,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationConversation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "personaSlug" TEXT NOT NULL,
    "scenarioType" TEXT NOT NULL,
    "scenarioSlug" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "score" DOUBLE PRECISION,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AgentToSkillPack" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AgentToSkillPack_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PricingTier_productId_code_key" ON "PricingTier"("productId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PricingLevel_tierId_code_key" ON "PricingLevel"("tierId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageType_code_key" ON "CoverageType"("code");

-- CreateIndex
CREATE INDEX "CoverageAmount_coverageTypeId_pricingLevelId_idx" ON "CoverageAmount"("coverageTypeId", "pricingLevelId");

-- CreateIndex
CREATE INDEX "CoverageAmount_coverageTypeId_addonId_idx" ON "CoverageAmount"("coverageTypeId", "addonId");

-- CreateIndex
CREATE UNIQUE INDEX "Addon_productId_code_key" ON "Addon"("productId", "code");

-- CreateIndex
CREATE INDEX "AddonPricingRule_addonId_minAge_maxAge_idx" ON "AddonPricingRule"("addonId", "minAge", "maxAge");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectionStrategy_productId_type_key" ON "ObjectionStrategy"("productId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_magicLinkToken_key" ON "Customer"("magicLinkToken");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationSummary_conversationId_key" ON "ConversationSummary"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_code_key" ON "Workflow"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStep_workflowId_code_key" ON "WorkflowStep"("workflowId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowSession_conversationId_key" ON "WorkflowSession"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionGroup_code_key" ON "QuestionGroup"("code");

-- CreateIndex
CREATE INDEX "Question_groupId_orderIndex_idx" ON "Question"("groupId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_questionId_conversationId_key" ON "Answer"("questionId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_conversationId_key" ON "Application"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_applicationId_key" ON "Quote"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_quoteId_key" ON "Policy"("quoteId");

-- CreateIndex
CREATE INDEX "Payment_providerPaymentId_idx" ON "Payment"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_slug_key" ON "Agent"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SkillPack_slug_key" ON "SkillPack"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ModelCatalog_provider_modelId_key" ON "ModelCatalog"("provider", "modelId");

-- CreateIndex
CREATE INDEX "TurnTrace_conversationId_messageIndex_idx" ON "TurnTrace"("conversationId", "messageIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TurnDebug_traceId_key" ON "TurnDebug"("traceId");

-- CreateIndex
CREATE INDEX "TurnDebug_conversationId_messageIndex_idx" ON "TurnDebug"("conversationId", "messageIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_code_key" ON "Referral"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_customerId_key" ON "User"("customerId");

-- CreateIndex
CREATE INDEX "CustomerInsight_customerId_category_idx" ON "CustomerInsight"("customerId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerInsight_customerId_key_key" ON "CustomerInsight"("customerId", "key");

-- CreateIndex
CREATE INDEX "AgentKnowledge_category_isActive_idx" ON "AgentKnowledge"("category", "isActive");

-- CreateIndex
CREATE INDEX "AgentKnowledge_productId_workflowStepCode_idx" ON "AgentKnowledge"("productId", "workflowStepCode");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationScore_conversationId_key" ON "ConversationScore"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationScore_scoredAt_idx" ON "ConversationScore"("scoredAt");

-- CreateIndex
CREATE INDEX "ConversationScore_score_idx" ON "ConversationScore"("score");

-- CreateIndex
CREATE INDEX "ImprovementProposal_status_createdAt_idx" ON "ImprovementProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ABTestVariant_isActive_idx" ON "ABTestVariant"("isActive");

-- CreateIndex
CREATE INDEX "SimulationRun_status_idx" ON "SimulationRun"("status");

-- CreateIndex
CREATE INDEX "SimulationRun_startedAt_idx" ON "SimulationRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationConversation_conversationId_key" ON "SimulationConversation"("conversationId");

-- CreateIndex
CREATE INDEX "SimulationConversation_runId_idx" ON "SimulationConversation"("runId");

-- CreateIndex
CREATE INDEX "SimulationConversation_personaSlug_idx" ON "SimulationConversation"("personaSlug");

-- CreateIndex
CREATE INDEX "_AgentToSkillPack_B_index" ON "_AgentToSkillPack"("B");

-- AddForeignKey
ALTER TABLE "PricingTier" ADD CONSTRAINT "PricingTier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingLevel" ADD CONSTRAINT "PricingLevel_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "PricingTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageAmount" ADD CONSTRAINT "CoverageAmount_coverageTypeId_fkey" FOREIGN KEY ("coverageTypeId") REFERENCES "CoverageType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageAmount" ADD CONSTRAINT "CoverageAmount_pricingLevelId_fkey" FOREIGN KEY ("pricingLevelId") REFERENCES "PricingLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageAmount" ADD CONSTRAINT "CoverageAmount_addonId_fkey" FOREIGN KEY ("addonId") REFERENCES "Addon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Addon" ADD CONSTRAINT "Addon_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddonPricingRule" ADD CONSTRAINT "AddonPricingRule_addonId_fkey" FOREIGN KEY ("addonId") REFERENCES "Addon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectionStrategy" ADD CONSTRAINT "ObjectionStrategy_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_candidateProductId_fkey" FOREIGN KEY ("candidateProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSummary" ADD CONSTRAINT "ConversationSummary_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStep" ADD CONSTRAINT "WorkflowStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepTransition" ADD CONSTRAINT "StepTransition_fromStepId_fkey" FOREIGN KEY ("fromStepId") REFERENCES "WorkflowStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepTransition" ADD CONSTRAINT "StepTransition_toStepId_fkey" FOREIGN KEY ("toStepId") REFERENCES "WorkflowStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowSession" ADD CONSTRAINT "WorkflowSession_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowSession" ADD CONSTRAINT "WorkflowSession_currentStepId_fkey" FOREIGN KEY ("currentStepId") REFERENCES "WorkflowStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowSession" ADD CONSTRAINT "WorkflowSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionGroup" ADD CONSTRAINT "QuestionGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "QuestionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_parentQuestionId_fkey" FOREIGN KEY ("parentQuestionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "PricingTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "PricingLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnTrace" ADD CONSTRAINT "TurnTrace_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnDebug" ADD CONSTRAINT "TurnDebug_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerCustomerId_fkey" FOREIGN KEY ("referrerCustomerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredCustomerId_fkey" FOREIGN KEY ("referredCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInsight" ADD CONSTRAINT "CustomerInsight_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInsight" ADD CONSTRAINT "CustomerInsight_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentKnowledge" ADD CONSTRAINT "AgentKnowledge_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationScore" ADD CONSTRAINT "ConversationScore_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationConversation" ADD CONSTRAINT "SimulationConversation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SimulationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationConversation" ADD CONSTRAINT "SimulationConversation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentToSkillPack" ADD CONSTRAINT "_AgentToSkillPack_A_fkey" FOREIGN KEY ("A") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentToSkillPack" ADD CONSTRAINT "_AgentToSkillPack_B_fkey" FOREIGN KEY ("B") REFERENCES "SkillPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

