BEGIN;

-- 1. Add role column to Agent with a temp default, populate from type, then drop default
ALTER TABLE "Agent" ADD COLUMN "role" TEXT NOT NULL DEFAULT '';
UPDATE "Agent" SET "role" = LOWER(REPLACE("type"::TEXT, '_', '-'));
ALTER TABLE "Agent" ALTER COLUMN "role" DROP DEFAULT;

-- 2. Drop type column from Agent
ALTER TABLE "Agent" DROP COLUMN "type";

-- 3. Drop AgentType enum
DROP TYPE "AgentType";

-- 4. Create SkillPack table
CREATE TABLE "SkillPack" (
  "id"             TEXT NOT NULL,
  "slug"           TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "category"       TEXT NOT NULL,
  "description"    TEXT NOT NULL,
  "promptSections" JSONB NOT NULL,
  "allowedTools"   TEXT[] NOT NULL,
  "constraints"    TEXT,
  "flags"          JSONB,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "priority"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkillPack_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SkillPack_slug_key" ON "SkillPack"("slug");

-- 5. Create join table for Agent <-> SkillPack many-to-many
CREATE TABLE "_AgentToSkillPack" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL
);
CREATE UNIQUE INDEX "_AgentToSkillPack_AB_unique" ON "_AgentToSkillPack"("A", "B");
CREATE INDEX "_AgentToSkillPack_B_index" ON "_AgentToSkillPack"("B");
ALTER TABLE "_AgentToSkillPack" ADD CONSTRAINT "_AgentToSkillPack_A_fkey" FOREIGN KEY ("A") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_AgentToSkillPack" ADD CONSTRAINT "_AgentToSkillPack_B_fkey" FOREIGN KEY ("B") REFERENCES "SkillPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Add mode and activeSkillPacks to Conversation
ALTER TABLE "Conversation" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'SALES';
ALTER TABLE "Conversation" ADD COLUMN "activeSkillPacks" TEXT[] NOT NULL DEFAULT '{}';

COMMIT;
