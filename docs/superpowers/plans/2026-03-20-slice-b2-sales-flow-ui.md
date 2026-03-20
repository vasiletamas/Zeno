# Slice B2: Sales Flow UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rich interactive components (product cards, question cards, quote display, data collection, policy celebration) rendering inline in the chat conversation, enabling the complete sales journey to work visually in the browser.

**Architecture:** Rich components render as special entries in the chat message list, triggered by `ui_action` SSE events from tool handlers. User interactions flow back through `sendAction()` → action adapter → tool pipeline → SSE response. All components follow Zeno brand book styling.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Lucide icons, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-20-slice-b2-sales-flow-ui-design.md`

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `components/chat/rich/rich-content.tsx` | Switch on ui_action type → render correct component |
| `components/chat/rich/product-card.tsx` | Tier card with pricing + "Alege" button |
| `components/chat/rich/quote-card.tsx` | Premium breakdown + accept/modify buttons |
| `components/chat/rich/question-card.tsx` | Typed input per question type (7 types) |
| `components/chat/rich/bd-result-card.tsx` | Eligible/rejected result |
| `components/chat/rich/policy-issued-card.tsx` | Celebration + policy summary |
| `components/chat/rich/inline-data-form.tsx` | Per-field data collection |
| `components/chat/rich/confetti.tsx` | CSS-only confetti animation |
| `lib/tools/handlers/data-handlers.ts` | NEW: collect_customer_field blocking tool |

### Modified files

| File | Change |
|------|--------|
| `lib/chat/action-adapter.ts` | Redesign with switch + payload-conditional routing |
| `lib/hooks/use-chat.ts` | Add uiActions map, answered state tracking |
| `components/chat/message-list.tsx` | Render RichContent after messages with ui_actions |
| `lib/tools/handlers/dnt-handlers.ts` | Add uiAction returns |
| `lib/tools/handlers/application-handlers.ts` | Add uiAction returns, support BD group |
| `lib/tools/handlers/quote-handlers.ts` | Add uiAction returns |
| `lib/tools/handlers/bd-handlers.ts` | Add uiAction returns |
| `lib/tools/registry.ts` | Register collect_customer_field, update get_product_info handler |
| `lib/tools/validation.ts` | Add collect_customer_field schema |

---

## Task 1: Rich Components

**Files:**
- Create: all 8 files in `components/chat/rich/`

- [ ] **Step 1: Create all rich components**

Read the spec Section 5 for exact styling. Read the brand book Sections 6-7 for component CSS.

**product-card.tsx:** Tier card with name, monthly/annual price, coverage list, recommended badge, "Alege" button. Props include onSelect callback. Uses brand book product card wireframe exactly.

**quote-card.tsx:** Quote summary with all coverages, monthly price, valid-until date, accept/modify buttons. Romanian date formatting via `Intl.DateTimeFormat('ro-RO')`.

**question-card.tsx:** The most complex component. Renders different input types:
- BOOLEAN: Two large buttons "Da" / "Nu"
- DROPDOWN / MULTIPLE_CHOICE: Vertical tappable option list
- MULTI_SELECT: Checkboxes + submit button
- OPEN_ENDED: Text input/textarea + submit
- NUMBER: Number input with +/- stepper
- DATE: Date input (day/month/year dropdowns for mobile)
- Progress bar above question text

All types share the same card wrapper. `isAnswered` prop → show selected answer, disable inputs.

**bd-result-card.tsx:** Two variants — eligible (sage tint + check) and rejected (neutral Linen + respectful message).

**policy-issued-card.tsx:** Fraunces "Felicitari!" headline + policy summary + confetti animation.

**confetti.tsx:** CSS-only. ~20 small circles in Sand and Sage, position absolute, floating down animation 2s then fade. Respects `prefers-reduced-motion`.

**inline-data-form.tsx:** Per-field card with label, typed input, validation feedback, submit button. CNP: real-time 13-digit pattern check. Email/phone: pattern validation.

**rich-content.tsx:** Switch on `action.type` → render correct component. Passes `onAction`, `language`, `isAnswered` to each.

- [ ] **Step 2: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add components/chat/rich/
git commit -m "feat(b2): add rich chat components — product cards, question cards, quote, policy celebration"
```

---

## Task 2: Tool Handler uiAction Updates + New Data Tool

**Files:**
- Create: `lib/tools/handlers/data-handlers.ts`
- Modify: `lib/tools/handlers/dnt-handlers.ts`, `application-handlers.ts`, `quote-handlers.ts`, `bd-handlers.ts`
- Modify: `lib/tools/registry.ts`, `lib/tools/validation.ts`

- [ ] **Step 1: Create data-handlers.ts**

New `collect_customer_field` blocking tool:

```typescript
export const collectCustomerField: ToolHandler = async (args, context) => {
  const { field, value } = args as { field: string; value: string }
  // 1. Validate field value (CNP pattern, email format, phone format, etc.)
  // 2. Save to Customer record (name, cnp, email, phone, dateOfBirth, or address JSON)
  // 3. Determine next field needed (ordered list: name → cnp → dateOfBirth → email → phone → address)
  // 4. If more fields needed: return uiAction { type: 'show_data_field', payload: nextField }
  // 5. If all collected: return success message + mark Customer.isAnonymous = false
}
```

- [ ] **Step 2: Register new tool**

Add to `lib/tools/registry.ts`:
- `collect_customer_field`: blocking, silent, null statusMessage, CUSTOMER/ADMIN/OPERATOR
- Update `get_product_info` handler to include `uiAction` with `show_product_cards` payload

Add Zod schema to `lib/tools/validation.ts`:
- `collect_customer_field`: `{ field: z.string(), value: z.string() }`

- [ ] **Step 3: Update existing handlers with uiAction returns**

Read spec Section 7.4 typed payloads. For each handler:

**dnt-handlers.ts:**
- `startDntQuestionnaire`: add `uiAction: { type: 'show_question', payload: { question, progress, groupType: 'dnt' } }`
- `saveDntAnswer`: same, when next question exists

**application-handlers.ts:**
- `startApplication`: add `uiAction` for first question
- `saveApplicationAnswer`: add `uiAction` for next question. Also update to support `bd_medical` group when workflow step is BD-related.

**quote-handlers.ts:**
- `generateQuote`: add `uiAction: { type: 'show_quote', payload: { quoteId, tierName, levelName, ... } }`
- `acceptQuote`: add `uiAction: { type: 'show_policy_issued', payload: { policyId, ... } }`

**bd-handlers.ts:**
- `checkBdEligibility`: add `uiAction: { type: 'show_bd_result' or 'show_bd_rejected', payload: { eligible, message } }`

- [ ] **Step 4: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add lib/tools/handlers/ lib/tools/registry.ts lib/tools/validation.ts
git commit -m "feat(b2): add uiAction returns to tool handlers and new collect_customer_field tool"
```

---

## Task 3: Action Adapter + useChat + MessageList Integration

**Files:**
- Modify: `lib/chat/action-adapter.ts`, `lib/hooks/use-chat.ts`, `components/chat/message-list.tsx`

- [ ] **Step 1: Redesign action adapter**

Replace the existing `adaptAction()` with the switch-based implementation from spec Section 7.3. Support: `select_tier`, `select_level`, `answer_question` (with groupType routing), `accept_quote`, `modify_quote`, `submit_field`. Keep existing B1 mappings.

- [ ] **Step 2: Update useChat hook**

Add to state:
- `uiActions: Map<string, { type: string; payload: Record<string, unknown> }>` (keyed by message ID)
- `answeredMessageIds: Set<string>`

In SSE event handler (both sendMessage and sendAction paths): when `ui_action` event received, store in uiActions map with current assistant message ID as key.

Add to return type: `uiActions`, `markAnswered(messageId: string)`.

When `markAnswered` is called: add messageId to answeredMessageIds set.

- [ ] **Step 3: Update MessageList**

After each assistant MessageBubble, check `uiActions.get(message.id)`. If exists, render `<RichContent>` below the bubble. Pass `isAnswered={answeredMessageIds.has(message.id)}`. When rich component triggers `onAction()`, also call `markAnswered(message.id)`.

- [ ] **Step 4: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add lib/chat/action-adapter.ts lib/hooks/use-chat.ts components/chat/message-list.tsx
git commit -m "feat(b2): integrate rich components with action adapter, useChat hook, and message list"
```

---

## Task 4: Final Verification

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`

- [ ] **Step 2: Production build**

Run: `npm run build`

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(b2): complete Slice B2 — sales flow UI with rich chat components"
```

---

## Notes for Implementer

1. **Brand book reference:** Read `zeno-brand-book.md` Sections 6 (UI components: product card CSS, chat bubbles, buttons, inputs, badges) and 7 (product tier card wireframe, conversation interface layout).

2. **Typed payloads:** Read spec Section 7.4 for the exact TypeScript interfaces for each uiAction payload. Use these as props interfaces for the components.

3. **Question types:** DROPDOWN and MULTIPLE_CHOICE render identically (vertical tappable list). MULTI_SELECT has checkboxes + submit. 7 types total but effectively 6 distinct renderings.

4. **Answered state:** Rich components must support `isAnswered` prop. When true: show selected answer, disable all inputs, mute colors slightly. Prevents re-answering when scrolling back.

5. **Button loading:** When user clicks any rich component button, show loading state (spinner) and disable until SSE response arrives. Use `isStreaming` from useChat.

6. **Confetti:** CSS-only, no library. ~20 circles, absolute positioned in the PolicyIssuedCard, fall animation with opacity fade. Must respect `prefers-reduced-motion: reduce`.

7. **Date formatting:** Use `Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })` for Romanian dates in QuoteCard.

8. **BD rejection tone:** Brand book S16 says zero humor on medical. Use the exact text from the spec's BdResultCard description.

9. **get_product_info handler:** Already exists in registry.ts as an inline handler. Add `uiAction` return with `show_product_cards` type and the full tier/level/coverage payload.

10. **Orchestrator ui_action emission:** Verify `lib/chat/orchestrator.ts` step 7 already emits `ui_action` SSE events from `toolResult.uiAction`. If not, add the emission after tool execution.
