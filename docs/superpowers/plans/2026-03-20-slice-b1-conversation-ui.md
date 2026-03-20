# Slice B1: Conversation UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a customer-facing web app where someone can land on the Zeno homepage, click a CTA, and have a real-time streaming conversation with the AI sales agent in a browser.

**Architecture:** Next.js App Router with server components for data loading and client components for interactive chat. SSE streaming via fetch + getReader (not EventSource). Anonymous sessions via HttpOnly cookies. All styling via Tailwind with Zeno brand tokens from the brand book.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-20-slice-b1-conversation-ui-design.md`
**Brand book:** `zeno-brand-book.md` (Sections 2-11 for colors, fonts, components, layouts, animations)

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `lib/i18n/translations.ts` | Landing page copy RO + EN |
| `lib/i18n/language-context.tsx` | React context for language toggle + cookie |
| `lib/hooks/use-chat.ts` | SSE stream consumer hook |
| `lib/hooks/use-session.ts` | Session/cookie management |
| `components/landing/landing-header.tsx` | Zeno wordmark + language toggle |
| `components/landing/hero-section.tsx` | Headline + CTA + trust badge |
| `components/landing/benefits-section.tsx` | 3 benefit cards |
| `components/landing/how-it-works-section.tsx` | 3 steps |
| `components/landing/landing-footer.tsx` | Legal, ASF, Allianz |
| `components/chat/chat-page.tsx` | Full chat page wrapper (client component) |
| `components/chat/chat-header.tsx` | Minimal: Zeno mark + close |
| `components/chat/message-list.tsx` | Scrollable message area with auto-scroll |
| `components/chat/message-bubble.tsx` | Agent (left/Linen) and User (right/Forest) bubbles |
| `components/chat/typing-indicator.tsx` | 3-dot pulse OR status message crossfade |
| `components/chat/suggestion-pills.tsx` | Horizontal scrollable quick-reply pills |
| `components/chat/chat-input.tsx` | Sticky bottom input with send button |
| `components/chat/scroll-to-bottom.tsx` | Floating pill when user scrolls up |
| `components/chat/chat-skeleton.tsx` | Loading skeleton for initial page load |
| `components/chat/error-message.tsx` | Inline error display |
| `app/page.tsx` | Landing page (replace placeholder) |
| `app/chat/page.tsx` | New conversation entry (server component → redirect) |
| `app/chat/[id]/page.tsx` | Conversation UI page (server → client) |
| `app/api/session/route.ts` | Session management API |

### Modified files

| File | Change |
|------|--------|
| `app/layout.tsx` | Add LanguageProvider context wrapper |
| `app/globals.css` | Add chat-specific animations (message appear, typing pulse, crossfade) |

---

## Task 1: i18n + Session Infrastructure

**Files:**
- Create: `lib/i18n/translations.ts`, `lib/i18n/language-context.tsx`, `lib/hooks/use-session.ts`, `app/api/session/route.ts`

- [ ] **Step 1: Create translations.ts**

Landing page copy in RO + EN. All text from brand book Section 4 + Section 7.

```typescript
export type Language = 'ro' | 'en'

export const translations: Record<Language, Record<string, string>> = {
  ro: {
    hero_headline: 'Dacă mâine primești un diagnostic grav, ai fi pregătit?',
    hero_subtitle: 'Acces la tratament în cele mai bune clinici din lume. De la 45 lei pe lună. Asigurare Allianz-Țiriac.',
    cta_button: 'Află în 3 minute',
    trust_badge: 'Produs Allianz-Țiriac',
    benefit_1_title: 'Fără examen medical',
    benefit_1_desc: 'Protecție simplă, fără birocrație',
    benefit_2_title: 'Tratament global',
    benefit_2_desc: 'Acces la clinici de top din întreaga lume',
    benefit_3_title: 'Activ din prima zi',
    benefit_3_desc: 'Protecție imediată pentru familia ta',
    how_title: 'Cum funcționează?',
    how_step_1: 'Vorbești cu Zeno (5 min)',
    how_step_2: 'Alegi protecția potrivită',
    how_step_3: 'Ești protejat din acel moment',
    footer_legal: 'Zeno este operat de [company], agent de asigurare Allianz-Țiriac.',
    footer_asf: 'Reglementat de ASF.',
    chat_placeholder: 'Scrie un mesaj...',
    chat_new_messages: 'Mesaje noi',
    chat_error: 'A apărut o eroare. Te rog încearcă din nou.',
    chat_typing: 'Zeno se gândește...',
  },
  en: {
    hero_headline: 'If you received a serious diagnosis tomorrow, would you be prepared?',
    hero_subtitle: 'Access to treatment at the best clinics worldwide. From 45 lei per month. Allianz-Țiriac insurance.',
    cta_button: 'Find out in 3 minutes',
    trust_badge: 'An Allianz-Țiriac product',
    benefit_1_title: 'No medical exam',
    benefit_1_desc: 'Simple protection, no bureaucracy',
    benefit_2_title: 'Global treatment',
    benefit_2_desc: 'Access to top clinics worldwide',
    benefit_3_title: 'Active from day one',
    benefit_3_desc: 'Immediate protection for your family',
    how_title: 'How does it work?',
    how_step_1: 'Talk to Zeno (5 min)',
    how_step_2: 'Choose the right protection',
    how_step_3: 'You are protected from that moment',
    footer_legal: 'Zeno is operated by [company], insurance agent for Allianz-Țiriac.',
    footer_asf: 'Regulated by ASF.',
    chat_placeholder: 'Write a message...',
    chat_new_messages: 'New messages',
    chat_error: 'Something went wrong. Please try again.',
    chat_typing: 'Zeno is thinking...',
  },
}

export function t(key: string, lang: Language): string {
  return translations[lang]?.[key] ?? key
}
```

- [ ] **Step 2: Create language-context.tsx**

React context providing language + toggle. Reads/writes `zeno_lang` cookie. Updates `document.documentElement.lang`.

```typescript
'use client'
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import type { Language } from './translations'

interface LanguageContextType {
  lang: Language
  toggleLanguage: () => void
}

const LanguageContext = createContext<LanguageContextType>({ lang: 'ro', toggleLanguage: () => {} })

export function LanguageProvider({ children, initialLang = 'ro' }: { children: ReactNode; initialLang?: Language }) {
  const [lang, setLang] = useState<Language>(initialLang)

  useEffect(() => {
    // Read cookie on mount
    const cookie = document.cookie.split('; ').find(c => c.startsWith('zeno_lang='))
    if (cookie) setLang(cookie.split('=')[1] as Language)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.cookie = `zeno_lang=${lang};path=/;max-age=2592000;samesite=lax`
  }, [lang])

  const toggleLanguage = () => setLang(prev => prev === 'ro' ? 'en' : 'ro')

  return <LanguageContext.Provider value={{ lang, toggleLanguage }}>{children}</LanguageContext.Provider>
}

export function useLanguage() { return useContext(LanguageContext) }
```

- [ ] **Step 3: Create use-session.ts**

Hook for reading session cookie (client-side).

```typescript
'use client'
export function useSession(): { customerId: string | null } {
  // Read zeno_session cookie
  const cookie = typeof document !== 'undefined'
    ? document.cookie.split('; ').find(c => c.startsWith('zeno_session='))
    : null
  return { customerId: cookie?.split('=')[1] ?? null }
}
```

- [ ] **Step 4: Create session API route**

`app/api/session/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const existingSession = cookieStore.get('zeno_session')

  if (existingSession?.value) {
    const customer = await prisma.customer.findUnique({ where: { id: existingSession.value } })
    if (customer) return NextResponse.json({ customerId: customer.id, isNew: false })
  }

  // Create anonymous customer
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })

  const response = NextResponse.json({ customerId: customer.id, isNew: true })
  response.cookies.set('zeno_session', customer.id, {
    httpOnly: true, sameSite: 'lax', maxAge: 2592000, path: '/', secure: process.env.NODE_ENV === 'production',
  })
  return response
}
```

- [ ] **Step 5: Update layout.tsx with LanguageProvider**

Wrap children in `<LanguageProvider>` in `app/layout.tsx`.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add lib/i18n/ lib/hooks/use-session.ts app/api/session/route.ts app/layout.tsx
git commit -m "feat(b1): add i18n system, language context, session API, and session hook"
```

---

## Task 2: Landing Page

**Files:**
- Create: `components/landing/landing-header.tsx`, `hero-section.tsx`, `benefits-section.tsx`, `how-it-works-section.tsx`, `landing-footer.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Create all 5 landing page components**

Follow brand book Sections 6-7 exactly. Use Zeno Tailwind tokens (text-forest, bg-linen, font-display, etc.).

**Key implementation details:**

- `LandingHeader`: Fraunces wordmark "Zeno" + RO/EN toggle. No sticky.
- `HeroSection`: Fraunces 48px headline (mobile: 32px via `text-5xl md:text-6xl`). Primary button links to `/chat`. Trust badge text-only (Allianz SVG later).
- `BenefitsSection`: 3 cards in a row (`grid grid-cols-1 md:grid-cols-3`). Lucide icons: Shield, Globe, Check.
- `HowItWorksSection`: 3 numbered steps.
- `LandingFooter`: Night bg, Muted text.

All components use `useLanguage()` hook + `t()` for text.

- [ ] **Step 2: Replace app/page.tsx**

Replace current Zeno placeholder with full landing page composing all 5 components.

- [ ] **Step 3: Verify**

Run: `npm run dev` — check landing page renders at localhost.
Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add components/landing/ app/page.tsx
git commit -m "feat(b1): add landing page with hero, benefits, how-it-works, and footer"
```

---

## Task 3: Chat Components

**Files:**
- Create: all 9 components in `components/chat/`
- Modify: `app/globals.css` (add animations)

- [ ] **Step 1: Add animations to globals.css**

Add these keyframes and utilities (brand book Section 9):

```css
@keyframes message-appear {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes typing-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
```

Add `@media (prefers-reduced-motion: reduce)` that disables all animations.

- [ ] **Step 2: Create message-bubble.tsx**

Client component. Props: `role: 'user' | 'assistant'`, `content: string`, `isStreaming: boolean`.

- Agent: left-aligned, `bg-linen text-night`, rounded `rounded-2xl rounded-bl-sm`, max-w-[85%]
- User: right-aligned, `bg-forest text-soft-white`, rounded `rounded-2xl rounded-br-sm`, max-w-[85%]
- Padding: `px-4 py-3`
- Font: `text-[15px] leading-relaxed`
- Animation: `animate-[message-appear_200ms_ease]`
- Streaming: show blinking cursor at end of content

- [ ] **Step 3: Create typing-indicator.tsx**

Client component. Props: `statusMessage: string | null`.

- Default: 3 dots with staggered pulse animation (Linen bg, Forest dots)
- When statusMessage: crossfade (150ms) to text (Inter 13px, Muted color)
- Position: left-aligned, same indent as agent bubbles

- [ ] **Step 4: Create suggestion-pills.tsx**

Client component. Props: `suggestions: string[]`, `onSelect: (text: string) => void`, `disabled: boolean`.

- Horizontal flex with overflow-x-auto (scrollable on mobile)
- Each pill: `bg-soft-white border border-warm-border rounded-[20px] px-4 py-2 text-[13px]`
- Hover: `hover:bg-linen hover:border-sand`
- Click calls `onSelect(pill text)`
- Disabled state: opacity 50%

- [ ] **Step 5: Create chat-input.tsx**

Client component. Props: `onSend: (text: string) => void`, `disabled: boolean`, `placeholder: string`.

- Sticky bottom
- Input: full width, `bg-soft-white border border-warm-border rounded-[10px] px-4 py-3 text-[15px]`
- Send button: right side, Forest bg circle (40px), ArrowUp icon (Lucide, Linen color)
- Submit on Enter (not Shift+Enter), send button click
- Disabled during streaming (prevent double-send)
- Focus ring: `focus:ring-2 focus:ring-sage/10`

- [ ] **Step 6: Create chat-header.tsx**

Props: none (uses router for close navigation).

- Height: 48px
- Left: Zeno mark placeholder (Z in Forest, 24px circle) + "Zeno" text
- Right: X icon (Lucide), navigates to `/`
- Bottom border: `border-b border-warm-border`

- [ ] **Step 7: Create message-list.tsx**

Client component. Props: `messages: ChatMessage[]`, `isStreaming: boolean`, `typingStatus: string | null`.

- `ref` for scroll container
- Auto-scroll to bottom when near bottom (threshold 100px)
- When user scrolls up: disable auto-scroll
- Renders MessageBubble for each message
- Shows TypingIndicator at bottom when isStreaming

- [ ] **Step 8: Create scroll-to-bottom.tsx**

Shows floating pill when auto-scroll is disabled.
- Soft White bg, warm-border, rounded-[20px], ChevronDown icon + text
- Fade in 150ms
- Click → smooth scroll to bottom

- [ ] **Step 9: Create chat-skeleton.tsx and error-message.tsx**

Skeleton: 3 Linen rounded rectangles with opacity pulse.
Error: inline system message with AlertCircle icon, Error color text, Linen bg.

- [ ] **Step 10: Create chat-page.tsx**

The main client component composing everything:
- Props: `conversationId: string`, `customerId: string`, `initialMessages: ChatMessage[]`, `language: Language`
- Uses `useChat(conversationId, customerId)` hook
- Layout: flex column, full height
  - ChatHeader (fixed top)
  - MessageList (flex-grow, scroll)
  - SuggestionPills (above input)
  - ChatInput (fixed bottom)
- Mobile: 100dvh. Desktop: centered max-w-[640px].

- [ ] **Step 11: Verify**

Run: `npx tsc --noEmit`

- [ ] **Step 12: Commit**

```bash
git add components/chat/ app/globals.css
git commit -m "feat(b1): add all chat UI components with Zeno brand styling"
```

---

## Task 4: useChat Hook (SSE Consumer)

**Files:**
- Create: `lib/hooks/use-chat.ts`

- [ ] **Step 1: Create use-chat.ts**

**Read before implementing:**
- Spec Section 8 (full SSE consumer design)
- `app/api/chat/route.ts` — existing POST endpoint and SSE format
- `lib/chat/stream-handler.ts` — SSE event types emitted by the server

The hook manages all chat state and SSE streaming.

```typescript
'use client'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  isStreaming: boolean
  createdAt: Date
}

interface UIAction {
  type: string
  payload: Record<string, unknown>
}

interface UseChatReturn {
  messages: ChatMessage[]
  isStreaming: boolean
  toolStatus: { tool: string; message: string } | null
  error: string | null
  conversationId: string | null
  customerId: string | null
  sendMessage: (text: string) => void
  sendAction: (action: UIAction) => void
  suggestions: string[]
}

export function useChat(conversationId: string, customerId: string, initialMessages?: ChatMessage[]): UseChatReturn
```

**Implementation:**

`sendMessage(text)`:
1. Add optimistic user message to state (id: `user_${Date.now()}`, isStreaming: false)
2. Add empty assistant message (id: `assistant_${Date.now()}`, isStreaming: true)
3. `fetch('/api/chat', { method: 'POST', body: JSON.stringify({ conversationId, customerId, message: text }), headers: { 'Content-Type': 'application/json' } })`
4. Get reader: `response.body.getReader()`
5. Read chunks, decode with TextDecoder, parse SSE lines
6. For each SSE event:
   - `content`: append data.text to current assistant message content
   - `tool_start`: set toolStatus `{ tool: data.tool, message: data.statusMessage || '' }`
   - `tool_complete`: clear toolStatus
   - `ui_action`: store (for B2)
   - `error`: set error state, remove streaming assistant message
   - `done`: finalize assistant message (isStreaming=false), clear error

**SSE parsing:**
```typescript
// Buffer incomplete lines
// Split on \n\n for event blocks
// Parse: event: <type>\ndata: <json>
// Handle: data may span multiple lines (join with \n)
```

`sendAction(action)`: Same as sendMessage but POST body includes `action` field.

Expose `suggestions`: parse from done event metadata or set defaults based on conversation state (empty array for now, populated in B2).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-chat.ts
git commit -m "feat(b1): add useChat hook with SSE stream consumer"
```

---

## Task 5: Chat Routes + Session Flow

**Files:**
- Create: `app/chat/page.tsx`, `app/chat/[id]/page.tsx`

- [ ] **Step 1: Create /chat entry page**

`app/chat/page.tsx` — Server component that creates session + conversation, redirects.

```typescript
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'

export default async function ChatEntryPage() {
  const cookieStore = await cookies()
  let customerId = cookieStore.get('zeno_session')?.value

  // Get or create customer
  if (customerId) {
    const exists = await prisma.customer.findUnique({ where: { id: customerId } })
    if (!exists) customerId = undefined
  }

  if (!customerId) {
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    customerId = customer.id
    // Set cookie via response headers (handled by Next.js cookies API)
    cookieStore.set('zeno_session', customerId, {
      httpOnly: true, sameSite: 'lax', maxAge: 2592000, path: '/',
    })
  }

  // Create conversation
  const conversation = await prisma.conversation.create({
    data: { customerId, language: 'ro', channel: 'web' },
  })

  redirect(`/chat/${conversation.id}`)
}
```

- [ ] **Step 2: Create /chat/[id] page**

`app/chat/[id]/page.tsx` — Server component loads data, renders client ChatPage.

```typescript
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { cookies } from 'next/headers'
import ChatPage from '@/components/chat/chat-page'

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cookieStore = await cookies()
  const customerId = cookieStore.get('zeno_session')?.value

  // Load conversation with messages
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: 50 },
    },
  })

  if (!conversation) notFound()

  // Convert DB messages to ChatMessage format
  const initialMessages = conversation.messages.map(m => ({
    id: m.id,
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
    isStreaming: false,
    createdAt: m.createdAt,
  }))

  return (
    <ChatPage
      conversationId={conversation.id}
      customerId={customerId ?? conversation.customerId}
      initialMessages={initialMessages}
      language={(conversation.language as 'ro' | 'en') ?? 'ro'}
    />
  )
}
```

- [ ] **Step 3: Verify routes work**

Run: `npm run dev`
- Navigate to `/` → landing page
- Click CTA → `/chat` → redirects to `/chat/[id]`
- Chat page loads with empty conversation

- [ ] **Step 4: Commit**

```bash
git add app/chat/
git commit -m "feat(b1): add chat routes with session management and conversation loading"
```

---

## Task 6: Integration + Final Verification

- [ ] **Step 1: End-to-end test**

Manual test flow:
1. Open `http://localhost:3001` — landing page renders with Zeno branding
2. Click "Află în 3 minute" — redirects to `/chat/[id]`
3. Type a message and press Enter — message appears (optimistic)
4. If LLM API keys are set: response streams in with typing indicator
5. If no API keys: error message shows inline
6. Language toggle works (RO ↔ EN) on landing page
7. Refresh `/chat/[id]` — conversation resumes with existing messages
8. Mobile responsive: resize browser, chat goes full-screen

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All existing tests still pass (84 from Phase A).

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(b1): complete Slice B1 — landing page and conversation UI with SSE streaming"
```

---

## Notes for Implementer

1. **Brand book reference:** Read `zeno-brand-book.md` Sections 2 (colors), 3 (fonts), 6 (components), 7 (layouts), 8 (icons), 9 (animations), 10 (responsive), 11 (accessibility). The spec and brand book are the source of truth for all visual decisions.

2. **Tailwind tokens:** All brand colors are in `app/globals.css` as `@theme` variables. Use them via Tailwind: `text-forest`, `bg-linen`, `border-warm-border`, `text-muted`, `bg-soft-white`, `text-night`, `font-display` (Fraunces), `font-sans` (Inter).

3. **Lucide icons:** Already installed via shadcn. Import from `lucide-react`: `Shield`, `Globe`, `Check`, `X`, `ArrowUp`, `ChevronDown`, `AlertCircle`, `MessageCircle`.

4. **Client vs Server components:** Landing page components can be server components EXCEPT those using `useLanguage()` hook (they need `'use client'`). Chat components are all client components. Route pages are server components that pass data as props.

5. **SSE parsing:** The server emits `event: <type>\ndata: <json>\n\n`. Use `TextDecoder` to decode chunks. Buffer incomplete lines. Split on `\n\n` for complete events. Handle multi-line data fields.

6. **Cookie access:** In server components use `cookies()` from `next/headers`. In client components use `document.cookie`. The session API route sets HttpOnly cookies (not readable from JS — use the API).

7. **`100dvh` for mobile:** Use `h-dvh` in Tailwind (dynamic viewport height). Falls back to `100vh` in browsers without dvh support.

8. **No `use server` actions needed.** All mutations go through existing API routes (`POST /api/chat`, `POST /api/session`).

9. **Fonts:** Inter and Fraunces are already loaded in `app/layout.tsx` via `next/font/google`. Use via CSS variables `font-sans` (Inter) and `font-display` (Fraunces).

10. **Focus ring standard:** `focus:ring-[3px] focus:ring-sage/10` or `focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]` — opacity 0.1 everywhere per spec decision.
