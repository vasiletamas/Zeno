-- Zeno v3 upgrade (P1-7, 2026-07-15). Transforms the main schema into the v3
-- schema: drops the retired workflow/skill-pack machine, adds the 18 v3 models
-- (DNT sessions, verification, disclosures, payment schedules/installments,
-- work items, commit ledger, customer profile fields, documents, ...), and
-- reworks Customer/Conversation/Question/Answer/Application/Quote/Policy/Payment.
--
-- DATA SAFETY: durable data (Customer, Conversation, Quote, Policy, Product —
-- insuranceType is CAST, not dropped) is preserved. The Answer and Payment
-- tables are REDESIGNED (conversation-scoped -> application-scoped answers;
-- flat -> installment-anchored payments) and their new required columns have no
-- source in the main model, so IN-FLIGHT funnel data (Answer, Payment) must be
-- DRAINED before this upgrade. The product catalog is re-seeded authoritatively
-- by prisma/seeds after deploy.

-- CreateEnum
CREATE TYPE "WorkItemKind" AS ENUM ('REFERRAL', 'ESCALATION', 'DOCUMENT_REVIEW', 'GDPR_ERASURE', 'GDPR_EXPORT', 'ALERT_FLAG');

-- CreateEnum
CREATE TYPE "WorkItemStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "WorkItemPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "DependencyKind" AS ENUM ('VISIBILITY', 'VALIDITY', 'ELIGIBILITY');

-- CreateEnum
CREATE TYPE "QuestionSensitivity" AS ENUM ('NONE', 'CONFIRM_ON_MODIFY', 'CONFIRM_ALWAYS');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('IPID', 'TERMS', 'PAYMENT_RECEIPT', 'SUITABILITY_REPORT', 'POLICY_SCHEDULE');

-- CreateEnum
CREATE TYPE "PaymentScheduleStatus" AS ENUM ('PENDING_FIRST_CAPTURE', 'ACTIVE', 'COMPLETED', 'SUPERSEDED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'WAIVED');

-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('STATIC_PER_PRODUCT_VERSION', 'GENERATED');

-- CreateEnum
CREATE TYPE "ProductContentField" AS ENUM ('KEY_VALUE_PRODUCT_POINTS', 'SELL_SPECIFIC_INFO', 'SELL_SPECIFIC_ADDON_INFO', 'PRICING_NOTE');

-- CreateEnum
CREATE TYPE "ProductContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "VerificationChannel" AS ENUM ('email', 'sms');

-- CreateEnum
CREATE TYPE "CustomerDocumentKind" AS ENUM ('id_card');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('uploaded', 'extracted', 'validated', 'review', 'rejected');

-- CreateEnum
CREATE TYPE "ConsentKind" AS ENUM ('gdpr_processing', 'ai_disclosure', 'marketing');

-- CreateEnum
CREATE TYPE "ConsentAction" AS ENUM ('granted', 'withdrawn');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('LIFE');

-- CreateEnum
CREATE TYPE "DntStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DntSessionType" AS ENUM ('NEW', 'UPDATE');

-- CreateEnum
CREATE TYPE "DntSessionStatus" AS ENUM ('ACTIVE', 'FINISHED', 'SIGNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FieldProvenance" AS ENUM ('declared', 'verified', 'conflict');

-- CreateEnum
CREATE TYPE "AnswerSource" AS ENUM ('USER_ANSWER', 'PREFILL', 'SELECTION_MIRROR', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AnswerRevisionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'INVALIDATED');

-- AlterEnum
BEGIN;
CREATE TYPE "ConversationStatus_new" AS ENUM ('ACTIVE', 'ARCHIVED');
ALTER TABLE "Conversation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Conversation" ALTER COLUMN "status" TYPE "ConversationStatus_new" USING ("status"::text::"ConversationStatus_new");
ALTER TYPE "ConversationStatus" RENAME TO "ConversationStatus_old";
ALTER TYPE "ConversationStatus_new" RENAME TO "ConversationStatus";
DROP TYPE "ConversationStatus_old";
ALTER TABLE "Conversation" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApplicationStatus" ADD VALUE 'REFERRED';
ALTER TYPE "ApplicationStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
BEGIN;
CREATE TYPE "QuoteStatus_new" AS ENUM ('ISSUED', 'ACCEPTED', 'EXPIRED', 'CANCELLED');
ALTER TABLE "Quote" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Quote" ALTER COLUMN "status" TYPE "QuoteStatus_new" USING ("status"::text::"QuoteStatus_new");
ALTER TYPE "QuoteStatus" RENAME TO "QuoteStatus_old";
ALTER TYPE "QuoteStatus_new" RENAME TO "QuoteStatus";
DROP TYPE "QuoteStatus_old";
ALTER TABLE "Quote" ALTER COLUMN "status" SET DEFAULT 'ISSUED';
COMMIT;

-- AlterEnum
ALTER TYPE "PolicyStatus" ADD VALUE 'LAPSED';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'SUPERSEDED';

-- DropForeignKey
ALTER TABLE "WorkflowStep" DROP CONSTRAINT "WorkflowStep_workflowId_fkey";

-- DropForeignKey
ALTER TABLE "StepTransition" DROP CONSTRAINT "StepTransition_fromStepId_fkey";

-- DropForeignKey
ALTER TABLE "StepTransition" DROP CONSTRAINT "StepTransition_toStepId_fkey";

-- DropForeignKey
ALTER TABLE "WorkflowSession" DROP CONSTRAINT "WorkflowSession_workflowId_fkey";

-- DropForeignKey
ALTER TABLE "WorkflowSession" DROP CONSTRAINT "WorkflowSession_currentStepId_fkey";

-- DropForeignKey
ALTER TABLE "WorkflowSession" DROP CONSTRAINT "WorkflowSession_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "Question" DROP CONSTRAINT "Question_parentQuestionId_fkey";

-- DropForeignKey
ALTER TABLE "Answer" DROP CONSTRAINT "Answer_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_policyId_fkey";

-- DropForeignKey
ALTER TABLE "_AgentToSkillPack" DROP CONSTRAINT "_AgentToSkillPack_A_fkey";

-- DropForeignKey
ALTER TABLE "_AgentToSkillPack" DROP CONSTRAINT "_AgentToSkillPack_B_fkey";

-- DropIndex
DROP INDEX "Customer_magicLinkToken_key";

-- DropIndex
DROP INDEX "Answer_questionId_conversationId_key";

-- DropIndex
DROP INDEX "Application_conversationId_key";

-- DropIndex
DROP INDEX "Payment_providerPaymentId_idx";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "features",
DROP COLUMN "premiumRange",
DROP COLUMN "pricingExplanation",
DROP COLUMN "targetAgeRange",
ADD COLUMN     "freeLookDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "pricingExampleGrid" JSONB,
ADD COLUMN     "suitabilityRules" JSONB,
ADD COLUMN     "verificationRequirements" JSONB;
-- P1-7 (hand-tuned, data-safe): CAST the text insuranceType into the new
-- ProductType enum instead of DROP+ADD, so existing product rows survive the
-- upgrade (the generated DROP+ADD would drop the column and re-add it NOT NULL
-- with no default, crashing on any populated Product table).
ALTER TABLE "Product" ALTER COLUMN "insuranceType" TYPE "ProductType" USING ("insuranceType"::"ProductType");

-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "aiDisclosureAcknowledgedAt",
DROP COLUMN "extractedProfile",
DROP COLUMN "gdprConsentAt",
DROP COLUMN "gdprConsentScope",
DROP COLUMN "magicLinkExpiresAt",
DROP COLUMN "magicLinkToken",
ADD COLUMN     "erasedAt" TIMESTAMP(3),
ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "mergedIntoId" TEXT;

-- AlterTable
ALTER TABLE "Conversation" DROP COLUMN "activeSkillPacks",
DROP COLUMN "candidateConfidence",
DROP COLUMN "completedAt",
DROP COLUMN "dntSignedAt",
DROP COLUMN "dntValidUntil",
ADD COLUMN     "activeApplicationId" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "candidateAddonIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Question" DROP COLUMN "parentQuestionId",
DROP COLUMN "showWhenValue",
ADD COLUMN     "sensitivity" "QuestionSensitivity" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "Answer" DROP COLUMN "conversationId",
ADD COLUMN     "applicationId" TEXT NOT NULL,
ADD COLUMN     "causedByKey" TEXT,
ADD COLUMN     "commitId" TEXT,
ADD COLUMN     "invalidatedReason" TEXT,
ADD COLUMN     "source" "AnswerSource" NOT NULL DEFAULT 'USER_ANSWER',
ADD COLUMN     "status" "AnswerRevisionStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Application" DROP COLUMN "conversationId",
ADD COLUMN     "frozenAt" TIMESTAMP(3),
ADD COLUMN     "originConversationId" TEXT,
ADD COLUMN     "quoteDecision" JSONB;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ALTER COLUMN "status" SET DEFAULT 'ISSUED';

-- AlterTable
ALTER TABLE "Policy" DROP COLUMN "suitabilityReportPath",
ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "freeLookEndsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "amount",
DROP COLUMN "policyId",
ADD COLUMN     "amountMinor" INTEGER NOT NULL,
ADD COLUMN     "installmentId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "promptSections" JSONB;

-- AlterTable
ALTER TABLE "TurnTrace" ADD COLUMN     "cacheReadTokens" INTEGER,
ADD COLUMN     "cacheWriteTokens" INTEGER;

-- AlterTable
ALTER TABLE "ConversationScore" ADD COLUMN     "avgCacheHitRate" DOUBLE PRECISION,
ADD COLUMN     "insightRejectedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reaskedKnownFactCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalCachedTokens" INTEGER,
ADD COLUMN     "totalPromptTokens" INTEGER,
ADD COLUMN     "unexplainedToolErrorCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verificationCompleted" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "Workflow";

-- DropTable
DROP TABLE "WorkflowStep";

-- DropTable
DROP TABLE "StepTransition";

-- DropTable
DROP TABLE "WorkflowSession";

-- DropTable
DROP TABLE "SkillPack";

-- DropTable
DROP TABLE "_AgentToSkillPack";

-- DropEnum
DROP TYPE "WorkflowSessionStatus";

-- CreateTable
CREATE TABLE "ProductContent" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "addonId" TEXT,
    "field" "ProductContentField" NOT NULL,
    "locale" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ProductContentStatus" NOT NULL DEFAULT 'DRAFT',
    "authoredBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionDependency" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "subjectKey" TEXT NOT NULL,
    "dependsOnKey" TEXT NOT NULL,
    "kind" "DependencyKind" NOT NULL,
    "predicate" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationChallenge" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" "VerificationChannel" NOT NULL,
    "target" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "linkToken" TEXT,
    "conversationId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attemptsRemaining" INTEGER NOT NULL DEFAULT 5,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerDocument" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" "CustomerDocumentKind" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'uploaded',
    "encryptedData" BYTEA NOT NULL,
    "dataIv" TEXT NOT NULL,
    "dataTag" TEXT NOT NULL,
    "language" TEXT,
    "extractedFields" JSONB,
    "validationFindings" JSONB,
    "verifiedFields" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dnt" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "productTypesCovered" "ProductType"[],
    "status" "DntStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceSessionId" TEXT NOT NULL,
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dnt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DntSession" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "DntSessionType" NOT NULL,
    "status" "DntSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "baseDntId" TEXT,
    "originConversationId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DntSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DntAnswer" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DntAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "kind" "WorkItemKind" NOT NULL,
    "status" "WorkItemStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "WorkItemPriority" NOT NULL DEFAULT 'MEDIUM',
    "reason" TEXT NOT NULL,
    "refs" JSONB NOT NULL,
    "payload" JSONB,
    "createdBy" TEXT NOT NULL,
    "resolution" TEXT,
    "resolutionCode" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentEvent" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "action" "ConsentAction" NOT NULL,
    "scope" TEXT,
    "sourceCommitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerProfileField" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "provenance" "FieldProvenance" NOT NULL,
    "source" TEXT NOT NULL,
    "evidenceRef" TEXT,
    "conflictValue" TEXT,
    "conflictSource" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProfileField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalDeclarationSignature" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "answersHash" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "sourceCommitId" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalDeclarationSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "language" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "source" "DocumentSource" NOT NULL,
    "productId" TEXT,
    "customerId" TEXT,
    "quoteId" TEXT,
    "policyId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuitabilityWarningAck" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "ruleSetVersion" INTEGER NOT NULL,
    "mismatches" JSONB NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceCommitId" TEXT NOT NULL,

    CONSTRAINT "SuitabilityWarningAck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSchedule" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "status" "PaymentScheduleStatus" NOT NULL DEFAULT 'PENDING_FIRST_CAPTURE',
    "totalInstallments" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installment" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Installment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisclosureAck" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "language" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "sourceCommitId" TEXT,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisclosureAck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommitLedger" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "targetRef" TEXT,
    "argsHash" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "effects" TEXT[],
    "reasonCode" TEXT,
    "phaseFrom" TEXT,
    "phaseTo" TEXT,
    "idempotencyDisposition" TEXT NOT NULL DEFAULT 'fresh',
    "contentVersions" JSONB,
    "envelope" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommitLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductContent_productId_field_status_idx" ON "ProductContent"("productId", "field", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductContent_productId_addonId_field_locale_version_key" ON "ProductContent"("productId", "addonId", "field", "locale", "version");

-- CreateIndex
CREATE INDEX "QuestionDependency_dependsOnKey_idx" ON "QuestionDependency"("dependsOnKey");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionDependency_subjectKey_dependsOnKey_kind_key" ON "QuestionDependency"("subjectKey", "dependsOnKey", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationChallenge_linkToken_key" ON "VerificationChallenge"("linkToken");

-- CreateIndex
CREATE INDEX "VerificationChallenge_customerId_consumedAt_idx" ON "VerificationChallenge"("customerId", "consumedAt");

-- CreateIndex
CREATE INDEX "CustomerDocument_customerId_status_idx" ON "CustomerDocument"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Dnt_sourceSessionId_key" ON "Dnt"("sourceSessionId");

-- CreateIndex
CREATE INDEX "Dnt_customerId_status_idx" ON "Dnt"("customerId", "status");

-- CreateIndex
CREATE INDEX "DntSession_customerId_status_idx" ON "DntSession"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DntAnswer_sessionId_questionId_key" ON "DntAnswer"("sessionId", "questionId");

-- CreateIndex
CREATE INDEX "WorkItem_status_kind_priority_idx" ON "WorkItem"("status", "kind", "priority");

-- CreateIndex
CREATE INDEX "ConsentEvent_customerId_kind_createdAt_idx" ON "ConsentEvent"("customerId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfileField_customerId_field_key" ON "CustomerProfileField"("customerId", "field");

-- CreateIndex
CREATE INDEX "MedicalDeclarationSignature_applicationId_signedAt_idx" ON "MedicalDeclarationSignature"("applicationId", "signedAt");

-- CreateIndex
CREATE INDEX "Document_productId_kind_language_idx" ON "Document"("productId", "kind", "language");

-- CreateIndex
CREATE INDEX "Document_quoteId_idx" ON "Document"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "SuitabilityWarningAck_customerId_applicationId_ruleSetVersi_key" ON "SuitabilityWarningAck"("customerId", "applicationId", "ruleSetVersion");

-- CreateIndex
CREATE INDEX "PaymentSchedule_quoteId_status_idx" ON "PaymentSchedule"("quoteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Installment_scheduleId_sequence_key" ON "Installment"("scheduleId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_provider_providerEventId_key" ON "PaymentEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "DisclosureAck_quoteId_kind_version_language_key" ON "DisclosureAck"("quoteId", "kind", "version", "language");

-- CreateIndex
CREATE INDEX "CommitLedger_conversationId_tool_argsHash_idx" ON "CommitLedger"("conversationId", "tool", "argsHash");

-- CreateIndex
CREATE INDEX "CommitLedger_customerId_createdAt_idx" ON "CommitLedger"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Answer_questionId_applicationId_status_idx" ON "Answer"("questionId", "applicationId", "status");

-- CreateIndex
CREATE INDEX "Application_customerId_status_idx" ON "Application"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

-- AddForeignKey
ALTER TABLE "ProductContent" ADD CONSTRAINT "ProductContent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContent" ADD CONSTRAINT "ProductContent_addonId_fkey" FOREIGN KEY ("addonId") REFERENCES "Addon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationChallenge" ADD CONSTRAINT "VerificationChallenge_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dnt" ADD CONSTRAINT "Dnt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dnt" ADD CONSTRAINT "Dnt_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "DntSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DntSession" ADD CONSTRAINT "DntSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DntSession" ADD CONSTRAINT "DntSession_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DntAnswer" ADD CONSTRAINT "DntAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DntSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DntAnswer" ADD CONSTRAINT "DntAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProfileField" ADD CONSTRAINT "CustomerProfileField_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuitabilityWarningAck" ADD CONSTRAINT "SuitabilityWarningAck_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuitabilityWarningAck" ADD CONSTRAINT "SuitabilityWarningAck_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "PaymentSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "Installment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

