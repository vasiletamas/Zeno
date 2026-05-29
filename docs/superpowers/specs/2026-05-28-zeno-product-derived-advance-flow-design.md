# Zeno — Product-Derived Advance Flow (Design)

**Date:** 2026-05-28
**Status:** Design — awaiting review before implementation planning
**Author:** session with Vasile

## Problem

In real conversation `cmpp27t1c002ciw0ygr0627xa`, Zeno presented Protect well, the
customer converged on **Standard Nivel I**, and then Zeno **stalled** — it
ceremonially "confirmed Protect", committed the product, and asked `câți ani ai?`
as a freeform question instead of advancing toward a quote. DB state at that point:

```
productId:          protect   (committed)
candidateProductId: protect   (confidence 92)
application:        null
workflowSession:    null
```

### Root cause (verified from source)

Two incompatible models are layered into the same agent:

1. A **legacy workflow-session model**: the prompt tells the agent to ceremonially
   ask *"confirmi că alegi Protect?"* then call `set_conversation_product`
   (`seed-agents.ts:383`), after which *"a product-specific workflow will activate
   automatically"* (`seed-workflows.ts:91`) and *"the system will call
   `start_application` automatically — you don't need to call it yourself"*
   (`seed-workflows.ts:219`).
2. A newer **candidate/phase model** (2026-05-26): `set_candidate_product` (soft
   binding, auto-assigned) → `start_application` promotes the candidate and starts
   the questionnaire; phase is derived from `application.status`.

The legacy promises are **false against the code**:

- `setConversationProduct` (`product-handlers.ts:140-143`) only writes
  `conversation.productId`. It creates no workflow, no application, nothing else.
- **No application code anywhere creates a `WorkflowSession`** (only the generated
  Prisma client references `workflowSession.create`). The "auto-activation" never
  existed.
- Consequently the agent commits the product (internal, `customerVisible:false`)
  and waits for an advance that never happens → it ad-libs `câți ani ai?`.

Two further consequences discovered while tracing:

- **Question groups are hardcoded, not product-derived.** `getNextQuestion` selects
  by group *code*; the handlers pass fixed constants:
  `APPLICATION_GROUP_CODES = ['application']` (`application-handlers.ts:19`) and
  `DNT_GROUP_CODES = [6 dnt_* groups]` (`dnt-handlers.ts:18`). Every product would
  get identical questions. The schema **already** supports product scoping —
  `QuestionGroup.productId` exists (`schema.prisma:434,440`) and `Product` already
  has `questionGroups QuestionGroup[]` (`:132`) — it's simply unused.
- **`sign_dnt` is dead.** It requires `context.workflowSession` and returns
  *"No active workflow session found."* otherwise (`dnt-handlers.ts:304-307`), and
  writes the signed flag to `workflowSession.data` — a session that never exists.
  So a DNT can be answered (answers persist as `Answer` rows) but **never signed**,
  and the `start_application` DNT gate (which reads `workflowSession.data.dntSignedAt`)
  is silently bypassed.

The `isBdStep` branch in `saveApplicationAnswer` (`application-handlers.ts:166-168`)
keys off `workflowSession.currentStepCode`, which is always null, so `bd_medical`
questions are **never asked** today.

## Goal

Make Zeno reliably advance from product-convergence to a quote, with
product-derived questions and IDD-correct ordering, and remove the dead legacy
layer that strands it. Concretely, after the customer converges Zeno should:

1. affirm the choice in natural language and ask **one** readiness question
   (no internal product confirmation), then
2. silently drive `start_dnt_questionnaire → save_dnt_answer×N → sign_dnt →
   start_application → save_application_answer×N → generate_quote`.

## Decisions (locked)

- **Scope:** full advance path — product-derive **both** DNT and application
  question groups, repair DNT signing, enforce IDD ordering, retire
  `set_conversation_product`. One spec / one plan.
- **Transition feel:** affirm + one natural readiness question, then drive the
  tools silently. No "confirm Protect" ceremony.
- **Group mechanism:** add a `phase` field to `QuestionGroup`; a resolver selects
  by `(phase, productId-or-global)`. Both hardcoded group-code constants deleted.
- **`set_candidate_product` stays** — it is the surviving soft product-focus tool.

## Architecture

### 1. Schema

**`QuestionGroup.phase String?`** — nullable, `'dnt' | 'application'`. Backfill on
migration: `dnt_*` → `'dnt'`; `application`, `bd_medical` → `'application'`. Any
other/future group (post-sale, claims, etc.) stays `null` and simply never matches
the DNT/application resolver — no phase is forced on groups outside this flow.

**DNT-signed state relocated to `Conversation`** — add
`dntSignedAt DateTime?`, `dntValidUntil DateTime?`. This replaces the dead
`workflowSession.data` home and lives alongside `productId`/`candidateProductId`,
which are already on `Conversation`. (GDPR-consent boolean folds into "signed"; we
do not persist it separately for v1.)

> Scoping note (deliberate YAGNI): `dnt_*` groups are really *line*-specific (all
> LIFE products would share them), but `QuestionGroup.productId` is a single FK.
> With one product, `productId`-or-global is sufficient and correct. True
> line-scoping (an `insuranceType` on the group) is **out of scope** and revisited
> when a second same-line product exists.

### 2. Group resolver — `lib/engines/question-groups.ts`

```ts
resolveGroupCodes(productId: string | null, phase: 'dnt' | 'application'): Promise<string[]>
```

Returns group `code`s where `phase = phase AND (productId = productId OR productId IS NULL)`,
ordered by `orderIndex`. Single source of truth for "which groups for this product,
this phase". Replaces `DNT_GROUP_CODES` and `APPLICATION_GROUP_CODES`.

- Pure data read; unit-testable with a mocked `prisma.questionGroup.findMany`.
- `productId` argument resolves from `conversation.productId ?? conversation.candidateProductId`
  (DNT runs before the product is committed, so the candidate must be honored).

### 3. Handler rewiring

- **DNT handlers** (`check_dnt_status`, `start_dnt_questionnaire`, `save_dnt_answer`,
  `sign_dnt`): replace `DNT_GROUP_CODES` with `resolveGroupCodes(productId, 'dnt')`.
- **`sign_dnt`**: persist `dntSignedAt` / `dntValidUntil` to `Conversation`; drop the
  `workflowSession` requirement. "All answered" check uses resolver progress.
- **Application handlers** (`start_application`, `save_application_answer`, status/
  progress): replace `APPLICATION_GROUP_CODES` with
  `resolveGroupCodes(productId, 'application')`. Remove the `isBdStep` split — the
  `application` phase now includes both the `application` and `bd_medical` groups,
  sequenced by `orderIndex` (seed must order package/level before medical).
- **`start_application` DNT gate**: require `conversation.dntSignedAt` set and not
  past `dntValidUntil` — now actually enforceable. (Replaces the dead
  `workflowSession.data` check.)

### 4. Retire `set_conversation_product`

Remove the tool everywhere it lives: `registry.ts` (registration +
`ALWAYS_ALLOWED_SET`), `product-handlers.ts` (handler), `default-tools.ts`,
`pipeline.ts`, `validation.ts`, `action-adapter.ts`, and update/delete the tests
that assert on it (`debug-confirmation`, `default-tools`, `discovery-tool-status`,
`orchestrator-discovery-tools`, `main-chat-constraints`, `discovery-empty-catalog`).
Delete the confirm-Protect instruction (`seed-agents.ts:383`) and the false
auto-advance text in `seed-workflows.ts` (`:60/:80/:91/:219` and any sibling
references). **Keep `set_candidate_product`.**

### 5. Prompt — drive the sequence

In `MAIN_CHAT_PROMPT` (and aligned in the `life-insurance-closing` pack, which
already proposes *"Să pornim cererea de asigurare acum?"*):

- On convergence (explicit product+package choice, or a bare `da` to a
  package/level offer): affirm the choice, ask **one** natural readiness question
  (e.g. *"Ca să-ți pregătesc oferta exactă, trecem prin câțiva pași scurți.
  Începem?"*). No product confirmation.
- On the customer's yes: silently run the tool sequence
  `start_dnt_questionnaire → save_dnt_answer×N → sign_dnt → start_application →
  save_application_answer×N → generate_quote`, surfacing questions/answers
  naturally (tool use stays invisible).
- Remove all legacy text implying the system auto-advances or that the agent
  must `set_conversation_product` / wait.

## Data flow (target)

```
customer converges
  → Zeno: affirm + readiness question
  → customer: yes
  → start_dnt_questionnaire        (groups = resolveGroupCodes(prod,'dnt'))
  → save_dnt_answer × N
  → sign_dnt                       (writes Conversation.dntSignedAt/validUntil)
  → start_application              (gate: Conversation.dntSignedAt; groups = resolveGroupCodes(prod,'application'))
  → save_application_answer × N    (application + bd_medical, by orderIndex)
  → generate_quote
```

## Error handling / edge cases

- **`start_application` before DNT signed** → returns a clear error; the agent
  routes the customer back into the DNT step.
- **Resolver returns no groups for a (product, phase)** → handler returns a
  descriptive error ("no questions configured") rather than silently completing.
- **DNT already signed and still valid** (returning customer) → `sign_dnt` is a
  no-op success; `start_application` proceeds.
- **Candidate not set when DNT/application starts** → resolver `productId` is null,
  so only global groups resolve; `start_application` already errors with
  "No product selected." We keep that guard.

## Testing strategy

- **Resolver unit tests**: phase filtering, product-or-global union, orderIndex
  ordering, empty result.
- **DNT handler tests**: `sign_dnt` persists to `Conversation` (no workflowSession);
  signing blocked until 100% answered; `check_dnt_status` reflects persisted state.
- **Application handler tests**: groups resolved per product; `bd_medical` now
  included and ordered after `application`; DNT gate blocks/permits correctly.
- **Removal regression**: `set_conversation_product` absent from the registry,
  default tools, and validation; prompts contain no confirm-Protect / auto-advance
  text (extend the existing `main-chat-constraints` test).
- **Seed verification**: every group has a `phase`; product-scoped groups carry the
  right `productId`; application-phase ordering is package/level → medical.
- **Manual runtime check** (per CLAUDE.md — LLM prompt-following can't be unit
  tested): reproduce `cmpp27t1c…`'s convergence; confirm Zeno asks one readiness
  question, then drives DNT → sign → application → quote without a "confirm
  Protect" turn and without stalling on a freeform age question.

## Out of scope / future

- Line-scoping of DNT groups via `insuranceType` (only matters with a 2nd
  same-line product).
- Removing the broader `WorkflowSession` machinery (this spec only stops depending
  on it for product-advance and DNT signing; a full retirement is separate).
- Customer-level DNT reuse across conversations (we keep DNT conversation-scoped).

## Rollout

- Two additive migrations (`QuestionGroup.phase`, `Conversation.dntSignedAt/validUntil`).
- Re-seed agents/workflows/questions (`npx tsx scripts/reseed-agents.ts` + `prisma db seed`);
  a running app caches agent config (flush via `/api/admin/agents/flush-cache`).
- No data backfill beyond the migration's `phase` defaulting.
