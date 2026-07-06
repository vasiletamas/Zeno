-- A1 (autonomy-skills-cost plan 2026-07-06): cache telemetry columns.
-- TurnTrace: per-turn prompt-cache read/write token sums (null = pre-A1 row).
ALTER TABLE "TurnTrace" ADD COLUMN "cacheReadTokens" INTEGER;
ALTER TABLE "TurnTrace" ADD COLUMN "cacheWriteTokens" INTEGER;

-- ConversationScore: per-conversation aggregates computed at scoring time.
ALTER TABLE "ConversationScore" ADD COLUMN "totalPromptTokens" INTEGER;
ALTER TABLE "ConversationScore" ADD COLUMN "totalCachedTokens" INTEGER;
ALTER TABLE "ConversationScore" ADD COLUMN "avgCacheHitRate" DOUBLE PRECISION;
