-- AlterEnum
-- Add Moonshot AI (Kimi) as a third LLM vendor alongside OPENAI and ANTHROPIC.
-- IF NOT EXISTS keeps the migration idempotent across replays; Postgres 12+
-- permits ADD VALUE inside the migration transaction.
ALTER TYPE "LLMProvider" ADD VALUE IF NOT EXISTS 'MOONSHOT';
