# Slice B1: Conversation UI — Design Spec

**Project:** Zeno — AI Life Insurance Sales Agent V2
**Slice:** B1 (Landing Page + Conversation UI)
**Date:** 2026-03-20
**Status:** Approved
**Depends on:** Phase A (Core Engine) — complete

---

## 1. Goal

Deliver a customer-facing web app where someone can land on the Zeno homepage, click a CTA, and have a real-time streaming conversation with the AI sales agent in a browser. Mobile-first, Romanian-first, styled per the Zeno brand book.

## 2. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Session management | Cookie + URL | Cookie for seamless return, URL for bookmark/share. No login required before checkout. |
| Landing page scope | Full per brand book | First impression matters. Hero, benefits, how-it-works, footer. One page, not complex. |
| Language | Hardcoded RO/EN toggle | Only 2 languages, static landing content. Chat language auto-detected. |
| SSE consumer | React hook | `useChat` hook manages stream state. Optimistic UI — user message appears immediately. |
| Animations | Brand book Section 9 | Subtle, purposeful. Fade+slide for messages, pulse for typing, crossfade for status messages. All animations respect `prefers-reduced-motion: reduce`. |
| Focus ring | 0.1 opacity everywhere | Brand book has inconsistency (S6 CSS: 0.1, S11 text: 0.2). Standardize on 0.1 matching the CSS spec: `box-shadow: 0 0 0 3px rgba(45,107,82,0.1)` |
| Dark mode | Light mode only in B1 | Brand book has full dark mode palette. Deferred — not in B1 scope. |
| Cookie/URL mismatch | Starts fresh | If cookie customer != URL conversation owner: start a new conversation for the cookie's customer. No read-only mode. |

## 3. Routes

| Route | Auth | Purpose |
|-------|------|---------|
| `/` | Public | Landing page: hero, benefits, how-it-works, footer |
| `/chat` | Public (anonymous session) | New conversation — creates customer + conversation, redirects to `/chat/[id]` |
| `/chat/[id]` | Public (session-linked) | Conversation UI — streams messages, resumes existing conversation |

## 4. Session Management

**Anonymous session flow:**
1. User visits `/chat` (via CTA button or direct)
2. Check for `zeno_session` cookie → if found, get customerId
3. If no cookie: create anonymous Customer (`isAnonymous: true`), set cookie
4. Create new Conversation linked to customer
5. Redirect to `/chat/[conversationId]`

**Cookie:** `zeno_session`
- Value: customerId (cuid)
- HttpOnly: true
- SameSite: Lax
- Max-Age: 30 days (2592000 seconds)
- Secure: true in production
- Path: /

**Return visit:**
- Cookie exists → customer record found → show most recent active conversation or start new
- `/chat/[id]` works without cookie (URL is the session for sharing/bookmarking)
- If cookie and URL mismatch (different customer): URL takes precedence (viewing someone else's shared link shows read-only or starts fresh)

## 5. File Structure

```
app/
  page.tsx                          — Landing page (full, replace current placeholder)
  chat/
    page.tsx                        — New conversation entry point (creates session, redirects)
    [id]/
      page.tsx                      — Conversation UI page (SSR loads conversation, CSR streams)
  api/
    session/
      route.ts                      — Session management (create/get customer from cookie)

components/
  landing/
    landing-header.tsx              — Zeno wordmark + language toggle
    hero-section.tsx                — Headline + CTA + trust badge
    benefits-section.tsx            — 3 benefit cards
    how-it-works-section.tsx        — 3 steps
    landing-footer.tsx              — Legal, ASF, Allianz, contact

  chat/
    chat-page.tsx                   — Full chat page wrapper (mobile full-screen, desktop centered)
    chat-header.tsx                 — Minimal: Zeno mark left, close right
    message-list.tsx                — Scrollable message area with auto-scroll
    message-bubble.tsx              — Agent (left/Linen) and User (right/Forest) bubbles
    typing-indicator.tsx            — 3-dot pulse OR status message text (crossfade)
    suggestion-pills.tsx            — Horizontal scrollable row above input
    chat-input.tsx                  — Sticky bottom input bar

lib/
  hooks/
    use-chat.ts                     — SSE stream consumer hook
    use-session.ts                  — Session/cookie management hook
  i18n/
    translations.ts                 — Landing page copy (RO + EN)
    language-context.tsx            — React context for language toggle
```

## 6. Landing Page

### 6.1 Layout (from brand book Section 7)

```
+-------------------------------------+
| [Zeno logo]              [Limba: RO]|  <- LandingHeader
+-------------------------------------+
|                                     |
|   Daca maine primesti un            |  <- Fraunces 48px
|   diagnostic grav, ai fi pregatit?  |
|                                     |
|   Acces la tratament in cele mai    |  <- Inter 18px, Muted
|   bune clinici din lume.            |
|   De la 45 lei pe luna.            |
|                                     |
|   [  Afla in 3 minute  ]           |  <- Primary button
|                                     |
|   Produs Allianz-Tiriac [logo]     |  <- Trust badge
+-------------------------------------+
|   +------+ +------+ +------+       |  <- 3 benefit cards
|   | Fara | |Tratat| |Activ |       |
|   |examen| |global| | azi  |       |
|   +------+ +------+ +------+       |
+-------------------------------------+
|   Cum functioneaza?                 |  <- 3 steps
|   1. Vorbesti cu Zeno (5 min)      |
|   2. Alegi protectia potrivita     |
|   3. Esti protejat din acel moment |
+-------------------------------------+
|   Footer: legal, ASF, contact,     |
|   powered by Allianz-Tiriac        |
+-------------------------------------+
```

### 6.2 Component details

**LandingHeader:**
- Zeno wordmark: Fraunces 500, Deep Forest color, -0.5px letter-spacing
- Language toggle: "RO | EN" text button, Inter 13px, Muted color
- Sticky on scroll? No — clean, minimal. Scrolls with page.

**HeroSection:**
- Headline: Fraunces 48px weight 500 (mobile: 32px)
- Subtitle: Inter 18px, Muted color
- CTA: Primary button (Deep Forest bg, Linen text, 12px 24px padding, 10px radius)
- Trust badge: "Produs Allianz-Tiriac" with Allianz logo placeholder (SVG in Phase B4 when real logo is available, text-only for now)
- Spacing: 64px top padding (hero), 48px between sections

**BenefitsSection:**
- 3 cards in a row (mobile: vertical stack)
- Card: Soft-white bg, warm-border, 12px radius, 20px padding
- Icon: Lucide line icon (Shield, Globe, Check), 24px, Forest color
- Title: Inter 16px weight 500
- Description: Inter 14px, Muted color

**HowItWorksSection:**
- 3 numbered steps, Inter 16px
- Step number: Forest color, weight 500
- Step text: Night color, weight 400

**LandingFooter:**
- Background: Night (#1C1C1A)
- Text: Muted color (#8A8680)
- Links: Sage color on hover
- Content: "Zeno — powered by Allianz-Tiriac", legal disclaimer, ASF mention, copyright

### 6.3 Copy (Romanian)

All landing page copy comes from `lib/i18n/translations.ts` with RO and EN variants. The Romanian copy is from brand book Section 4:

- Hero headline: "Daca maine primesti un diagnostic grav, ai fi pregatit?"
- Hero subtitle: "Acces la tratament in cele mai bune clinici din lume. De la 45 lei pe luna. Asigurare Allianz-Tiriac."
- CTA: "Afla in 3 minute"
- Benefits: "Fara examen medical", "Tratament global", "Activ din prima zi"
- Steps: "Vorbesti cu Zeno (5 min)", "Alegi protectia potrivita", "Esti protejat din acel moment"
- Footer: "Zeno este operat de [company name], agent de asigurare Allianz-Tiriac."

## 7. Conversation UI

### 7.1 Layout (from brand book Section 7)

```
+-------------------------------------+
| [Z] Zeno                      [x]  |  <- ChatHeader, 48px
+-------------------------------------+
|                                     |
|  +---------------------+           |  <- Agent bubble (left, Linen)
|  | Buna! Sunt Zeno...  |           |
|  +---------------------+           |
|                                     |
|           +---------------------+  |  <- User bubble (right, Forest bg, Soft White text)
|           | Am 34 de ani...     |  |
|           +---------------------+  |
|                                     |
|  +---------------------+           |
|  | ...streaming text... |           |  <- Active streaming bubble
|  +---------------------+           |
|                                     |
|  [***]                              |  <- Typing indicator OR status msg
|                                     |
|  [Da] [Nu] [Mai multe detalii]     |  <- Suggestion pills
+-------------------------------------+
| [ Scrie un mesaj...          [->] ] |  <- ChatInput, sticky bottom
+-------------------------------------+

Mobile: full screen, edge to edge
Desktop: centered, max-width 640px, Soft White visible on sides
```

### 7.2 Component details

**ChatPage:**
- Mobile: 100vw, 100dvh (dynamic viewport height for mobile browsers)
- Desktop: centered, max-width 640px, Soft White page background visible on sides
- Flex column: header (fixed) + messages (flex-grow, scroll) + pills + input (fixed bottom)

**ChatHeader:**
- Height: 48px
- Left: Zeno mark icon (24px) + "Zeno" text (Inter 16px weight 500)
- Right: Close button (x icon, 24px, navigates to `/`)
- Background: Soft White, bottom border: warm-border 1px
- No shadow (brand book: no decorative shadows)

**MessageList:**
- `overflow-y: auto`, scroll to bottom on new messages
- Padding: 16px horizontal, 12px vertical between messages
- Uses `ref` to scroll container, auto-scroll when near bottom (threshold: 100px from bottom)
- When user scrolls up: disable auto-scroll, show "scroll to bottom" pill

**MessageBubble:**
- Agent: left-aligned, Linen bg (#F5EDE3), Night text (#1C1C1A), radius 16/16/16/4, max-width 85%
- User: right-aligned, Forest bg (#1A3A2F), Soft White text (#FAF8F5), radius 16/16/4/16, max-width 85%
- Padding: 12px 16px
- Font: Inter 15px/1.5
- Message appear animation: fade in + slide up 8px, 200ms ease (agent from left, user from right)
- Streaming: bubble grows smoothly as text arrives. No per-character animation.

**TypingIndicator:**
- Default state: three dots with gentle pulse (opacity 0.4→1.0, staggered 150ms between dots)
- Tool status state: dots crossfade to status message text (Inter 13px, Muted color)
- Transition: 150ms crossfade between dots and text
- Position: left-aligned below messages, same horizontal position as agent bubbles
- Uses Deep Forest color dots on Linen background
- Only visible when agent is processing (isStreaming or tool executing)

**SuggestionPills:**
- Horizontal row above input, scrollable on overflow
- Each pill: Soft White bg (#FAF8F5), warm-border 1px, 20px radius, 8px 16px padding
- Text: Inter 13px weight 400, Night color
- Hover: Linen bg, Warm Sand border
- Tappable: clicking a pill sends it as a user message
- Appear: fade in, 150ms, all at once (no stagger)
- Suggestions come from: (a) LLM response can include suggestion pills via metadata, (b) static defaults based on conversation state

**ChatInput:**
- Sticky bottom (above keyboard on mobile)
- Background: Soft White
- Input field: full width, Soft White bg, warm-border, 10px radius, 12px 16px padding
- Placeholder: "Scrie un mesaj..." in Muted color
- Send button: right side, Forest bg circle with arrow-up icon (Linen color)
- Send on Enter (desktop), send button tap (mobile)
- Disabled while streaming (prevent double-send)
- Focus ring: `box-shadow: 0 0 0 3px rgba(45,107,82,0.1)` (standardized at 0.1 opacity)

## 8. SSE Stream Consumer

### `lib/hooks/use-chat.ts`

```typescript
interface UIAction {
  type: string
  payload: Record<string, unknown>
}

interface UseChatReturn {
  messages: ChatMessage[]
  isStreaming: boolean
  toolStatus: { tool: string; message: string } | null
  error: string | null
  conversationId: string | null    // updated from done event
  customerId: string | null        // from session
  sendMessage: (text: string) => void
  sendAction: (action: UIAction) => void  // used in B2 for product cards, forms
  suggestions: string[]
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  isStreaming: boolean       // true while content is still arriving
  toolCalls?: unknown[]      // for UI actions (B2)
  createdAt: Date
}

function useChat(conversationId: string, customerId: string): UseChatReturn
```

### 8.1 Conversation lifecycle

**Creation path:** The `/chat` server component creates the session and conversation via `POST /api/session` BEFORE rendering the client component. The `conversationId` and `customerId` are always available as props to the chat page — the orchestrator never needs to auto-create them.

Flow:
1. User clicks CTA → navigates to `/chat`
2. `/chat/page.tsx` (server component): call `POST /api/session` → get `customerId`, create Conversation via Prisma, redirect to `/chat/[conversationId]`
3. `/chat/[id]/page.tsx` (server component): load conversation + existing messages via Prisma, pass as props to client `ChatPage` component
4. Client `ChatPage` initializes `useChat(conversationId, customerId)` with known IDs

**Resume path (`/chat/[id]`):**
- Server component loads conversation + messages via Prisma (server-side, no API call needed)
- If conversation not found → redirect to `/chat` (start fresh)
- Pass existing messages as `initialMessages` prop to `ChatPage`
- `useChat` hook hydrates with initialMessages, then handles new messages via SSE

### 8.2 SSE connection flow

1. When `sendMessage(text)` is called:
   - Add optimistic user message to state
   - POST to `/api/chat` with `{ conversationId, customerId, message: text }`
   - Read SSE stream via `fetch` + `getReader()` (not EventSource — we need POST with body)
2. Handle events:
   - `content`: append to current assistant message content, set isStreaming=true
   - `tool_start`: set toolStatus with tool name + status message
   - `tool_complete`: clear toolStatus
   - `ui_action`: store for component rendering (product cards, etc. — used in B2)
   - `error`: set error state, show error inline in chat as a system message bubble (Error color #8B2D2D text, Linen bg)
   - `done`: finalize message (isStreaming=false), extract suggestions if present
3. On stream end: clear isStreaming

### 8.3 Error display

Errors show as inline system messages in the chat, not toasts or banners:
- Background: Linen (#F5EDE3)
- Text: Error color (#8B2D2D)
- Icon: AlertCircle (Lucide) left of text
- Text: "A aparut o eroare. Te rog incearca din nou." (RO) / "Something went wrong. Please try again." (EN)
- The message is ephemeral — removed when the user sends a new message

### 8.4 Loading state (skeleton)

While `/chat/[id]` server component fetches data:
- Show Linen-colored pulsing skeleton blocks in the message area
- Header and input bar render immediately (static)
- Skeleton: 3 rounded rectangles (Linen bg, gentle opacity pulse 0.5→1.0, 1.5s cycle) mimicking message bubble shapes

### 8.5 Scroll-to-bottom pill

When user scrolls up (auto-scroll disabled):
- Floating pill at bottom-center of message list
- Soft White bg, warm-border 1px, 20px radius
- ChevronDown icon (Lucide, 16px) + "Mesaje noi" text (Inter 12px)
- Fade in 150ms
- Click → smooth scroll to bottom, re-enable auto-scroll

**Reconnection:** No automatic reconnection. If the stream fails mid-response, show inline error. User retries by sending another message.

**Fetch-based SSE** (not EventSource):
- EventSource only supports GET. We need POST with body.
- Use `fetch()` with `{ method: 'POST', body, headers }` → `response.body.getReader()` → decode SSE manually
- Parse each `event: X\ndata: Y\n\n` block

## 9. Session API

### `app/api/session/route.ts`

```
POST /api/session
Response: { customerId, isNew }
```

- Check `zeno_session` cookie
- If cookie exists: find Customer, return customerId
- If no cookie: create anonymous Customer, set cookie, return customerId + isNew=true

Used by the `/chat` page to resolve/create session before starting a conversation.

## 10. Language System

### `lib/i18n/translations.ts`

Simple key-value translations for landing page only (not the chat — chat language is handled by the LLM).

```typescript
const translations = {
  ro: {
    hero_headline: 'Daca maine primesti un diagnostic grav, ai fi pregatit?',
    hero_subtitle: 'Acces la tratament in cele mai bune clinici din lume...',
    cta_button: 'Afla in 3 minute',
    // ... all landing page copy
  },
  en: {
    hero_headline: 'If you received a serious diagnosis tomorrow, would you be prepared?',
    // ... all landing page copy
  }
}

function t(key: string, lang: 'ro' | 'en'): string
```

### `lib/i18n/language-context.tsx`

React context providing current language + toggle function. Reads/writes `zeno_lang` cookie. Defaults to 'ro'. Also updates `document.documentElement.lang` attribute for accessibility/screen readers.

## 11. Responsive Behavior

From brand book Section 10:

| Breakpoint | Chat | Landing |
|-----------|------|---------|
| Mobile (<640px) | Full-screen, edge-to-edge, no side padding | Single column, stacked cards |
| Tablet (640-1024px) | Centered, max-width 640px | Centered content, max-width 640px |
| Desktop (>1024px) | Centered, max-width 640px, Soft White background visible | Same as tablet |

**Mobile-specific:**
- Chat: 100dvh (dynamic viewport height — accounts for mobile browser chrome)
- Input bar: sticks above virtual keyboard
- Product cards: stack vertically (no side-by-side)
- Touch targets: minimum 44x44px

## 12. Accessibility

From brand book Section 11:
- All text meets WCAG 2.1 AA contrast ratios
- Focus rings on all interactive elements: `box-shadow: 0 0 0 3px rgba(45,107,82,0.1)`
- Chat messages have proper ARIA roles (`role="log"` for message list, `aria-live="polite"` for new messages)
- Suggestion pills are keyboard-navigable (Tab between, Enter to select)
- Send button has `aria-label="Send message"`
- Typing indicator has `aria-label="Zeno is typing"` with `aria-live="polite"`

## 13. Exit criteria

- [ ] Landing page matches brand book Section 7 wireframe
- [ ] Landing page has RO/EN toggle with all copy translated
- [ ] CTA navigates to `/chat`, creates anonymous session
- [ ] `/chat/[id]` displays conversation UI
- [ ] Messages stream in real-time via SSE
- [ ] Agent bubbles (left, Linen) and user bubbles (right, Deep Forest) per brand book
- [ ] Typing indicator: 3-dot pulse animation
- [ ] Tool status messages replace typing indicator (150ms crossfade)
- [ ] Suggestion pills above input (tappable, send as message)
- [ ] Chat input: send on Enter, disabled during streaming
- [ ] Auto-scroll to bottom on new messages
- [ ] Mobile-first: full-screen chat on mobile, centered 640px on desktop
- [ ] Cookie-based session (zeno_session, 30-day, HttpOnly)
- [ ] Animations per brand book Section 9
- [ ] WCAG 2.1 AA contrast, focus rings, ARIA roles
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds

## 14. What B1 does NOT include

- Product cards inline in chat (B2)
- Inline data collection forms (B2)
- Questionnaire UI cards (B2)
- Quote display card (B2)
- Payment integration (B3)
- Auth / login / account creation (B3)
- Admin panel (B4)
- Customer dashboard (B4)
- Email notifications (B3)
