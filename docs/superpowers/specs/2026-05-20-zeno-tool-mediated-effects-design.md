# Zeno Tool-Mediated Side Effects — Design

> **Sub-project of the Zeno reliability redesign (2026-05-20).** Related specs:
> - [Default Discovery Toolset](2026-05-20-zeno-discovery-toolset-design.md)
> - [State Grounding](2026-05-20-zeno-state-grounding-design.md)
> - [Skill Pack Contract](2026-05-20-zeno-skill-pack-contract-design.md)

## Problem

The agent's medium of action is the same as its medium of output: text. When it writes *"Am notat: 80 mp"* ("I noted: 80 sqm"), nothing was actually noted — the claim is unverified and decoupled from system state. Today, the constraints section has no rule against this kind of language, and there is no mechanism that ties side-effect claims to tool calls.

Reference: conversation `cmpdx52t6001gv00yv4km5usg`. The agent ran a 19-turn fake questionnaire writing "Am notat", "Am înțeles", "Continuăm" on every turn, claiming to save data, advance through questions, and confirm answers. Nothing was saved. Two compliance checks (turns 34 and 38) flagged missing GDPR consent and AI disclosure — there is no tool to record either, so the agent could only "mention" them in prose, which is exactly what compliance failed.

Claude Code's model is the cure: side effects happen exclusively via tool calls; the tool result is the only legitimate source of "this happened" text. The agent's free text becomes purely conversational.

## Goals

- Make side-effect claims in agent prose structurally impossible: the agent never writes "I saved / I noted / I started"; the system renders confirmation lines from tool results.
- All four categories — saves, lifecycle, consent/disclosure, quotes — get the same treatment, governed by one sharp rule.
- Add the consent/disclosure tools the system currently lacks.
- Catch and correct violations via a forbidden-phrase validator with retry.

## Non-goals

- Detailed visual treatment of confirmation lines (colour, animation) — only the data and the event-stream contract are in scope.
- A full premium-engine rewrite. `calculate_premium` must work end-to-end with existing pricing data; deeper rate logic is its own subsystem.

## Design

The architecture has four parts: tool metadata, tool result schema, validator, render layer.

### Tool side-effect category metadata

Extend the tool definition shape (likely in `lib/tools/registry.ts` or wherever `ToolDefinition` is declared) with an optional field:

```ts
interface ToolDefinition {
  // ... existing fields ...
  sideEffect?: 'save' | 'lifecycle' | 'consent' | 'quote'
}
```

Assignments:
- `save`: `save_application_answer`, `save_dnt_answer`, `save_bd_answer`
- `lifecycle`: `set_conversation_product`, `start_application`, `start_dnt_questionnaire`, `sign_dnt`
- `consent`: `record_gdpr_consent`, `acknowledge_ai_disclosure`
- `quote`: `calculate_premium`, `generate_quote`
- `undefined` for read-only tools (`list_products`, `get_product_info`, `get_quote`, etc.)

### Tool result schema

On success, side-effecting tools return a structured `confirmation` field alongside their existing `data`:

```ts
interface ToolResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
  message?: string
  confirmation?: {
    category: 'save' | 'lifecycle' | 'consent' | 'quote'
    label: string         // e.g. "Suprafață utilă"
    value: string         // e.g. "80 mp"
    provenance?: string   // e.g. "Asigurare Viață Premium, Nivel Confort, valid 7 zile"
    timestamp: string     // ISO datetime
  }
}
```

On failure, the `confirmation` field is omitted — the agent surfaces the error in prose (normal error handling).

### Update existing tool handlers

For each side-effecting tool currently implemented, the handler returns a `confirmation` block on success. Examples:

`save_application_answer` (returns confirmation per saved field):
```ts
return {
  success: true,
  data: { fieldKey, value, applicationId },
  confirmation: {
    category: 'save',
    label: humanReadableLabel(fieldKey, language),
    value: formattedValue(value, fieldKey, language),
    timestamp: new Date().toISOString(),
  },
}
```

`set_conversation_product`:
```ts
return {
  success: true,
  data: { productId, productCode },
  confirmation: {
    category: 'lifecycle',
    label: language === 'ro' ? 'Produs selectat' : 'Selected product',
    value: `${product.code} — ${product.name[language]}`,
    timestamp: new Date().toISOString(),
  },
}
```

Same shape for `start_application`, `start_dnt_questionnaire`, `sign_dnt`, `save_dnt_answer`, `save_bd_answer`.

### New tools

`record_gdpr_consent`:
```ts
// args: { scope: string }
// writes Customer.gdprConsentAt = now(), Customer.gdprConsentScope = scope
// returns:
{
  success: true,
  data: { customerId, scope, recordedAt },
  confirmation: {
    category: 'consent',
    label: language === 'ro' ? 'Consimțământ GDPR' : 'GDPR consent',
    value: language === 'ro' ? `Confirmat pentru ${scope}` : `Confirmed for ${scope}`,
    timestamp: recordedAt,
  },
}
```

`acknowledge_ai_disclosure`:
```ts
// no args (or { language })
// writes Customer.aiDisclosureAcknowledgedAt = now()
// returns:
{
  success: true,
  data: { customerId, acknowledgedAt },
  confirmation: {
    category: 'consent',
    label: language === 'ro' ? 'Asistență AI' : 'AI assistance disclosure',
    value: language === 'ro' ? 'Confirmat' : 'Acknowledged',
    timestamp: acknowledgedAt,
  },
}
```

`calculate_premium` — verify it exists and is implemented (not a stub). If stub: implement minimally using `Product.pricingTiers` + `addons.pricingRules` based on the conversation's selected product/tier/level. If absent: add. Returns confirmation:
```ts
confirmation: {
  category: 'quote',
  label: language === 'ro' ? 'Cotație' : 'Quote',
  value: `${monthlyPremium} RON/${language === 'ro' ? 'lună' : 'month'}`,
  provenance: `${product.name[language]}, ${level.name[language]}, valid ${validityDays} ${language === 'ro' ? 'zile' : 'days'}`,
  timestamp: new Date().toISOString(),
}
```

Both `record_gdpr_consent` and `acknowledge_ai_disclosure` are added to `DEFAULT_DISCOVERY_TOOLS` (see [Default Discovery Toolset](2026-05-20-zeno-discovery-toolset-design.md)) so they are always available regardless of workflow state — consent and disclosure are pre-workflow concerns.

Updated baseline (from Default Discovery Toolset spec):
```ts
export const DEFAULT_DISCOVERY_TOOLS = [
  'list_products',
  'get_product_info',
  'set_conversation_product',
  'record_gdpr_consent',
  'acknowledge_ai_disclosure',
] as const
```

### Forbidden-phrase validator

New module `lib/chat/side-effect-validator.ts`:

```ts
export const PHRASE_BLOCKLIST: Record<'save' | 'lifecycle' | 'consent' | 'quote', { ro: RegExp[], en: RegExp[] }> = {
  save: {
    ro: [/am notat/i, /am salvat/i, /am înregistrat/i, /am consemnat/i],
    en: [/i (just )?noted/i, /i saved/i, /i recorded/i],
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
    ro: [/cred că vine cam pe la/i, /cam .* (ron|lei)/i, /aproximativ .* (ron|lei)/i],
    en: [/about .* (ron|lei|usd|eur)/i, /around .* (ron|lei|usd|eur)/i, /roughly .* (ron|lei|usd|eur)/i],
  },
}

export interface SideEffectValidation {
  valid: boolean
  violations: Array<{ category: string, matchedPhrase: string }>
}

export function validateSideEffectClaims(
  assistantText: string,
  toolCalls: ToolCall[],
  toolResults: ToolResult[],
  language: 'ro' | 'en',
): SideEffectValidation {
  // For each category, check whether the text matches any blocklist pattern.
  // A match is allowed only if at least one tool of that category was called this turn AND returned success.
  // Return all unmet matches as violations.
}
```

The blocklists are tuned during implementation. The "quote" category patterns specifically target hedge language because quote claims are about producing a number, not about claiming a save.

### Orchestrator integration

After the LLM call returns (`lib/chat/orchestrator.ts`, search for the LLM response handling block) and before saving the assistant message:

```ts
const validation = validateSideEffectClaims(
  llmResponse.content,
  llmResponse.toolCalls,
  toolResultsThisTurn,
  state.language,
)

if (!validation.valid && retryCount < 2) {
  retryCount += 1
  // append corrective system message and re-call the LLM
  const correctiveMessage = `Your previous response contained phrases claiming side effects (${
    validation.violations.map((v) => `"${v.matchedPhrase}"`).join(', ')
  }) without calling the matching tool. Either call the tool to actually perform the action, or rephrase to remove the claim. The system renders side-effect confirmations automatically — do not write them in prose.`
  // ... LLM retry with correctiveMessage appended ...
}
```

If retries are exhausted and the response is still invalid:
- Emit an anomaly in the turn trace: `{ type: 'behavioral', severity: 'warning', message: 'side_effect_validation_failed_after_retries', metadata: { violations } }`
- Use the latest LLM response anyway (graceful degradation — never block the user-facing message).

Cap at 2 retries. Higher retries waste latency.

### Constraints text addendum

Append to base `constraints`:

> You CANNOT write phrases that claim side effects (saving data, recording consent, starting applications, calculating quotes). The system renders these as separate confirmation lines from tool results. Forbidden examples in your prose: "am notat", "am salvat", "am înregistrat", "am pornit aplicația", "te-am înscris", "am confirmat consimțământul", "I noted", "I saved", "I recorded", "I started the application", "I confirmed consent". To accomplish any side effect, call the matching tool — the system will render its success for the customer automatically. You may comment around the confirmation (e.g. "great, that helps me understand your priorities") but never claim to have done the action.

This is appended after the State Grounding addendum from [State Grounding](2026-05-20-zeno-state-grounding-design.md).

### Confirmation render layer

The streaming API that returns assistant turns to the UI gains a new event type:

```ts
type StreamEvent =
  | { type: 'token', delta: string }
  | { type: 'tool_call', toolCallId: string, name: string, arguments: object }
  | { type: 'tool_result', toolCallId: string, result: ToolResult }
  | { type: 'confirmation', confirmation: ToolResult['confirmation'] }   // NEW
  | { type: 'done' }
```

After a tool result that includes a `confirmation`, emit a `confirmation` event with the confirmation payload. The UI displays these as distinct visual lines above or interleaved with the assistant text (exact visual treatment is downstream UX work; the event contract is what matters here).

Locate the streaming handler in `app/api/chat/*` or the SSE/websocket endpoint, and add the emission. Existing turn-trace persistence is unchanged.

## Data flow

```
LLM responds with text + tool calls
  ↓
orchestrator executes tool calls, collects ToolResults (each with optional confirmation)
  ↓
validateSideEffectClaims(text, toolCalls, toolResults, language)
  ↓
if violations and retryCount < 2:
  retry with corrective system message
  ↓
otherwise (valid OR retries exhausted):
  persist message
  emit stream events:
    - confirmation events for each successful side-effecting tool result
    - token events for the assistant text
    - done
  ↓
UI renders confirmation lines + assistant text together
```

## Error handling

- Tool call fails (returns `success: false`): no `confirmation` field; agent's prose surfaces the error normally; validator does not flag absence of confirmation (no claim was made).
- Tool call succeeds but agent still wrote a redundant claim phrase: validator flags it (defensive — agent should let the system render). Corrective message tells the agent to drop the redundant prose.
- Retries exhausted: anomaly logged, response used as-is. Never block the user-facing turn.
- Streaming connection drops mid-emit: confirmation events are part of the same stream as tokens; if the connection drops, both are lost together — re-fetch of the assistant message can reconstruct from persisted state.

## Testing

- **Unit:** each side-effecting tool handler returns a well-formed `confirmation` field on success.
- **Unit:** each side-effecting tool handler omits the `confirmation` field on failure.
- **Unit:** `validateSideEffectClaims` flags every blocklisted phrase when no matching-category tool was called.
- **Unit:** `validateSideEffectClaims` allows the phrase when a matching-category tool was called and succeeded.
- **Unit:** `validateSideEffectClaims` flags the phrase when a matching-category tool was called but returned `success: false`.
- **Unit:** `record_gdpr_consent` writes `Customer.gdprConsentAt` and `Customer.gdprConsentScope` correctly.
- **Unit:** `acknowledge_ai_disclosure` writes `Customer.aiDisclosureAcknowledgedAt` correctly.
- **Integration:** orchestrator retry path — given a stubbed LLM that returns "am salvat" with no tool call on the first invocation and a clean response on retry, the orchestrator runs exactly one retry and uses the clean response.
- **Integration:** orchestrator anomaly path — given a stubbed LLM that keeps returning forbidden phrases for both attempts, the orchestrator emits a `behavioral` anomaly and uses the last response.
- **Stream:** the streaming endpoint emits a `confirmation` event for each side-effecting tool result with the correct payload, in the correct order relative to token events.
- **Behavioral (replay):** the bad conversation's turn 5 (after "apartament") — with the new validator, an LLM response containing "Am notat" with no save call gets a retry; the second response either calls the save tool or removes the claim.

## Migration

- Update existing tool handlers (`save_application_answer`, `save_dnt_answer`, `save_bd_answer`, `set_conversation_product`, `start_application`, `start_dnt_questionnaire`, `sign_dnt`, `calculate_premium`, `generate_quote`) to populate the `confirmation` field. No DB change required.
- Add new tools (`record_gdpr_consent`, `acknowledge_ai_disclosure`) — they write to the Customer fields introduced in [State Grounding](2026-05-20-zeno-state-grounding-design.md). No additional migration beyond that one.
- UI consumes the new `confirmation` stream event. Until the UI is updated to render these distinctly, they can be visible as plain text in the assistant turn — graceful degradation while UX work follows.

## Out of scope

- Detailed visual treatment of confirmation lines (this is a UX deliverable downstream).
- Modifying the existing compliance check. With consent/disclosure now tool-recorded, the check will pass more often, but the check itself stays as-is.
- Mode-specific confirmation behaviors (e.g. different language for SALES vs SUPPORT modes). The same confirmation structure applies across modes.
