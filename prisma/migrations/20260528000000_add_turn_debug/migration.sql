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

-- CreateIndex
CREATE UNIQUE INDEX "TurnDebug_traceId_key" ON "TurnDebug"("traceId");

-- CreateIndex
CREATE INDEX "TurnDebug_conversationId_messageIndex_idx" ON "TurnDebug"("conversationId", "messageIndex");

-- AddForeignKey
ALTER TABLE "TurnDebug" ADD CONSTRAINT "TurnDebug_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
