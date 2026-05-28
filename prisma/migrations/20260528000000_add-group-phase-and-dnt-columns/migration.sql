-- AlterTable QuestionGroup: add nullable phase column
ALTER TABLE "QuestionGroup" ADD COLUMN "phase" TEXT;

-- AlterTable Conversation: add DNT signing columns
ALTER TABLE "Conversation" ADD COLUMN "dntSignedAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN "dntValidUntil" TIMESTAMP(3);

-- Backfill phase for existing groups (idempotent; new seed also sets these)
UPDATE "QuestionGroup" SET "phase" = 'dnt' WHERE "code" LIKE 'dnt\_%';
UPDATE "QuestionGroup" SET "phase" = 'application' WHERE "code" IN ('application', 'bd_medical');
