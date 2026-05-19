-- AlterTable
ALTER TABLE "CustomerInsight" ADD COLUMN     "productId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "insightKeys" JSONB;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "insightKey" TEXT;

-- AddForeignKey
ALTER TABLE "CustomerInsight" ADD CONSTRAINT "CustomerInsight_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
