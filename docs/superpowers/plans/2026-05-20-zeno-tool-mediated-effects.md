# Zeno Tool-Mediated Side Effects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make side-effect claims in agent prose structurally impossible. All state-mutating or fact-producing tool calls return structured `confirmation` data; the agent's free text is forbidden from claiming the side effect itself. A forbidden-phrase validator catches violations and retries.

**Architecture:** `ToolResult` gains an optional `confirmation` field with `category` (`save` / `lifecycle` / `consent` / `quote`), `label`, `value`, optional `provenance`, and `timestamp`. `ToolDefinition` gains `sideEffect` metadata. Existing tools (saves, lifecycle) are updated to populate `confirmation`. New tools (`record_gdpr_consent`, `acknowledge_ai_disclosure`) are added. A new `lib/chat/side-effect-validator.ts` flags phrases like `am notat`, `am salvat`, etc. when not backed by a matching tool call; the orchestrator retries the turn once with a corrective system message. Constraints text gets a strong forbidden-phrase rule.

**Tech Stack:** TypeScript, Next.js 16, Prisma 7, Vitest. Spec: `docs/superpowers/specs/2026-05-20-zeno-tool-mediated-effects-design.md`.

---

## File Structure

**Create:**
- `lib/chat/side-effect-validator.ts` — `PHRASE_BLOCKLIST` + `validateSideEffectClaims`.
- `__tests__/lib/chat/side-effect-validator.test.ts` — unit tests.
- `__tests__/lib/tools/consent-tools.test.ts` — unit tests for new consent tools.

**Modify:**
- `lib/tools/types.ts` — extend `ToolDefinition` with `sideEffect` and `ToolResult` with `confirmation`.
- `lib/tools/registry.ts` — register `record_gdpr_consent` and `acknowledge_ai_disclosure`; add `sideEffect:` field to all side-effecting tool defs; update handlers to return `confirmation`.
- `lib/tools/handlers/application-handlers.ts` (and similar) — add `confirmation` payload to side-effecting handler returns.
- `lib/chat/default-tools.ts` — append the two new consent tools to `DEFAULT_DISCOVERY_TOOLS`.
- `lib/chat/orchestrator.ts` — invoke validator after LLM response, retry once with corrective message on violation.
- `prisma/seeds/seed-agents.ts` — append forbidden-phrase rule to `main-chat` constraints.

**Run after merging:**
- `npx tsx scripts/reseed-agents.ts` to push the updated constraints.

---

## Task 1: Tool type extensions — sideEffect on ToolDefinition, confirmation on ToolResult

**Files:**
- Modify: `lib/tools/types.ts:19-31, 42-48`

- [x] **Step 1: Extend ToolDefinition**

Replace the `ToolDefinition` interface (lines 19-31) with:

```ts
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  executionMode: ExecutionMode
  customerVisible: boolean
  statusMessage: { ro: string[]; en: string[] } | null
  alwaysAllowed: boolean
  allowedRoles: UserRole[]
  sideEffects?: boolean
  cacheable?: boolean
  cacheTtlMs?: number
  /**
   * Category of side effect for system-rendered confirmation lines.
   * If set, the tool's handler is expected to populate `ToolResult.confirmation`
   * on success. Read-only tools omit this field.
   */
  sideEffect?: 'save' | 'lifecycle' | 'consent' | 'quote'
}
```

- [x] **Step 2: Extend ToolResult**

Replace the `ToolResult` interface (lines 42-48):

```ts
export interface ToolResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
  message?: string
  uiAction?: { type: string; payload: Record<string, unknown> }
  /**
   * Structured confirmation rendered by the system as a customer-facing
   * '✓ Label: Value' line. Only populated on success for side-effecting tools
   * (those with sideEffect: 'save' | 'lifecycle' | 'consent' | 'quote').
   * See docs/superpowers/specs/2026-05-20-zeno-tool-mediated-effects-design.md.
   */
  confirmation?: {
    category: 'save' | 'lifecycle' | 'consent' | 'quote'
    label: string
    value: string
    provenance?: string
    timestamp: string
  }
}
```

- [x] **Step 3: Build to confirm no callers break**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: no new type errors. (Existing callers continue to work because both new fields are optional.)

- [x] **Step 4: Commit**

```bash
git add lib/tools/types.ts
git commit -m "feat(tools): ToolResult.confirmation + ToolDefinition.sideEffect

Optional fields, no behavior change yet. Handlers will populate
ToolResult.confirmation on success in subsequent tasks; the
orchestrator will render those confirmations as system lines."
```

---

## Task 2: New consent tools — record_gdpr_consent and acknowledge_ai_disclosure

**Files:**
- Modify: `lib/tools/registry.ts` (add two new `registerTool` calls)
- Create: `__tests__/lib/tools/consent-tools.test.ts`

- [x] **Step 1: Write the failing test**

Create `__tests__/lib/tools/consent-tools.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    customer: { update: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { getToolDefinition } from '@/lib/tools/registry'

describe('record_gdpr_consent tool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is registered with sideEffect: consent', () => {
    const def = getToolDefinition('record_gdpr_consent')
    expect(def).toBeDefined()
    expect(def?.sideEffect).toBe('consent')
  })

  it('handler writes Customer.gdprConsentAt and gdprConsentScope, returns confirmation', async () => {
    vi.mocked(prisma.customer.update).mockResolvedValue({
      id: 'cust-1',
      gdprConsentAt: new Date('2026-05-20T13:00:00Z'),
      gdprConsentScope: 'data_processing_for_quote',
    } as never)

    const def = getToolDefinition('record_gdpr_consent')
    const result = await def!.handler({ scope: 'data_processing_for_quote' }, {
      customerId: 'cust-1', conversationId: 'conv-1', language: 'ro',
    } as never)

    expect(result.success).toBe(true)
    expect(prisma.customer.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cust-1' },
      data: expect.objectContaining({
        gdprConsentAt: expect.any(Date),
        gdprConsentScope: 'data_processing_for_quote',
      }),
    }))
    expect(result.confirmation).toBeDefined()
    expect(result.confirmation?.category).toBe('consent')
    expect(result.confirmation?.label).toBe('Consimțământ GDPR')
    expect(result.confirmation?.value).toContain('data_processing_for_quote')
  })
})

describe('acknowledge_ai_disclosure tool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is registered with sideEffect: consent', () => {
    const def = getToolDefinition('acknowledge_ai_disclosure')
    expect(def).toBeDefined()
    expect(def?.sideEffect).toBe('consent')
  })

  it('handler writes Customer.aiDisclosureAcknowledgedAt and returns confirmation', async () => {
    vi.mocked(prisma.customer.update).mockResolvedValue({
      id: 'cust-1',
      aiDisclosureAcknowledgedAt: new Date('2026-05-20T13:00:00Z'),
    } as never)

    const def = getToolDefinition('acknowledge_ai_disclosure')
    const result = await def!.handler({}, {
      customerId: 'cust-1', conversationId: 'conv-1', language: 'ro',
    } as never)

    expect(result.success).toBe(true)
    expect(prisma.customer.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cust-1' },
      data: expect.objectContaining({
        aiDisclosureAcknowledgedAt: expect.any(Date),
      }),
    }))
    expect(result.confirmation?.category).toBe('consent')
    expect(result.confirmation?.label).toBe('Asistență AI')
  })
})
```

Note: the test accesses `def!.handler` — but `ToolDefinition` doesn't expose `handler`. Look at how the existing `registerTool` system stores handlers and find the equivalent way to invoke the handler in tests. If `getToolDefinition` does not include the handler, use the registry's public exec path (e.g. `executeToolWithPipeline` or whatever the existing tests use). Check `__tests__/lib/tools/handlers/` for examples of how existing handler tests invoke their handlers.

- [x] **Step 2: Read existing handler test for the invocation pattern**

Run: `npm test -- __tests__/lib/tools/handlers/ --reporter=verbose 2>&1 | head -5`
Then read one such test file to copy the invocation pattern. Adapt the test above accordingly.

- [x] **Step 3: Run test to verify it fails**

Run: `npm test -- __tests__/lib/tools/consent-tools.test.ts`
Expected: FAIL — `record_gdpr_consent` and `acknowledge_ai_disclosure` are not registered.

- [x] **Step 4: Implement the consent tool handlers**

In `lib/tools/registry.ts`, near the existing customer-profile tools (around line 507), add the two new handlers and registrations:

```ts
// ============================================================
// CONSENT / DISCLOSURE TOOLS (subsystem C)
// ============================================================

const recordGdprConsentHandler: ToolHandler = async (args, context) => {
  const scope = typeof args.scope === 'string' ? args.scope : 'data_processing'
  try {
    const updated = await prisma.customer.update({
      where: { id: context.customerId },
      data: { gdprConsentAt: new Date(), gdprConsentScope: scope },
      select: { gdprConsentAt: true, gdprConsentScope: true },
    })
    return {
      success: true,
      data: { customerId: context.customerId, scope, recordedAt: updated.gdprConsentAt!.toISOString() },
      confirmation: {
        category: 'consent',
        label: context.language === 'en' ? 'GDPR consent' : 'Consimțământ GDPR',
        value: context.language === 'en' ? `Confirmed for ${scope}` : `Confirmat pentru ${scope}`,
        timestamp: updated.gdprConsentAt!.toISOString(),
      },
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: `Failed to record GDPR consent: ${message}` }
  }
}

const acknowledgeAiDisclosureHandler: ToolHandler = async (_args, context) => {
  try {
    const updated = await prisma.customer.update({
      where: { id: context.customerId },
      data: { aiDisclosureAcknowledgedAt: new Date() },
      select: { aiDisclosureAcknowledgedAt: true },
    })
    return {
      success: true,
      data: { customerId: context.customerId, acknowledgedAt: updated.aiDisclosureAcknowledgedAt!.toISOString() },
      confirmation: {
        category: 'consent',
        label: context.language === 'en' ? 'AI assistance disclosure' : 'Asistență AI',
        value: context.language === 'en' ? 'Acknowledged' : 'Confirmat',
        timestamp: updated.aiDisclosureAcknowledgedAt!.toISOString(),
      },
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: `Failed to acknowledge AI disclosure: ${message}` }
  }
}

registerTool('record_gdpr_consent', {
  description: 'Record customer GDPR consent for a given processing scope.',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', description: 'Processing scope, e.g. data_processing_for_quote.' },
    },
    required: ['scope'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  alwaysAllowed: true,
  allowedRoles: ALL_ROLES,
  sideEffect: 'consent',
}, recordGdprConsentHandler)

registerTool('acknowledge_ai_disclosure', {
  description: 'Record that the customer has acknowledged the AI-assistance disclosure.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  alwaysAllowed: true,
  allowedRoles: ALL_ROLES,
  sideEffect: 'consent',
}, acknowledgeAiDisclosureHandler)
```

- [x] **Step 5: Run the test**

Run: `npm test -- __tests__/lib/tools/consent-tools.test.ts`
Expected: PASS — all tests pass. If the handler invocation pattern needs adjusting per Step 2, iterate.

- [x] **Step 6: Commit**

```bash
git add lib/tools/registry.ts __tests__/lib/tools/consent-tools.test.ts
git commit -m "feat(tools): add record_gdpr_consent and acknowledge_ai_disclosure

Two new consent-category side-effecting tools that write to the
Customer fields added in subsystem A. Both return ToolResult.confirmation
payloads for system-rendered confirmation lines."
```

---

## Task 3: Add the new consent tools to DEFAULT_DISCOVERY_TOOLS

**Files:**
- Modify: `lib/chat/default-tools.ts`
- Modify: `__tests__/lib/chat/default-tools.test.ts`

- [x] **Step 1: Update the test fixture**

In `__tests__/lib/chat/default-tools.test.ts`, update the `'contains the three discovery tools'` test:

```ts
describe('DEFAULT_DISCOVERY_TOOLS', () => {
  it('contains the five baseline tools', () => {
    expect(DEFAULT_DISCOVERY_TOOLS).toEqual([
      'list_products',
      'get_product_info',
      'set_conversation_product',
      'record_gdpr_consent',
      'acknowledge_ai_disclosure',
    ])
  })
})
```

Update the three `withDefaultDiscoveryTools` tests to reflect the new five-tool baseline. Specifically, the first item should still be `list_products` and the `[]` input case should yield all five tools.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/lib/chat/default-tools.test.ts`
Expected: FAIL — baseline still has three tools.

- [x] **Step 3: Extend the constant**

In `lib/chat/default-tools.ts`:

```ts
export const DEFAULT_DISCOVERY_TOOLS = [
  'list_products',
  'get_product_info',
  'set_conversation_product',
  'record_gdpr_consent',
  'acknowledge_ai_disclosure',
] as const
```

- [x] **Step 4: Run tests**

Run: `npm test -- __tests__/lib/chat/default-tools.test.ts`
Expected: PASS.

- [x] **Step 5: Run the broader discovery-empty-catalog test (which asserts the three-tool subset)**

Run: `npm test -- __tests__/lib/chat/discovery-empty-catalog.test.ts`
Expected: PASS — those tests assert `toContain` for the three original tools, which still hold. If any assertion uses `toHaveLength(3)` against the baseline, update to `toHaveLength(5)`.

- [x] **Step 6: Commit**

```bash
git add lib/chat/default-tools.ts __tests__/lib/chat/default-tools.test.ts
git commit -m "feat(chat): consent tools join the discovery baseline

record_gdpr_consent and acknowledge_ai_disclosure are now always
available regardless of workflow state — consent and disclosure are
pre-workflow concerns and the agent must be able to invoke them
from the start of any conversation."
```

---

## Task 4: Update existing side-effecting tool handlers to return confirmation

**Files:**
- Modify: `lib/tools/registry.ts` (find `setConversationProduct` handler — currently returns plain success; add `confirmation`)
- Modify: `lib/tools/handlers/application-handlers.ts` (and any other handler files where save_*, start_*, sign_* live)

The existing handlers need `confirmation` populated on success. For each, follow this template:

```ts
return {
  success: true,
  data: { /* existing payload */ },
  confirmation: {
    category: '<save | lifecycle>',
    label: '<RO or EN label per context.language>',
    value: '<formatted value>',
    timestamp: new Date().toISOString(),
  },
}
```

- [x] **Step 1: Inventory the handler files to update**

Run: `grep -rn "registerTool" lib/tools/`
Read each unique `registerTool` call and note which tools are side-effecting (those that mutate DB state). Sketch a mapping:

| Tool name | sideEffect category | confirmation label |
|---|---|---|
| save_application_answer | save | "Răspuns salvat" / "Answer saved" |
| save_dnt_answer | save | "Răspuns DNT" / "DNT answer" |
| save_bd_answer | save | "Răspuns BD" / "BD answer" |
| set_conversation_product | lifecycle | "Produs selectat" / "Selected product" |
| start_application | lifecycle | "Aplicație inițiată" / "Application started" |
| start_dnt_questionnaire | lifecycle | "Chestionar DNT inițiat" / "DNT started" |
| sign_dnt | lifecycle | "DNT semnat" / "DNT signed" |

- [x] **Step 2: For each tool, update the registerTool call to include sideEffect, and update the handler to return confirmation on success**

For example, update `set_conversation_product` in `lib/tools/registry.ts`:

```ts
registerTool('set_conversation_product', {
  description: 'Set the product focus for the current conversation.',
  parameters: { /* unchanged */ },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: STATUS_SET_CONVERSATION_PRODUCT,
  alwaysAllowed: true,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
}, setConversationProduct)
```

And in the handler file (search for `setConversationProduct` to find it), wrap the existing success return with a `confirmation` payload that names the product code and localized name. The exact handler edit depends on the handler's current shape — read it first, then add the field. If the handler already returns `{ success: true, data: { productId, ... } }`, just add `confirmation: { category: 'lifecycle', label: ..., value: `${productCode} — ${productName}`, timestamp: new Date().toISOString() }`.

Repeat for each tool listed above. For each tool you touch, write or extend a focused unit test asserting the `confirmation` field is present on success.

- [x] **Step 3: Run the full tool test directory**

Run: `npm test -- __tests__/lib/tools/`
Expected: PASS — all tool tests pass with new confirmations in place.

- [x] **Step 4: Commit**

```bash
git add lib/tools/registry.ts lib/tools/handlers/ __tests__/lib/tools/
git commit -m "feat(tools): existing side-effecting handlers populate ToolResult.confirmation

save_application_answer, save_dnt_answer, save_bd_answer, set_conversation_product,
start_application, start_dnt_questionnaire, and sign_dnt now return a
confirmation payload on success so the orchestrator can render them
as system lines instead of relying on agent prose."
```

---

## Task 5: Forbidden-phrase validator

**Files:**
- Create: `lib/chat/side-effect-validator.ts`
- Create: `__tests__/lib/chat/side-effect-validator.test.ts`

- [x] **Step 1: Write the failing test**

Create `__tests__/lib/chat/side-effect-validator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateSideEffectClaims } from '@/lib/chat/side-effect-validator'

describe('validateSideEffectClaims', () => {
  it('flags "am notat" when no save-category tool was called', () => {
    const result = validateSideEffectClaims(
      'Am notat: 80 mp. Acum, care e suprafața utilă?',
      [],
      [],
      'ro',
    )
    expect(result.valid).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations[0].category).toBe('save')
  })

  it('allows "am notat" when a save-category tool was called and succeeded', () => {
    const result = validateSideEffectClaims(
      'Am notat răspunsul tău.',
      [{ id: 't1', name: 'save_application_answer' } as any],
      [{ success: true, confirmation: { category: 'save', label: 'x', value: 'y', timestamp: '' } }] as any,
      'ro',
    )
    expect(result.valid).toBe(true)
  })

  it('flags "am notat" when a save tool was called but failed', () => {
    const result = validateSideEffectClaims(
      'Am notat răspunsul tău.',
      [{ id: 't1', name: 'save_application_answer' } as any],
      [{ success: false, error: 'db down' }] as any,
      'ro',
    )
    expect(result.valid).toBe(false)
  })

  it('flags "am pornit aplicația" when no lifecycle tool was called', () => {
    const result = validateSideEffectClaims(
      'Perfect, am pornit aplicația pentru tine.',
      [],
      [],
      'ro',
    )
    expect(result.valid).toBe(false)
    expect(result.violations[0].category).toBe('lifecycle')
  })

  it('flags "I started the application" when no lifecycle tool was called', () => {
    const result = validateSideEffectClaims(
      'I started the application for you.',
      [],
      [],
      'en',
    )
    expect(result.valid).toBe(false)
    expect(result.violations[0].category).toBe('lifecycle')
  })

  it('returns valid for plain conversational text', () => {
    const result = validateSideEffectClaims(
      'Ce vrei să acoperi: doar locuința sau și bunurile?',
      [],
      [],
      'ro',
    )
    expect(result.valid).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('flags multiple categories in the same message', () => {
    const result = validateSideEffectClaims(
      'Am notat răspunsul și am pornit aplicația.',
      [],
      [],
      'ro',
    )
    expect(result.valid).toBe(false)
    expect(result.violations.length).toBeGreaterThanOrEqual(2)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/lib/chat/side-effect-validator.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the validator**

Create `lib/chat/side-effect-validator.ts`:

```ts
import type { ToolCall } from '@/lib/llm/providers/types'
import type { ToolResult } from '@/lib/tools/types'

type Category = 'save' | 'lifecycle' | 'consent' | 'quote'

export const PHRASE_BLOCKLIST: Record<Category, { ro: RegExp[]; en: RegExp[] }> = {
  save: {
    ro: [/am notat/i, /am salvat/i, /am înregistrat/i, /am consemnat/i],
    en: [/i (just )?noted/i, /i saved/i, /i recorded(?! (your )?consent)/i],
  },
  lifecycle: {
    ro: [/am pornit aplicația/i, /am început aplicația/i, /te-am înscris/i, /am creat aplicația/i],
    en: [/i started the application/i, /i created the application/i],
  },
  consent: {
    ro: [/am confirmat consimțământul/i, /am înregistrat consimțământul/i],
    en: [/i recorded (your )?consent/i, /i confirmed (your )?consent/i],
  },
  quote: {
    ro: [/cred că vine cam pe la/i, /aproximativ \d+\s*(ron|lei)/i],
    en: [/about \d+\s*(ron|lei|usd|eur)/i, /roughly \d+\s*(ron|lei|usd|eur)/i],
  },
}

export interface SideEffectValidation {
  valid: boolean
  violations: Array<{ category: Category; matchedPhrase: string }>
}

/**
 * Validate that every side-effect claim in the assistant's text is backed by
 * a corresponding successful tool call this turn.
 *
 * A 'side-effect claim' is text matching one of the regexes in
 * PHRASE_BLOCKLIST. A claim is permitted iff at least one tool of the
 * matching category was called this turn AND returned success.
 */
export function validateSideEffectClaims(
  assistantText: string,
  toolCalls: ToolCall[],
  toolResults: ToolResult[],
  language: 'ro' | 'en',
): SideEffectValidation {
  // Build a map of which categories succeeded this turn from confirmation field.
  const succeededCategories = new Set<Category>()
  for (let i = 0; i < toolResults.length; i++) {
    const r = toolResults[i]
    if (r.success && r.confirmation) {
      succeededCategories.add(r.confirmation.category as Category)
    }
  }

  const violations: SideEffectValidation['violations'] = []
  for (const [cat, patterns] of Object.entries(PHRASE_BLOCKLIST) as Array<[Category, { ro: RegExp[]; en: RegExp[] }]>) {
    const list = patterns[language]
    for (const pattern of list) {
      const m = assistantText.match(pattern)
      if (m && !succeededCategories.has(cat)) {
        violations.push({ category: cat, matchedPhrase: m[0] })
      }
    }
  }

  return { valid: violations.length === 0, violations }
}
```

- [x] **Step 4: Run the test**

Run: `npm test -- __tests__/lib/chat/side-effect-validator.test.ts`
Expected: PASS — all tests pass.

- [x] **Step 5: Commit**

```bash
git add lib/chat/side-effect-validator.ts __tests__/lib/chat/side-effect-validator.test.ts
git commit -m "feat(chat): side-effect-validator catches unbacked phrase claims

Scans the assistant's response for phrases like 'am notat / am salvat /
am pornit aplicația / I noted / I saved / I started the application'
and flags any that are not backed by a matching successful tool call
this turn. Result is consumed by the orchestrator's retry path."
```

---

## Task 6: Orchestrator retry-on-violation

**Files:**
- Modify: `lib/chat/orchestrator.ts` — locate the LLM response handling (around the assistant message save) and add the validator hook before persistence

- [x] **Step 1: Read the orchestrator's LLM response handling**

Run: `grep -n "save_assistant\|step8\|saveAssistant" lib/chat/orchestrator.ts | head -5`
Read the surrounding context to find where the final assistant text and toolCalls/toolResults are available.

- [x] **Step 2: Add the validator + retry**

After the LLM call returns and before the assistant message is persisted, insert validation logic. The integration point varies by code shape — the goal:

```ts
import { validateSideEffectClaims } from './side-effect-validator'

// ... after the LLM response and tool execution loop, but before persisting
// the assistant message ...
const turnToolCalls: ToolCall[] = /* collected during this turn */
const turnToolResults: ToolResult[] = /* collected during this turn */

const validation = validateSideEffectClaims(
  finalContent,
  turnToolCalls,
  turnToolResults,
  state.language,
)

let retryCount = 0
while (!validation.valid && retryCount < 2) {
  retryCount += 1
  const phrases = validation.violations.map((v) => `"${v.matchedPhrase}"`).join(', ')
  const corrective = `Your previous response contained phrases claiming side effects (${phrases}) without a successful matching tool call. Either call the matching tool to actually perform the action, or rephrase to remove the claim. The system renders side-effect confirmations automatically — do not write them in prose.`

  // Re-call the LLM with the corrective message appended.
  // The exact mechanism depends on how the orchestrator's tool loop is structured.
  // ... rerun LLM ...
  // Re-evaluate validation on the new finalContent.
}

if (!validation.valid && retryCount >= 2) {
  // Emit anomaly, use the latest response anyway (graceful degradation)
  // turnTrace.anomalies = [...(turnTrace.anomalies ?? []), {
  //   type: 'behavioral',
  //   severity: 'warning',
  //   message: 'side_effect_validation_failed_after_retries',
  //   metadata: { violations: validation.violations },
  // }]
}
```

Because the orchestrator's LLM loop is non-trivial, the implementation MUST:
1. Not break the streaming path (yields).
2. Not double-execute tool calls.
3. Cap retries at 2.
4. Always proceed with the latest response (never block the user-facing message).

If the simplest place to drop in this validation is after the final LLM iteration and after tool execution but before message persistence, do exactly that. If retry would require disassembling the streaming pipeline, EITHER:
- Make the validator a "post-hoc warning only" path that logs an anomaly without retrying, OR
- Move the validation into the orchestrator's existing retry/anomaly emission code path.

The minimum viable implementation that closes the structural hole: validator runs, anomaly logged on violation, response persisted as-is. The retry mechanism is bonus.

- [x] **Step 3: Write an integration test against the validator-only path**

Create `__tests__/lib/chat/orchestrator-side-effect-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateSideEffectClaims, PHRASE_BLOCKLIST } from '@/lib/chat/side-effect-validator'

describe('orchestrator-side-effect-validation (subsystem C anomaly path)', () => {
  it('flags as anomaly when assistant writes "am notat" without a save tool call', () => {
    // Reproduces the validation step the orchestrator runs on each LLM response.
    const validation = validateSideEffectClaims(
      'Am notat răspunsul tău. Continuăm.',
      [],
      [],
      'ro',
    )

    expect(validation.valid).toBe(false)
    expect(validation.violations.length).toBeGreaterThan(0)
  })

  it('passes through when assistant text is purely conversational', () => {
    const validation = validateSideEffectClaims(
      'Apartamentul este într-un bloc din beton sau cărămidă?',
      [],
      [],
      'ro',
    )
    expect(validation.valid).toBe(true)
  })
})
```

Run: `npm test -- __tests__/lib/chat/orchestrator-side-effect-validation.test.ts`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add lib/chat/orchestrator.ts __tests__/lib/chat/orchestrator-side-effect-validation.test.ts
git commit -m "feat(orchestrator): run side-effect validator on every LLM response

When the assistant's text contains side-effect-claim phrases that are
not backed by a matching successful tool call, emit a behavioral
anomaly in the turn trace. Retry path documented in the plan; minimum
viable implementation closes the structural hole even without retry."
```

---

## Task 7: Constraints addendum — forbidden-phrase rule

**Files:**
- Modify: `prisma/seeds/seed-agents.ts` (main-chat constraints)
- Modify: `__tests__/prisma/seeds/main-chat-constraints.test.ts`

- [x] **Step 1: Append the new constraint**

In `prisma/seeds/seed-agents.ts`, find the `main-chat` constraints array and append:

```ts
      'You CANNOT write phrases that claim side effects (saving data, recording consent, starting applications, calculating quotes). The system renders these as separate confirmation lines from tool results. Forbidden examples in your prose: "am notat", "am salvat", "am înregistrat", "am pornit aplicația", "te-am înscris", "am confirmat consimțământul", "I noted", "I saved", "I recorded", "I started the application", "I confirmed consent". To accomplish any side effect, call the matching tool — the system will render its success for the customer automatically. You may comment around the confirmation but never claim to have done the action.',
```

- [x] **Step 2: Update the constraint test**

Add to `__tests__/prisma/seeds/main-chat-constraints.test.ts`:

```ts
it('includes the forbidden-phrase rule', () => {
  const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
  const parsed = JSON.parse(mainChat!.constraints as string)
  expect(parsed).toEqual(
    expect.arrayContaining([
      expect.stringContaining('Forbidden examples'),
    ]),
  )
})
```

- [x] **Step 3: Run test**

Run: `npm test -- __tests__/prisma/seeds/main-chat-constraints.test.ts`
Expected: PASS.

- [x] **Step 4: Reseed**

Run: `npx tsx scripts/reseed-agents.ts`

- [x] **Step 5: Commit**

```bash
git add prisma/seeds/seed-agents.ts __tests__/prisma/seeds/main-chat-constraints.test.ts
git commit -m "feat(agents): forbidden-phrase rule in main-chat constraints

Agent must not write side-effect claim phrases in prose. The system
renders confirmations from tool results; agent text stays purely
conversational. Required companion to subsystem C's validator."
```

---

## Task 8: Full test sweep + mark plan complete

- [x] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — full suite passes with no regressions.

- [x] **Step 2: Mark all checkboxes in this file as completed**

Replace every `- [x]` with `- [x]` in this file.

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-05-20-zeno-tool-mediated-effects.md
git commit -m "docs(plans): mark subsystem C plan complete"
```
