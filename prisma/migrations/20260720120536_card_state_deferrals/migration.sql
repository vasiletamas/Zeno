-- CreateTable
CREATE TABLE "ProfileFieldDeferral" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "conversationId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileFieldDeferral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfileFieldDeferral_customerId_field_createdAt_idx" ON "ProfileFieldDeferral"("customerId", "field", "createdAt");
