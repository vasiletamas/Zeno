-- E1 (autonomy-skills-cost plan 2026-07-06): phase-/turn-scoped prompt
-- sections, keyed by SECTION_REGISTRY key (firstTurnRules, discoveryConduct).
-- systemPrompt stays the always-on constitution; null = pre-split agent row
-- (the whole prompt still lives in systemPrompt — no content is lost).
ALTER TABLE "Agent" ADD COLUMN "promptSections" JSONB;
