# Zeno Phase Model + Candidate Product — Design

**Status:** Draft
**Date:** 2026-05-26
**Author:** Vasile Tamas + Claude

> **Related work:**
> - [Skill Pack Contract Redesign (2026-05-20)](2026-05-20-zeno-skill-pack-contract-design.md)
> - [State Grounding (2026-05-20)](2026-05-20-zeno-state-grounding-design.md)
> - [Tool-Mediated Side Effects (2026-05-20)](2026-05-20-zeno-tool-mediated-effects-design.md)
> - [Default Discovery Toolset (2026-05-20)](2026-05-20-zeno-discovery-toolset-design.md)

## Problem

Zeno applies application-phase rigor to every turn of a SALES conversation. Observed pathologies in real conversations:

- **`cmpmftp8t000o3k0y0qhtdu8d`** — Customer said *"vreau o asigurare de masina"*, Zeno correctly said no auto products exist; customer asked what's available, Zeno presented Protect; customer said *"da"* (yes, tell me more); Zeno responded with the discovery question *"Ce v-a determinat să vă gândiți la o asigurare de viață acum?"* The customer's irritated reply called it out: *"faptul ca ai numa sigurari de viata in catalog"* — "because you only have life insurance in the catalog." Discovery qualification fires when the catalog already eliminated the qualification choice.

- **`cmpm891f000003k0yv1tz50k1`** — Customer objected to the treatment-abroad addon (*"asta cu tratamentul nu cred ca am nevoie de asa ceva"*). Zeno immediately conceded (*"E perfect în regulă — nu trebuie să vrei neapărat acea opțiune"*). The `get_objection_strategy` tool was called but returned `{ hasStrategy: false, message: 'No product selected for this conversation. Use general sales training...' }` because `Conversation.productId` was null. The rich `ObjectionStrategy` rows (~5000 chars each, 9 types with multiple techniques per type) never reached the LLM.

- **Every multi-turn conversation** has compliance traces flagging *"Product recommendation was made without a formal needs identification first"*, *"No suitability assessment was performed"*, *"Informed consent is insufficient"* — even when the customer is browsing, not buying. These are application-phase concerns being applied during presentation. They are signal noise that obscures real compliance issues.

The common root cause: the system has no concept of **conversation phase**, and tools that need a product context either fail or get nothing useful when `Conversation.productId` is null — which it always is during the entire presentation phase.

## Goals

- Introduce a two-phase model (`presentation` / `application`) derived from existing conversation state.
- Introduce a **candidate product** concept that gives tools and prompts a soft, confidence-bearing product binding before formal commitment.
- Make `get_objection_strategy` and similar product-aware tools usable during presentation via candidate fallback.
- Make the compliance checker phase-aware so it stops flagging premature concerns.
- Make the discovery skill-pack rules phase-aware: skip qualifying questions when the catalog has a single match for the customer's stated intent.

## Non-goals

- Customer-facing UI for the candidate product (no "we are looking at Protect" badge in the chat). The candidate is internal to Zeno; the conversation flows as before.
- Multi-product candidate sets. The current catalog has at most one product per category; supporting candidate *sets* is YAGNI.
- Changing the workflow engine or the `WorkflowStep` model.
- Replacing or restructuring the reasoning gate.
- Migrating the other skill packs (post-sale-*, questionnaire-facilitation) — out of scope; handled separately when those packs become relevant.

## Design

### Phase model

A conversation in SALES mode is in one of two phases at any moment:

| | **PRESENTATION** | **APPLICATION** |
|---|---|---|
| **Trigger** | Default state on conversation creation | `start_application` tool call succeeds |
| **Goal** | Explore catalog, build value, find fit, answer questions | Collect data, run DNT, finalize sale |
| **Product binding** | `candidateProductId` (nullable, has confidence 0-100) | `productId` (mandatory, immutable for the session) |
| **Discovery questions** | Contextual — asked when they help narrow between products or when the customer asks about their own situation | Mandatory + structured (DNT, questionnaire) |
| **Compliance scope** | Transparency only: AI disclosure, insurer disclosure on first product mention, GDPR before PII, no fabricated product claims | Full: DNT-driven needs assessment, suitability, informed consent, all existing checks |
| **Pack rule** | When catalog has a unique match for stated intent, skip qualifying — present the product and defend value | Facilitate the questionnaire, handle late-stage objections, drive to completion |

A third phase, `post_sale`, exists for conversations with `mode === 'POST_SALE'` and is not changed by this design.

### Phase is derived, not stored

No new `Conversation.phase` column. A small helper computes it on demand from existing state:

```ts
// lib/chat/phase.ts
export type ConversationPhase = 'presentation' | 'application' | 'post_sale'

export function getConversationPhase(conv: {
  mode: string
  application: { status: string } | null
}): ConversationPhase {
  if (conv.mode === 'POST_SALE') return 'post_sale'
  if (
    conv.application &&
    conv.application.status !== 'COMPLETED' &&
    conv.application.status !== 'ABANDONED'
  ) {
    return 'application'
  }
  return 'presentation'
}
```

**Why derived:** the information is already in the database. If `Conversation.application` exists and is active, the conversation is in application. A stored `phase` column would be a second source of truth with no extra information — only opportunity for drift. The helper is pure, unit-testable, and every consumer reads it instead of inferring locally.

### Candidate product

A soft binding between a conversation and the product Zeno is currently talking about. Distinct from `Conversation.productId`, which is the *committed* product for an application in progress.

**Storage** — three new columns on `Conversation`:

```prisma
model Conversation {
  // ... existing fields ...
  productId             String?
  product               Product?  @relation("ConversationProduct", fields: [productId], references: [id])
  candidateProductId    String?
  candidateConfidence   Int?      // 0-100; null when candidateProductId is null
  candidateSetAt        DateTime?
  candidateProduct      Product?  @relation("ConversationCandidateProduct", fields: [candidateProductId], references: [id])
}
```

Migration name: `add-conversation-candidate-product`. All three columns nullable; backward-compatible.

**Initial assignment** — at conversation creation (in `orchestrator.ts`'s `resolveConversation()`), if all three hold:

1. `conversation.candidateProductId === null`
2. `conversation.productId === null`
3. The customer's first message OR `Customer.extractedProfile.interests` maps unambiguously to exactly one catalog product. Precedence: the message is checked first; only if the message yields no match are the interests consulted. This prevents stale stored interests from overriding a fresh, explicit intent in the current message.

…then auto-set `candidateProductId` with `candidateConfidence = 70` and `candidateSetAt = now`. The inference helper lives in `lib/chat/candidate-inference.ts`:

```ts
export function inferCandidate(
  message: string,
  interests: string[] | null,
  catalog: Array<{ id: string; insuranceType: string; keywords?: string[] }>,
): { productId: string; confidence: number } | null
```

Implementation is a simple keyword match (e.g. *"viata" / "viață" / "life insurance"* → category LIFE; filter catalog to LIFE; if exactly one product → return it with confidence 70; else null). No ML, no LLM call — runs synchronously, deterministic, cheap.

**Updates** — a new LLM-callable tool `set_candidate_product` lets the agent set, raise, lower, or change the candidate as the conversation progresses (see [Tool: set_candidate_product](#tool-set_candidate_product)).

**Promotion** — when `start_application` is called without an explicit `productId` argument but the conversation has a `candidateProductId`, the candidate is promoted to committed: `productId := candidateProductId`. From that turn forward, the phase helper returns `application` (because an `Application` row now exists).

**Semantics** — the candidate exists for Zeno's internal context:
- Tool fallbacks (objection strategy, product info lookup)
- Prompt grounding ("you are talking about Protect")
- Debug pane visibility

It is **not** a promise to the customer. The chat UI does not surface "we are now looking at Protect" badges. The candidate can be changed at any time during presentation phase.

### Tool: `set_candidate_product`

Registered in `lib/tools/registry.ts`, handler in `lib/tools/handlers/candidate-handlers.ts` (new file).

```ts
description: "Set or update the candidate product the conversation is " +
             "currently focused on. Use when the customer's intent is clear " +
             "enough that you can confidently say 'we are talking about X.' " +
             "Re-call to raise/lower confidence or to change the candidate " +
             "if the customer pivots."

parameters: {
  type: 'object',
  properties: {
    productId: { type: 'string', description: 'Product ID to set as the candidate.' },
    confidence: { type: 'integer', minimum: 0, maximum: 100,
                  description: 'Your confidence the customer is converging on this product.' },
  },
  required: ['productId', 'confidence'],
  additionalProperties: false,
}

executionMode: 'blocking'
sideEffect: 'lifecycle'
alwaysAllowed: true
allowedRoles: ALL_ROLES
```

The handler updates `Conversation.candidateProductId`, `candidateConfidence`, and `candidateSetAt`. It returns a `ToolResult.confirmation` payload so the change appears in the subsystem-C confirmation rail and in the debug pane:

```ts
return {
  success: true,
  data: { candidateProductId, candidateConfidence },
  confirmation: {
    category: 'lifecycle',
    label: 'Candidate product set',
    value: `${product.name} (confidence ${confidence})`,
    timestamp: new Date().toISOString(),
  },
}
```

If called with the same `productId` + same `confidence` as already stored, it's a no-op (returns success without writing).

### Tool: `get_objection_strategy` — candidate fallback

Update `lib/tools/handlers/objection-handlers.ts`. New lookup order:

```
1. If conversation.productId is set        → use it
2. Else if conversation.candidateProductId is set → use it
3. Else if the active skill packs imply a category AND that category
   has exactly one product in the catalog  → use it
4. Else                                    → return the existing
                                              "no product" generic message
```

Steps 2 and 3 query the existing `ObjectionStrategy` table the same way as step 1 — no schema change, no new strategy rows needed beyond what already exists (and what gets added per thread #2's `addon_no_need` proposal, handled in a follow-up plan).

Step 3 ("active-pack inference fallback") catches conversations that have no explicit candidate yet but where the gate has activated a category-specific pack. E.g., `life-insurance-discovery` is active, the catalog has exactly one life-insurance product → use Protect. This makes the tool useful on the very first turn of an existing conversation that predates the schema change, before any candidate has been set.

### Tool: `start_application` — candidate promotion

Update the handler in `lib/tools/handlers/application-handlers.ts`. New parameter semantics:

```ts
parameters: {
  productId: { type: 'string', description:
    'Optional. If omitted, the conversation candidate product is used.' },
}
```

Behavior:
- Called with explicit `productId` → use it (existing path).
- Called without `productId` and `Conversation.candidateProductId` is set → use the candidate. Inside the same DB transaction:
  - `Application` row created with `productId = conversation.candidateProductId`
  - `Conversation.productId := conversation.candidateProductId`
  - Phase flips automatically (via `getConversationPhase` reading the new `Application` row)
- Called without `productId` and no candidate → return `{ success: false, error: 'No product selected. Call set_candidate_product first or pass productId explicitly.' }`. The LLM gets a clear hint about what to do next.

### Compliance checker — phase awareness

In `lib/chat/compliance-checker.ts`, the checker currently runs a single LLM-based audit pass. Change:

1. Add `phase: ConversationPhase` to the checker's input.
2. The checker's prompt template branches on phase:
   - **`presentation`**: check only AI disclosure (when context warrants), insurer disclosure on first product mention, GDPR before PII collection, no fabricated product/price/inventory claims. The checker's prompt explicitly enumerates these four and says **"Do NOT flag missing needs assessment, missing suitability assessment, or insufficient informed consent — these belong to the application phase and will be enforced by the DNT."**
   - **`application`**: all current checks apply unchanged.
3. The `complianceResult.gaps` array shape is unchanged; downstream consumers (orchestrator phase tracking) need no modifications.

The `phase` value is computed in the orchestrator via `getConversationPhase` and passed to the checker alongside the existing inputs.

### Pack-rule update — discovery pack `domainGuidance`

The discovery pack content (in `domainGuidance`, post the thread-#1 migration) gets one targeted addition. After the existing "Reguli stricte" section, insert:

```
### Când catalogul are un singur match pentru intenția clientului
Dacă clientul a numit o categorie de asigurare și catalogul are EXACT un
produs în acea categorie:
- NU întreba "ce v-a determinat să vă gândiți la asta acum?" — clientul îți
  spune deja că vrea acea categorie, iar tu ai un singur produs de oferit.
- SARI peste qualifying questions. Prezintă produsul direct, leading with
  the differentiator (vezi secțiunea "Cum prezinți Protect prima dată").
- DISCOVERY se transformă în DEEPENING: în loc să întrebi de ce, întreabă
  ce parte îl interesează cel mai mult ("familia, accesul la tratament, sau
  acoperirea pentru accidente?") — asta îți zice cum să adâncești prezentarea.

Acest mod se aplică DOAR cât timp suntem în faza de presentation (înainte de
start_application). Odată ce începem aplicația, întrebările structurate ale
DNT-ului preiau rolul.
```

Update `prisma/seeds/seed-skill-packs.ts` and run the existing `reseed-skill-packs.ts` script to push the change. No new infrastructure.

### Auto-assignment on conversation creation — `lib/chat/orchestrator.ts`

In `resolveConversation()` (currently around line 207), after the conversation is created and the customer is loaded but before `loadTurnContext`, add a candidate-inference step that runs only when:

```ts
if (
  conversation.candidateProductId === null &&
  conversation.productId === null &&
  state.messageCount === 0  // first user message of this conversation
) {
  const catalog = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, insuranceType: true, keywords: true },
  })
  const guess = inferCandidate(input.message, customer.extractedProfile?.interests ?? null, catalog)
  if (guess) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        candidateProductId: guess.productId,
        candidateConfidence: guess.confidence,
        candidateSetAt: new Date(),
      },
    })
    // Re-fetch so turnCtx reflects the new candidate
    conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })
  }
}
```

(Pseudocode; the exact integration point and re-fetch strategy will be pinned down in the implementation plan.)

The inference is keyword-based, runs synchronously, and adds ~5-10ms per conversation creation. It runs once per conversation, not per turn.

### Default tools — `lib/chat/default-tools.ts`

Add `set_candidate_product` to the default discovery baseline alongside the existing tools. It is always available because:
- In presentation: the LLM needs it to pin/change the candidate.
- In application: it is rarely needed (productId is committed) but having it available causes no harm — the tool can update the candidate to match productId or be ignored.

`get_objection_strategy` and `start_application` are already in appropriate default sets; no changes there.

## Data flow

```
turn start
  ↓
orchestrator.resolveConversation()
  → if first turn AND no candidate AND no productId → inferCandidate
  → write candidateProductId if inference succeeded
  ↓
turnCtx = loadTurnContext (now includes the new candidate columns)
  ↓
phase = getConversationPhase(turnCtx.conversation)
  ↓
reasoningGate runs (unchanged)
  ↓
loadAllSections (unchanged structurally; receives phase via stateGroundingInput)
  ↓
prompt built — system prompt includes "current phase: presentation" line in StateGrounding
  ↓
LLM call — tools available include set_candidate_product
  ↓
tool calls:
  - get_objection_strategy → uses productId, falls back to candidate, falls back to pack-inferred catalog match
  - start_application → uses explicit productId or promotes candidate
  - set_candidate_product → updates candidate, returns confirmation
  ↓
compliance checker — receives phase, applies the matching rule set
  ↓
turn end
```

## Error handling

- **Inference returns conflicting matches** (e.g. user mentions multiple insurance types in one message): `inferCandidate` returns null. The LLM may call `set_candidate_product` explicitly later when intent clarifies.
- **`set_candidate_product` called with invalid `productId`**: handler returns `{ success: false, error: 'Product not found: <id>' }`. No DB write.
- **`set_candidate_product` called during application phase**: handler returns success but writes nothing (effectively a no-op). Rationale: forbidding it would force the LLM to do phase-checking; allowing-but-ignoring is simpler and the committed `productId` is the source of truth anyway.
- **`start_application` called with neither productId nor candidate**: handler returns failure with hint, as above.
- **Compliance checker receives an unknown phase value**: defaults to `application`-phase rules (fail-closed). Should never happen given the helper's return type.

## Testing

### Unit

- `lib/chat/__tests__/phase.test.ts`:
  - `getConversationPhase` returns `'presentation'` when no application exists.
  - Returns `'application'` when `application.status` is `ACTIVE` / `IN_PROGRESS` / `SUBMITTED`.
  - Returns `'presentation'` when `application.status` is `COMPLETED` or `ABANDONED` (covers abandonment → back-to-presentation case).
  - Returns `'post_sale'` when `mode === 'POST_SALE'` regardless of application status.

- `lib/chat/__tests__/candidate-inference.test.ts`:
  - `inferCandidate("vreau asigurare de viata", null, [protect])` returns `{ productId: protect.id, confidence: 70 }`.
  - `inferCandidate("vreau o asigurare de masina", null, [protect])` returns `null` (no auto product in catalog).
  - `inferCandidate("buna ziua", null, [protect])` returns `null` (no category named).
  - `inferCandidate("", ["life insurance"], [protect])` returns `{ productId: protect.id, confidence: 70 }` (uses interests fallback).
  - With multiple products in the same category, returns `null` (ambiguous).

- `lib/tools/__tests__/candidate-handlers.test.ts`:
  - `set_candidate_product` writes the three columns and returns a confirmation payload.
  - No-op when called with same productId + same confidence.
  - Returns failure when productId is unknown.

- `lib/tools/__tests__/objection-handlers-fallback.test.ts`:
  - Falls back to `candidateProductId` when `productId` is null.
  - Falls back to active-pack-inferred catalog match when both are null.
  - Returns the existing generic message only when truly no match is possible.

### Integration

- `__tests__/integration/phase-transition.test.ts`:
  - Create a conversation, no application → phase is `presentation`.
  - Call `start_application` with a set candidate → application row created, conversation `productId` set, phase becomes `application`.
  - Abandon the application (`status = ABANDONED`) → phase returns to `presentation`.

- `__tests__/integration/auto-candidate-assignment.test.ts`:
  - New conversation with first message "vreau o asigurare de viata" → candidate is auto-set to Protect with confidence 70.
  - New conversation with first message "buna ziua" → no candidate set.

### Manual verification

Per the user's CLAUDE.md ("every runtime behavior change needs a verification step"):

1. Start a fresh chat. First message: *"vreau o asigurare de viata"*.
2. Confirm in the debug pane (Identity & Stored Context card, or a new Phase row) that:
   - `candidateProductId` is set to Protect
   - `candidateConfidence` is 70
   - phase is `presentation`
3. Continue the conversation. When Zeno presents Protect, confirm he leads with the differentiator (treatment-abroad) — this exercises the discovery-pack content from thread #1 AND the new "single match → skip qualifying" rule.
4. Object to the addon: *"asta cu tratamentul nu cred ca am nevoie"*. Confirm Zeno calls `get_objection_strategy` and that the tool now returns substantive strategy text (no longer "no product selected"). Confirm his response validates → probes → reframes with concrete cost.
5. Say *"vreau să încep aplicația"*. Confirm `start_application` is called, the application row is created, conversation `productId` is set, and the next turn's debug shows phase = `application`.
6. Inspect the turn trace's `complianceResult`: in presentation turns it must NOT include "missing needs assessment" gaps; in application turns those gaps may appear (DNT runs in application).

## Migration

1. **Apply schema migration** `add-conversation-candidate-product`.
2. **Deploy code changes** in this order to avoid lookup failures:
   - `phase.ts` helper
   - `candidate-inference.ts` helper
   - `candidate-handlers.ts` + tool registration
   - `objection-handlers.ts` fallback
   - `application-handlers.ts` promotion
   - Orchestrator integration (auto-assignment + phase wiring)
   - Compliance checker phase awareness
3. **Re-seed skill packs** (the discovery pack content addition) via the existing `reseed-skill-packs.ts` script.
4. **Existing conversations**: no data backfill needed. Conversations without `candidateProductId` simply skip step 2 of the objection-strategy fallback and use step 3 (active-pack inference) instead. When the customer sends a new message, the orchestrator's `state.messageCount === 0` check prevents re-running inference (it gates on first turn only), so existing multi-turn conversations are not retroactively assigned — they stay as they are. The LLM can still call `set_candidate_product` to pin one explicitly.

## Out of scope (follow-ups for separate work)

- Multi-product candidate sets.
- Customer-facing UI showing the candidate ("we are looking at Protect").
- Migrating the other skill packs (`questionnaire-facilitation`, `post-sale-*`) to align with phase semantics.
- A "candidate clearing" tool (`unset_candidate_product`) — current design doesn't need it; the LLM can call `set_candidate_product` with a different productId to overwrite.
- Multi-category intent (customer wants both home and life). The inference helper returns `null` for now; explicit `set_candidate_product` lets the LLM disambiguate.
- Telemetry on auto-assignment success/failure rates. Useful later; not part of v1.
