# Context Hits — Confirm-Not-Reask for Questionnaire Steps — Design

**Status:** Draft
**Date:** 2026-05-19
**Author:** Vasile Tamas + Claude

## Goal

When a workflow questionnaire step (`application_fill`, `dnt_questionnaire`, `bd_medical`) is about to ask a question whose answer was already established earlier in the conversation, the bot must **confirm** the known value with the user — not re-ask the original question from scratch. Today, the bot mechanically asks every unanswered question even when the customer already stated a preference (e.g. user says "vreau Standard I", workflow later asks "Standard sau Optim?").

The fix is systemic: extract customer signals into structured insights, surface a `[CONTEXT HIT]` block in the prompt when an insight matches the current question, and instruct the LLM to confirm-not-reask.

## Non-Goals (v1)

- Batch-summary confirmation card ("Confirm aceste preferințe: ...")
- Silent auto-fill (skip questions without user confirmation)
- Insight confidence bumping on repeat confirmation
- LLM-judge automated tests for prompt-following behavior
- Cross-product preference transfer (`selectedTier` from Protect → House)
- Admin UI to view or edit customer insights
- Negative-confirmation tracking as quality signal
- Multi-insight backing for a single question
- Insight expiry / TTL
- LLM-fuzzy fallback when `insightKey` is not set
- Migration to namespaced insight keys (`life.selectedTier`)

If any of these become valuable later they are layered on top — they do not invalidate this design.

## Architecture

Three coordinated changes, all small, all behind validation that fails safe.

```
                  ┌──────────────────────────────────┐
   user turn ───► │ STEP 9 (background, per turn)   │
                  │ extractAndPersistInsights()      │
                  │ — drops regex gate for SALES     │
                  │ — receives active key vocabulary │
                  │ — validates keys at insert       │
                  └──────────────────────────────────┘
                                 │
                                 ▼  upsert
                  ┌──────────────────────────────────┐
                  │       CustomerInsight table       │
                  │  category | key | value | confidence
                  │  source (conversationId) | productId? (new col)
                  └──────────────────────────────────┘
                                 ▲
                                 │  per-question lookup
                                 │
   next turn ────► loadQuestionnaireContext()
                     │   for the current unanswered question:
                     │     findContextHit(customerId, question, threshold=0.8)
                     │     if hit → append [CONTEXT HIT] block to context section
                     ▼
              prompt → LLM: "Confirmi Standard I?"
                       user: DA → save_application_answer
                            NU  → ask the original question
```

### New units

- `lib/insights/keys.ts` — global core insight key vocabulary (`GLOBAL_INSIGHT_KEYS`) and `getActiveInsightKeys(productId)` helper merging globals + per-product extensions
- `lib/insights/extractor.ts` — `extractAndPersistInsights({...})` containing the broadened extraction logic moved from `orchestrator.ts`
- `lib/insights/context-hits.ts` — `findContextHit(customerId, question, threshold)` returning a `ContextHit` or null

### Touched existing units

- `lib/chat/orchestrator.ts` — STEP 9 background block becomes a 3-line call to `extractAndPersistInsights`
- `lib/chat/context-loaders.ts` — `loadQuestionnaireContext` calls `findContextHit` and appends a `[CONTEXT HIT]` block when present
- `prisma/schema.prisma` — additive: `Question.insightKey?` String column, `CustomerInsight.productId?` String column, `Product.insightKeys?` Json column
- `lib/tools/handlers/application-handlers.ts` (or wherever `save_application_answer` lives) — bumps `lastConfirmedAt` on the matching insight when a question with `insightKey` gets answered

## Schema additions

```prisma
model Question {
  // ...existing fields
  insightKey  String?   // points at a key from the active vocabulary; null = no context-hit lookup
}

model CustomerInsight {
  // ...existing fields
  productId   String?   // optional: scope per-product insights; null for global keys
  product     Product?  @relation(fields: [productId], references: [id])
}

model Product {
  // ...existing fields
  insightKeys Json?     // array of { key, category, type, options? } — product-specific vocabulary
}
```

All three are additive and nullable. Zero-risk for unmapped questions and existing products.

## Insight key vocabulary

### Global core (`lib/insights/keys.ts`)

Applies to every product, every conversation. Initial set:

```ts
export const GLOBAL_INSIGHT_KEYS: InsightKeySpec[] = [
  // DEMOGRAPHIC
  { key: 'age', category: 'DEMOGRAPHIC', type: 'number' },
  { key: 'occupation', category: 'DEMOGRAPHIC', type: 'string' },
  { key: 'familySize', category: 'DEMOGRAPHIC', type: 'number' },
  { key: 'hasSpouse', category: 'DEMOGRAPHIC', type: 'boolean' },
  { key: 'hasChildren', category: 'DEMOGRAPHIC', type: 'boolean' },
  { key: 'incomeLevel', category: 'DEMOGRAPHIC', type: 'enum', options: ['low', 'medium', 'high'] },

  // RISK_FACTOR
  { key: 'smokingStatus', category: 'RISK_FACTOR', type: 'enum', options: ['smoker', 'non_smoker', 'former'] },
  { key: 'hazardousOccupation', category: 'RISK_FACTOR', type: 'boolean' },
  { key: 'chronicConditions', category: 'RISK_FACTOR', type: 'string' },

  // BUYING_SIGNAL
  { key: 'urgency', category: 'BUYING_SIGNAL', type: 'enum', options: ['immediate', 'weeks', 'exploring'] },
  { key: 'primaryMotivation', category: 'BUYING_SIGNAL', type: 'enum', options: ['family_protection', 'self_protection', 'investment'] },
]
```

### Per-product (stored as `Product.insightKeys` JSON)

Each Product row carries its own extensions. Initial Protect:

```json
[
  { "key": "selectedTier", "category": "PREFERENCE", "type": "enum", "options": ["Standard", "Optim"] },
  { "key": "selectedLevel", "category": "PREFERENCE", "type": "enum", "options": ["I", "II", "III"] },
  { "key": "selectedAddon_externalTreatment", "category": "PREFERENCE", "type": "boolean" },
  { "key": "budgetPreference", "category": "BUYING_SIGNAL", "type": "enum", "options": ["lowest", "balanced", "best_coverage"] }
]
```

A future House product would add `propertySquareMeters`, `propertyType`, `propertyCity`, etc. without touching any code.

### Combined lookup

```ts
async function getActiveInsightKeys(productId: string | null): Promise<InsightKeySpec[]> {
  const productKeys = productId
    ? (await prisma.product.findUnique({ where: { id: productId }, select: { insightKeys: true } }))
        ?.insightKeys as InsightKeySpec[] | null
    : null
  return [...GLOBAL_INSIGHT_KEYS, ...(productKeys ?? [])]
}
```

## Extraction (Step 9 background)

`extractAndPersistInsights` (the new module-level function) replaces the inline block at `lib/chat/orchestrator.ts:1326-1384`. Behavior changes:

1. **Trigger**: in `SALES` mode, always run. In other modes, keep the existing regex gate as a safety net.
2. **Vocabulary injection**: the active key list is passed to the `profile-extractor` agent as a system prefix. The agent is instructed to emit only keys from the list.
3. **Validation at insert**: keys not in the active vocabulary are dropped with `logWarn({ layer: 'orchestrator', category: 'extractor_drift' })`. Never silently inserted.
4. **Confidence**: if the extractor returns `{key, value, confidence}` triples, use the returned confidence. Otherwise default to `0.7` (slightly bumped from today's `0.6`; the `0.8` CONTEXT HIT threshold gives meaningful headroom).
5. **`productId` stamping**: per-product keys carry the active `state.productId` on the inserted `CustomerInsight` row. Global keys leave `productId: null`.
6. **Move to its own file**: `lib/insights/extractor.ts`. Unit-testable in isolation; the orchestrator call shrinks to ~3 lines.

## Lookup (`findContextHit`)

Pure async function at `lib/insights/context-hits.ts`:

```ts
export interface ContextHit {
  key: string
  value: string
  confidence: number
  source: string
  lastConfirmedAt: Date
}

export async function findContextHit(
  customerId: string,
  question: QuestionForLookup,  // { id, insightKey, options?, group: { code } }
  conversationId: string,
  threshold: number = 0.8,
): Promise<ContextHit | null>
```

Behavior:

1. If `question.insightKey` is null → return null (no DB call).
2. Fetch the insight via `(customerId, key)` unique index.
3. If missing or `confidence < threshold` → return null.
4. **Scoping rules** (per Section 4 refinement + Section 6 medical rule):
   - `PREFERENCE` category insights: must have `source === conversationId`. Otherwise null.
   - In `bd_medical` group AND insight category is `RISK_FACTOR`: must have `source === conversationId`. Otherwise null.
   - All other (DEMOGRAPHIC, BUYING_SIGNAL, non-medical RISK_FACTOR) — cross-conversation allowed.
5. **Validation**: if the question has an `options` array, the insight value must match one of those option values (case-sensitive). Otherwise null and `logWarn({ layer: 'questionnaire', category: 'extractor_value_mismatch' })`.
6. Return the hit.

## Prompt change

`loadQuestionnaireContext` (existing function at `lib/chat/context-loaders.ts:271`) is extended. After rendering the existing `[ACTIVE QUESTIONNAIRE]` block and current question, if a CONTEXT HIT exists for the current question, append:

```
[CONTEXT HIT for current question]
We already extracted this from the conversation:
  field: <insightKey>
  value: "<value>"
  confidence: <0.00>
  extracted from conversation: <source>

INSTRUCTIONS — DO NOT RE-ASK:
  Instead of asking the original question, confirm the value with the user.
  Example phrasing: "Înțeleg că vrei <value> — confirmi?"
  If user says yes/confirms → call <answer-saving tool> with answer="<value>".
  If user says no/wants something different → ask the original question normally.
```

**For `bd_medical` RISK_FACTOR hits**, additionally inject:

```
For this medical/risk declaration:
  Use explicit phrasing — the customer must consciously affirm.
  Required pattern: "Pentru declarația medicală oficială: confirmi că <value>?
                     Te rog răspunde cu DA sau NU."
  Never accept implicit confirmation (e.g. "ok"). Only explicit yes/da.
```

The CONTEXT HIT block lives inside the existing `questionnaireContext` prompt section (no new top-level section). They're always rendered together and pulled in/out as a pair by the reasoning gate.

## Confirmed-answer write-back

No new tool. Existing tools (`save_application_answer` for `application_fill` and `bd_medical`, equivalent for `dnt_questionnaire`) already handle:

- Writing `Application.tierId / levelId / includesAddon` columns when the question maps to those.
- Writing `Answer` table rows for `dnt_*` and `bd_medical` group questions.

**One addition** to the answer-saving handler: after a successful write, if the question has `insightKey`, bump `lastConfirmedAt = now()` on the matching `CustomerInsight` row. Confidence is **not** bumped in v1.

Negative-confirmation path (user says "nu, vreau Optim"): the LLM calls the same tool with the corrected value. The insight gets overwritten by the next extractor run on the user's correction message. No special handling.

## Compliance audit — `bd_medical`

When a CONTEXT HIT fires for a `bd_medical` question with `RISK_FACTOR` category, the lookup site writes an audit log entry via the existing logger:

```ts
logInfo({
  layer: 'compliance',
  category: 'context_hit_medical',
  message: 'Medical CONTEXT HIT presented for explicit affirmation',
  context: { customerId, conversationId, questionCode, insightKey, value, confidence },
})
```

A second log entry is written when the corresponding answer is saved (`userAffirmation: 'confirmed'`) or when the next questionnaire context load shows the question still unanswered with the hit gone (`userAffirmation: 'denied'`). The denied case may need a small piggyback hook in the questionnaire-context loader or the answer-saving handler — implementation chooses whichever is cleaner.

Text "DA" affirmation is treated as sufficient for v1 (per user decision). The audit log is the paper trail.

## Testing strategy

| Test | File | Asserts |
|---|---|---|
| Key vocabulary scoping | `__tests__/lib/insights/keys.test.ts` | `getActiveInsightKeys(productId)` returns globals + product-specific; null/unknown productId returns globals only without throw |
| `findContextHit` happy path | `__tests__/lib/insights/context-hits.test.ts` | Conf 0.9, valid options → returns hit |
| `findContextHit` rejects below threshold | same | Conf 0.7 → returns null |
| `findContextHit` rejects invalid value | same | Value not in options → returns null + warn log |
| `findContextHit` no insightKey | same | Question.insightKey null → returns null, no DB call |
| `findContextHit` PREFERENCE cross-conv rule | same | Insight from different conversation, PREFERENCE category → null. DEMOGRAPHIC → hit |
| `findContextHit` bd_medical RISK_FACTOR cross-conv rule | same | RISK_FACTOR insight from past conversation + question in bd_medical group → null. Same in non-medical group → hit |
| `extractAndPersistInsights` validates keys | `__tests__/lib/insights/extractor.test.ts` | Returns `{age: 40, bogusKey: 'x'}` → asserts age upserted, bogusKey dropped with warn |
| `extractAndPersistInsights` skips non-SALES | same | mode=`ONBOARDING` and no regex match → no gateway call |
| `loadQuestionnaireContext` appends CONTEXT HIT | `__tests__/lib/chat/context-loaders.context-hit.test.ts` | Seeds customer + question + insight; returned string contains CONTEXT HIT block with correct value/confidence |
| Manual runtime — confirm flow | n/a | curl: send preference message, inspect next turn's prompt via debug panel, send confirm "DA", verify save_application_answer called with that value |
| Manual runtime — medical audit | n/a | Trigger CONTEXT HIT against a bd_medical question; verify compliance log row written with right shape |

Per `CLAUDE.md`: every step that changes runtime behavior has a test; manual verification covers what unit tests can't reach (LLM prompt-following). Adding LLM-judge automated tests for emergent prompt behavior is explicitly out of v1.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Extractor drift (LLM emits a key not in vocabulary) | `extractAndPersistInsights` validates each key against the active vocabulary at insert; unknown keys are dropped with a warn log. Closed-vocabulary system prefix in the extractor instructions reduces incidence. |
| Stale PREFERENCE insights causing wrong confirm | `findContextHit` requires `source === conversationId` for PREFERENCE — preferences only carry within the current chat. |
| Medical pre-fill compliance liability | `bd_medical` RISK_FACTOR forces same-conversation source + explicit-DA affirmation phrasing + audit log entry per hit. No silent pre-fill ever. |
| Extractor cost added to every SALES turn | ~50-100ms per message on the cheap model. 10-turn conversation: +1 second total. Acceptable for the value. |
| Future product needing a key with a colliding name | All v1 insight keys are flat-namespace. If a future product wants `selectedTier` to mean something different, we add namespacing then (out of scope for v1). |
| Existing questions don't have `insightKey` populated | The column is nullable; null = no lookup, no behavior change. Seeding script updates only those questions we explicitly map. Un-mapped questions still ask the original question, as today. |

## Rollout

Single PR. No feature flag — the behavior is keyed on `Question.insightKey != null`, which starts at zero rows and gets populated by the seed script. Until the seed runs, behavior is identical to today. Running the seed script flips the new behavior on per-question.

If something goes wrong post-merge, revert by running an "unseed" script that NULLs the `insightKey` column on every question — bot returns to current behavior immediately. The schema columns themselves stay (they're additive and nullable).
