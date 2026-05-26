-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "candidateProductId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "candidateConfidence" INTEGER;
ALTER TABLE "Conversation" ADD COLUMN "candidateSetAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_candidateProductId_fkey" FOREIGN KEY ("candidateProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
