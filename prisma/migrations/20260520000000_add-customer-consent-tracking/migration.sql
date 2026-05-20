-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "gdprConsentAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "gdprConsentScope" TEXT;
ALTER TABLE "Customer" ADD COLUMN "aiDisclosureAcknowledgedAt" TIMESTAMP(3);
