# Slice B2: Sales Flow UI — Design Spec

**Project:** Zeno — AI Life Insurance Sales Agent V2
**Slice:** B2 (Product Cards, Question Cards, Quote Display, Data Collection — all inline in chat)
**Date:** 2026-03-20
**Status:** Approved
**Depends on:** Slice B1 (Conversation UI) — complete

---

## 1. Goal

Add rich interactive components (product cards, questionnaire cards, quote display, data collection forms, policy celebration) that render inline in the chat conversation, enabling the complete sales journey to work visually in the browser.

## 2. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Component location | Inline in chat (after assistant message) | Brand book says "everything happens inside the conversation". No separate pages, modals, or overlays. |
| Action flow | UI component → sendAction() → action adapter → tool pipeline | Same execution path as LLM-initiated tool calls. Principle 1: one path. |
| Question types | Single QuestionCard with type-specific rendering | DRY — one component handles all 7 types with conditional inputs. |
| Data collection | Per-field cards (not a multi-field form) | Conversational feel. One field at a time, within the chat flow. |

## 3. File structure

```
components/chat/rich/
  rich-content.tsx            — NEW: switch on ui_action.type → render correct component
  product-card.tsx            — NEW: tier card with pricing + "Alege" button
  quote-card.tsx              — NEW: premium breakdown + accept/modify buttons
  question-card.tsx           — NEW: typed input per question type (boolean, dropdown, text, etc.)
  bd-result-card.tsx          — NEW: eligible/rejected result
  policy-issued-card.tsx      — NEW: celebration + policy summary
  inline-data-form.tsx        — NEW: per-field data collection (name, CNP, DOB, etc.)
  confetti.tsx                — NEW: subtle confetti animation (Warm Sand + Sage)

lib/chat/action-adapter.ts   — MODIFIED: add B2 action mappings
lib/tools/handlers/*.ts       — MODIFIED: add uiAction returns to tool handlers
components/chat/message-list.tsx — MODIFIED: render RichContent after messages with ui_actions
lib/hooks/use-chat.ts         — MODIFIED: track ui_actions per message
```

## 4. UI Action → Component Mapping

| uiAction.type | Component | Triggered by tool |
|--------------|-----------|-------------------|
| `show_product_card` | ProductCard | get_product_info |
| `show_product_cards` | ProductCard (multiple) | get_product_info (with tiers) |
| `show_question` | QuestionCard | start_dnt_questionnaire, save_dnt_answer, save_application_answer |
| `show_quote` | QuoteCard | generate_quote |
| `show_bd_result` | BdResultCard (eligible) | check_bd_eligibility |
| `show_bd_rejected` | BdResultCard (rejected) | check_bd_eligibility |
| `show_policy_issued` | PolicyIssuedCard | accept_quote |
| `show_data_field` | InlineDataForm | When agent collects personal data |

Unknown types are silently ignored (forward compatible).

## 5. Component Designs

### 5.1 ProductCard

From brand book Section 7 wireframe:

```
+-------------------------------+
|                   [RECOMANDAT] |  <- Warm Sand badge (recommended only)
|  Standard Nivelul II           |  <- Inter 16px weight 500
|  Viata + Tratament Medical     |  <- Inter 13px, Muted
|                                |
|  53 lei/luna                   |  <- Inter 28px weight 500
|  640 RON/an                    |  <- Inter 12px, Muted
|                                |
|  ✓ Deces orice cauza: 40.000  |  <- Inter 13px, check in Sage
|  ✓ Tratament global: 2M EUR   |
|  ✓ Medicamente: 50.000 EUR    |
|  ✓ Spitalizare: 100 EUR/zi    |
|                                |
|  [ Alege acest plan ]          |  <- Primary button
+-------------------------------+
```

**Styling:**
- Card: `bg-soft-white border border-warm-border rounded-xl p-5`
- Selected state: `border-forest border-2`
- Recommended badge: `bg-sand text-night text-[11px] font-medium uppercase tracking-[0.5px] px-2.5 py-1 rounded-md`
- Price display: `text-[28px] font-medium` for monthly, `text-xs text-muted` for annual
- Feature check: Lucide Check icon in Sage color
- Button: Primary (Forest bg, Linen text)
- Animation: `animate-[message-appear_300ms_ease-out]` with 100ms stagger between cards

**Props:**
```typescript
interface ProductCardProps {
  tierName: { en: string; ro: string }
  levelName: { en: string; ro: string }
  tierCode: string
  levelCode: string
  premiumMonthly: number
  premiumAnnual: number
  coverages: { name: { en: string; ro: string }; amount: number; currency: string }[]
  isRecommended: boolean
  onSelect: () => void
  language: 'ro' | 'en'
}
```

**Action:** Click "Alege" → `sendAction({ type: 'select_tier', payload: { tierCode, levelCode } })`

**Multiple cards:** When showing all tiers, render 2-3 ProductCards. Desktop: side by side. Mobile: stacked vertically.

### 5.2 QuoteCard

**Layout:**
```
+-------------------------------+
|  Oferta ta                     |  <- Inter 18px weight 500
|                                |
|  Standard Nivelul II + BD      |  <- Inter 14px
|                                |
|  53 lei/luna                   |  <- Inter 28px weight 500, Forest
|  640 RON/an                    |  <- Inter 12px, Muted
|                                |
|  Acoperiri incluse:            |  <- Inter 13px weight 500
|  ✓ Deces: 40.000 RON          |
|  ✓ Invaliditate: 10.000 RON   |
|  ✓ Tratament: 2.000.000 EUR   |
|  ✓ Spitalizare: 100 EUR/zi    |
|                                |
|  Valabila pana la: 19 apr 2026 |  <- Inter 12px, Muted
|                                |
|  [ Accepta oferta ]  [Modifica]|  <- Primary + Secondary buttons
+-------------------------------+
```

**Styling:**
- Card: `bg-soft-white border border-warm-border rounded-xl p-5`
- Price: `text-forest text-[28px] font-medium`
- Coverage checks: Sage Check icon

**Actions:**
- Accept → `sendAction({ type: 'accept_quote', payload: { confirmAcceptance: true } })`
- Modify → `sendAction({ type: 'modify_quote', payload: {} })`

### 5.3 QuestionCard

Renders differently based on question type. All types share the same card wrapper.

**Shared wrapper:**
```
+-------------------------------+
|  Intrebarea 3 din 11           |  <- Progress, Inter 12px, Muted
|  [===========-------]         |  <- Progress bar (Sage fill on warm-border bg)
|                                |
|  {Question text in language}   |  <- Inter 15px, Night
|  {Help text if present}        |  <- Inter 13px, Muted
|                                |
|  {Type-specific input}         |
+-------------------------------+
```

**Type-specific inputs:**

| Type | Rendering |
|------|-----------|
| BOOLEAN | Two large buttons side by side: "Da" (primary width) + "Nu" (secondary width). Min height 44px. |
| DROPDOWN / MULTIPLE_CHOICE | Vertical list of tappable options. Each: `border border-warm-border rounded-lg px-4 py-3 text-[15px]`. Selected: `border-forest bg-forest/5`. |
| MULTI_SELECT | Same as DROPDOWN but with checkboxes. Submit button below: "Continua" |
| OPEN_ENDED | Text input (or textarea for long text) + submit button |
| NUMBER | Number input with +/- stepper buttons + direct entry. Min/max from validationRules. |
| DATE | Date input (native or simple day/month/year dropdowns for better mobile UX) |

**Progress bar:** `h-1.5 rounded-full bg-warm-border` with `bg-sage` fill proportional to answered/total.

**Action:** On answer → `sendAction({ type: 'answer_question', payload: { answer: value } })`

**Animation:** Card appears with `animate-[message-appear_200ms_ease-out]`

### 5.4 BdResultCard

**Eligible:**
- Sage bg (light, `bg-sage/10`), Sage border
- Check icon (Sage) + "Esti eligibil pentru tratament medical international"
- Tone: positive but not celebratory

**Rejected:**
- Linen bg, warm-border
- No alarm icon — neutral tone (brand book S16: zero humor on medical)
- Text: "Din cauza raspunsurilor, componenta de tratament medical in strainatate nu poate fi activata. Protectia de viata ramane disponibila si iti ofera acoperire pentru familie. Vrei sa continuam cu ea?"
- Two buttons: "Da, continua" (primary) + "Nu, multumesc" (secondary text button)

### 5.5 PolicyIssuedCard

**Layout:**
```
+-------------------------------+
|  [confetti animation]          |
|                                |
|  Felicitari!                   |  <- Fraunces 22px (exception: display font for celebration)
|  Polita ta se activeaza.       |  <- Inter 16px
|                                |
|  Standard Nivelul II + BD      |  <- Inter 14px weight 500
|  Acoperire totala: 2.040.000€  |  <- Inter 14px
|  53 lei/luna                   |  <- Inter 20px weight 500, Forest
|                                |
|  Vei primi confirmarea pe      |  <- Inter 14px, Muted
|  email in urmatoarele ore.     |
|                                |
+-------------------------------+
```

**Confetti:** Subtle — small circles in Warm Sand and Sage, floating down, 2 seconds, then fade out. `prefers-reduced-motion: reduce` → no confetti. CSS-only animation (no library).

**Card:** `bg-forest/5 border border-sage rounded-xl p-6`

### 5.6 InlineDataForm

For collecting personal data conversationally. Each field renders as its own card.

**Fields:**
| Field | Type | Validation |
|-------|------|-----------|
| name | text input | min 2 chars |
| cnp | text input | 13 digits, pattern `^[1-9]\d{12}$`, real-time feedback |
| dateOfBirth | date input | valid date, 18-64 years old |
| email | email input | email pattern |
| phone | tel input | Romanian phone pattern |
| address | textarea or structured (street, city, county) | non-empty |

**Card layout:** Same wrapper as QuestionCard but with a field-specific label and input. Submit button per field.

**CNP validation:** Show inline validation message as user types. Green check when valid, red message when invalid format.

**Action:** Submit → `sendAction({ type: 'submit_field', payload: { field: 'cnp', value: '...' } })`

## 6. RichContent Wrapper

**`components/chat/rich/rich-content.tsx`**

```typescript
interface RichContentProps {
  action: { type: string; payload: Record<string, unknown> }
  onAction: (action: UIAction) => void
  language: 'ro' | 'en'
}

function RichContent({ action, onAction, language }: RichContentProps) {
  switch (action.type) {
    case 'show_product_card':
    case 'show_product_cards':
      return <ProductCard ... />
    case 'show_question':
      return <QuestionCard ... />
    case 'show_quote':
      return <QuoteCard ... />
    case 'show_bd_result':
    case 'show_bd_rejected':
      return <BdResultCard ... />
    case 'show_policy_issued':
      return <PolicyIssuedCard ... />
    case 'show_data_field':
      return <InlineDataForm ... />
    default:
      return null  // unknown types silently ignored
  }
}
```

## 7. Integration Changes

### 7.1 useChat hook changes

Add to state:
```typescript
// Separate map, NOT on ChatMessage
uiActions: Map<string, { type: string; payload: Record<string, unknown> }>
// key = assistant message ID that triggered the action
```

On `ui_action` SSE event (in BOTH `sendMessage` and `sendAction` event loops): store with current assistant message ID as key.

Expose in return: `uiActions` map.

**Answered state:** Track which message IDs have been "answered" (user clicked a button on the rich component). Answered QuestionCards/ProductCards become read-only (show selected answer, disable inputs).

### 7.2 MessageList changes

After rendering each assistant MessageBubble, check `uiActions.get(message.id)`:
- If action exists → render `<RichContent action={action} onAction={sendAction} language={language} isAnswered={answeredIds.has(message.id)} />` below the bubble
- Rich content gets the same message-appear animation
- When a component triggers `onAction()`, mark that message ID as answered

### 7.3 Action adapter redesign

The existing adapter uses simple `Record<string, function>` lookup. B2 needs payload-conditional routing. Redesign `adaptAction()` to support this:

```typescript
export function adaptAction(action: UIAction): ToolCall | null {
  switch (action.type) {
    case 'select_tier':
      // Tier selection is a two-part answer: set package + level
      // Use a dedicated tool that handles both at once
      return {
        id: `action_${Date.now()}`,
        name: 'save_application_answer',
        arguments: { answer: String(action.payload.tierCode), field: 'PACKAGE_CHOICE' },
      }

    case 'select_level':
      return {
        id: `action_${Date.now()}`,
        name: 'save_application_answer',
        arguments: { answer: String(action.payload.levelCode), field: 'PREMIUM_LEVEL' },
      }

    case 'answer_question': {
      // Route based on groupType in payload
      const groupType = action.payload.groupType as string
      const toolName = groupType === 'dnt' ? 'save_dnt_answer' : 'save_application_answer'
      return {
        id: `action_${Date.now()}`,
        name: toolName,
        arguments: { answer: String(action.payload.answer) },
      }
    }

    case 'accept_quote':
      return {
        id: `action_${Date.now()}`,
        name: 'accept_quote',
        arguments: { confirmAcceptance: true },
      }

    case 'modify_quote':
      return {
        id: `action_${Date.now()}`,
        name: 'modify_quote',
        arguments: {},
      }

    case 'submit_field':
      return {
        id: `action_${Date.now()}`,
        name: 'collect_customer_field',  // NEW blocking tool, not update_customer_profile (which is background)
        arguments: {
          field: String(action.payload.field),
          value: String(action.payload.value),
        },
      }

    // Keep existing mappings from B1...
    default:
      return null
  }
}
```

**Key changes from B1 adapter:**
- `answer_question` uses `switch` with `groupType` payload field to route to correct tool
- `select_tier` and `select_level` are SEPARATE actions (not combined) matching the application's two-question flow (PACKAGE_CHOICE then PREMIUM_LEVEL)
- `submit_field` routes to a NEW `collect_customer_field` tool (see Section 7.5) instead of background `update_customer_profile`

### 7.4 Tool handler uiAction payloads (typed)

Each handler adds `uiAction` to its ToolResult with a specific typed payload:

```typescript
// show_question payload
interface ShowQuestionPayload {
  question: {
    id: string
    code: string | null
    text: { en: string; ro: string }
    helpText: { en: string; ro: string } | null
    type: string  // BOOLEAN, DROPDOWN, etc.
    options: Array<{ value: string; label: { en: string; ro: string } }> | null
  }
  progress: { answered: number; total: number }
  groupType: 'dnt' | 'application' | 'bd_medical'
}

// show_product_cards payload
interface ShowProductCardsPayload {
  tiers: Array<{
    tierCode: string
    tierName: { en: string; ro: string }
    levels: Array<{
      levelCode: string
      levelName: { en: string; ro: string }
      premiumAnnual: number
      premiumMonthly: number
      coverages: Array<{ name: { en: string; ro: string }; amount: number; currency: string }>
    }>
    isRecommended: boolean
  }>
  addonAvailable: boolean
  addonName: { en: string; ro: string } | null
}

// show_quote payload
interface ShowQuotePayload {
  quoteId: string
  tierName: { en: string; ro: string }
  levelName: { en: string; ro: string }
  includesAddon: boolean
  premiumAnnual: number
  premiumMonthly: number
  baseCoverages: Array<{ name: { en: string; ro: string }; amount: number; currency: string }>
  addonCoverages: Array<{ name: { en: string; ro: string }; amount: number; currency: string }>
  validUntil: string  // ISO date
}

// show_policy_issued payload
interface ShowPolicyIssuedPayload {
  policyId: string
  tierName: { en: string; ro: string }
  levelName: { en: string; ro: string }
  includesAddon: boolean
  premiumMonthly: number
  totalCoverage: string  // formatted, e.g., "2.040.000 EUR"
}

// show_bd_result / show_bd_rejected payload
interface ShowBdResultPayload {
  eligible: boolean
  message: { en: string; ro: string }
}

// show_data_field payload
interface ShowDataFieldPayload {
  field: string  // 'name', 'cnp', 'dateOfBirth', 'email', 'phone', 'address'
  label: { en: string; ro: string }
  type: 'text' | 'email' | 'tel' | 'date' | 'textarea'
  validation?: { pattern?: string; minLength?: number; maxLength?: number }
  placeholder?: { en: string; ro: string }
}
```

**Which handlers return which uiAction:**

| Handler file | Handler | uiAction type | When |
|-------------|---------|---------------|------|
| handlers/dnt-handlers.ts | startDntQuestionnaire | show_question | Always (returns first question) |
| handlers/dnt-handlers.ts | saveDntAnswer | show_question | When next question exists |
| handlers/application-handlers.ts | startApplication | show_question | Always (returns first question) |
| handlers/application-handlers.ts | saveApplicationAnswer | show_question | When next question exists |
| handlers/quote-handlers.ts | generateQuote | show_quote | Always |
| handlers/quote-handlers.ts | acceptQuote | show_policy_issued | Always |
| handlers/bd-handlers.ts | checkBdEligibility | show_bd_result or show_bd_rejected | Always |
| lib/tools/registry.ts (inline) | get_product_info | show_product_cards | When product has pricing tiers |
| handlers/data-handlers.ts | collectCustomerField | show_data_field | When next field to collect |

### 7.5 New tool: collect_customer_field

The `update_customer_profile` tool is background (no SSE response). For inline data collection, we need a **blocking** tool that:
1. Validates the field value (CNP pattern, email format, etc.)
2. Saves to Customer record
3. Returns `uiAction: { type: 'show_data_field', payload: nextField }` if more fields needed
4. Returns success message when all fields collected

Create: `lib/tools/handlers/data-handlers.ts`

```typescript
export const collectCustomerField: ToolHandler = async (args, context) => {
  // Validate field value
  // Save to Customer (name, cnp, email, phone, dateOfBirth, or address)
  // Determine if more fields needed
  // Return uiAction with next field, or success if done
}
```

Register in `lib/tools/registry.ts`: `collect_customer_field`, blocking, silent, no statusMessage, allowedRoles: [CUSTOMER, ADMIN, OPERATOR].

### 7.6 Orchestrator: uiAction → SSE event

The orchestrator already checks for `uiAction` in tool results (Step 7 of A2). Verify this code path works:
1. Tool handler returns `ToolResult` with `uiAction`
2. Pipeline returns `PipelineResult` with `toolResult.uiAction`
3. Orchestrator step 7: after executing tool, if `toolResult.uiAction` exists → yield SSE `ui_action` event
4. `useChat` receives it, stores in `uiActions` map

If the orchestrator does NOT currently emit `ui_action` SSE events from `toolResult.uiAction`, add this. Check the current code in `lib/chat/orchestrator.ts` step 7.

### 7.7 BD medical answer routing

BD medical questions are in the `bd_medical` QuestionGroup. When `answer_question` comes with `groupType: 'bd_medical'`:
- Route to `save_application_answer` (NOT `save_dnt_answer`)
- The `saveApplicationAnswer` handler must be updated to also handle BD medical group questions. Currently it only queries the `application` group. Update it to check the `groupType` from the action payload or from the current workflow step.
- When the workflow is at the BD questionnaire step, the handler queries `['bd_medical']` groups instead of `['application']`.

**Simplest approach:** The `saveApplicationAnswer` handler already determines the active group from the workflow step code (same pattern as context-loaders). On `application_fill` step → `['application']`. On BD step → `['bd_medical']`.

## 8. Additional implementation notes

**DROPDOWN vs MULTIPLE_CHOICE rendering:** Both render as a vertical list of tappable options. The distinction is semantic (DROPDOWN implies a compact widget), but in the mobile-first chat context they render identically. The QuestionCard uses the same rendering for both. MULTI_SELECT is the only one with checkboxes + submit button.

**Answered QuestionCard state:** Once the user answers, the QuestionCard shows the selected answer (highlighted option) and disables all inputs. Prevents re-answering in scroll-back. The `isAnswered` prop controls this.

**Button loading state:** When user clicks a button on any rich component (Alege, Accepta, Da/Nu), the button shows a loading spinner (small, Linen color on Forest bg) and is disabled until the SSE response arrives. The `isStreaming` state from `useChat` controls this.

**Date formatting:** Romanian locale for dates. Use `Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })` for display. Example: "19 aprilie 2026".

**ProductCard tier selection flow:** The ProductCard shows tier+level combinations. When the customer clicks "Alege", it fires TWO sequential actions: first `select_tier` (sets PACKAGE_CHOICE), then after the tool response, `select_level` (sets PREMIUM_LEVEL). Alternatively, the handler can be updated to accept both values at once from a combined payload. The simpler approach: send `select_tier` with both `tierCode` and `levelCode`, and the handler sets both Application.tierId and Application.levelId in one call.

**Revised select_tier approach:** Since the ProductCard already knows both tier and level, send both in one action. The `saveApplicationAnswer` handler is updated to accept an optional `field` parameter. When `field` is provided, it sets the specific application field directly instead of going through the questionnaire flow. This avoids the two-sequential-calls complexity.

## 9. Responsive behavior

- **ProductCards:** Desktop: `grid grid-cols-2` or `grid-cols-3` for tiers. Mobile: `grid grid-cols-1` (stacked).
- **QuestionCard:** Full width of the chat area (within the 640px max).
- **QuoteCard:** Full width.
- **All inputs:** Minimum touch target 44x44px. Input text 15px (brand book).
- **Buttons:** Full width on mobile, auto-width on desktop.

## 10. Exit criteria

- [ ] ProductCard renders tier options with pricing, features, recommended badge, tappable
- [ ] QuoteCard shows premium breakdown with accept/modify buttons
- [ ] QuestionCard handles all 7 question types (BOOLEAN, DROPDOWN, MULTIPLE_CHOICE, MULTI_SELECT, OPEN_ENDED, NUMBER, DATE)
- [ ] BdResultCard shows eligible/rejected with appropriate tone per brand book
- [ ] PolicyIssuedCard with confetti animation (respects prefers-reduced-motion)
- [ ] InlineDataForm for personal data (name, CNP with live validation, DOB, email, phone)
- [ ] RichContent renders correct component for each ui_action type
- [ ] sendAction() flows through action adapter → tool pipeline → SSE response
- [ ] Tool handlers return uiAction in their ToolResult
- [ ] Action adapter routes answer_question to correct handler based on groupType
- [ ] Product cards: responsive grid (multi-column desktop, stacked mobile)
- [ ] All components match brand book styling (colors, fonts, spacing, animations)
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds

## 11. What B2 does NOT include

- Payment integration (B3 — Stripe/PayU)
- Auth / account creation (B3)
- Admin panel (B4)
- Customer dashboard (B4)
- Email notifications (B3)
