-- CreateTable
CREATE TABLE "SimulationRun" (
  "id"             TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'RUNNING',
  "trigger"        TEXT NOT NULL,
  "config"         JSONB NOT NULL,
  "totalScenarios" INTEGER NOT NULL,
  "completedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount"    INTEGER NOT NULL DEFAULT 0,
  "avgScore"       DOUBLE PRECISION,
  "errors"         JSONB NOT NULL DEFAULT '[]',
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SimulationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationConversation" (
  "id"             TEXT NOT NULL,
  "runId"          TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "personaSlug"    TEXT NOT NULL,
  "scenarioType"   TEXT NOT NULL,
  "scenarioSlug"   TEXT,
  "status"         TEXT NOT NULL DEFAULT 'RUNNING',
  "turnCount"      INTEGER NOT NULL DEFAULT 0,
  "error"          TEXT,
  "score"          DOUBLE PRECISION,
  "durationMs"     INTEGER,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SimulationConversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimulationRun_status_idx" ON "SimulationRun"("status");
CREATE INDEX "SimulationRun_startedAt_idx" ON "SimulationRun"("startedAt");
CREATE UNIQUE INDEX "SimulationConversation_conversationId_key" ON "SimulationConversation"("conversationId");
CREATE INDEX "SimulationConversation_runId_idx" ON "SimulationConversation"("runId");
CREATE INDEX "SimulationConversation_personaSlug_idx" ON "SimulationConversation"("personaSlug");

-- AddForeignKey
ALTER TABLE "SimulationConversation" ADD CONSTRAINT "SimulationConversation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SimulationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SimulationConversation" ADD CONSTRAINT "SimulationConversation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
