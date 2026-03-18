# ZENO — Brand Book

## For UI development reference. Follow these guidelines for all customer-facing and admin interfaces.

---

## 1. Brand identity

### Name
**Zeno** — powered by Allianz-Țiriac

### Origin
Zeno of Citium — founder of Stoic philosophy. Calm, rational, prepared for anything. The philosophy of being ready for life's uncertainties without anxiety. This is what insurance should feel like.

### Positioning
Zeno is the warm, intelligent interface between people and the protection they need. Allianz-Țiriac provides the financial guarantee. Zeno provides the experience — a calm, knowledgeable conversation that makes insurance simple and human.

### Brand promise
"You talk to Zeno for 5 minutes. Zeno understands your life. You leave protected."

### Tagline options (use contextually)
- Primary: **"Pregătit pentru orice."** (Prepared for anything.)
- Product-specific: **"Acces la tratament de top. Oriunde în lume."** (Access to top treatment. Anywhere in the world.)
- Emotional: **"Liniștea că familia ta e protejată."** (Peace of mind that your family is protected.)
- Functional: **"Asigurare în 5 minute."** (Insurance in 5 minutes.)

### Co-branding with Allianz
The Allianz-Țiriac endorsement appears everywhere the Zeno brand appears. Format:

```
[Zeno logo]  powered by Allianz-Țiriac
```

Rules:
- "powered by Allianz-Țiriac" always appears in a smaller, lighter weight below or beside the Zeno wordmark
- On the landing page: Zeno logo in the header, Allianz-Țiriac badge in the trust indicators section
- In the chat interface: Zeno logo only in the header (keep it clean), Allianz mentioned in the agent's conversation naturally
- On policy documents: both logos at full size
- In ads: "Zeno — powered by Allianz-Țiriac" as a single lockup
- Never display "Zeno" without the Allianz association on any page where a purchase can happen

---

## 2. Color system

### Philosophy
No insurance blue. No corporate gray. Zeno uses deep, warm tones that feel like a trusted space — more like a premium wellness brand or an editorial publication than a traditional insurer. The palette is calm and grounded, reflecting Stoic composure.

### Primary palette

```
Deep Forest    #1A3A2F   — Primary brand color. Headers, buttons, key UI elements.
Sage           #2D6B52   — Secondary green. Hover states, active elements, accents.
Warm Sand      #D4A574   — Accent warm. Highlights, badges, premium indicators.
Linen          #F5EDE3   — Light warm background. Cards, surfaces, conversation bubbles (agent).
Soft White     #FAF8F5   — Page background. Slightly warm, never pure white.
Night          #1C1C1A   — Text color. Deep warm black, never pure #000.
```

### Extended palette

```
Success        #2D6B52   — Same as Sage. Confirmations, positive states.
Warning        #B8860B   — Dark goldenrod. Attention needed, not alarm.
Error          #8B2D2D   — Deep red. Errors, rejections. Never bright red.
Info           #2A5A7B   — Muted blue. Informational states, links.
Muted          #8A8680   — Gray-warm. Secondary text, placeholders, disabled states.
Border         #E5E0D8   — Warm border color for cards and inputs.
```

### Dark mode

```
Background     #141413   — Near-black warm
Surface        #1E1E1C   — Card backgrounds
Surface hover  #282826   — Elevated cards, hover states
Text primary   #E8E4DC   — Warm off-white
Text secondary #A09A90   — Muted warm
Border         #3A3835   — Subtle warm borders
Deep Forest    #3A7D5E   — Lightened for dark mode visibility
Sage           #5DCAA5   — Lightened for dark mode
Warm Sand      #D4A574   — Stays the same — accent pops in dark mode
```

### Usage rules
- The page background is always Soft White (#FAF8F5) in light mode, never pure white (#FFFFFF)
- Agent chat bubbles use Linen (#F5EDE3) background
- User chat bubbles use Deep Forest (#1A3A2F) background with white text
- Primary buttons use Deep Forest (#1A3A2F) background with Linen (#F5EDE3) text
- Secondary buttons use transparent background with Deep Forest border
- Never use gradients. Flat fills only.
- Never use shadows for decoration. Only for functional elevation (dropdowns, modals).
- The Warm Sand accent is used sparingly — recommended tier badge, selected state, premium indicators

---

## 3. Typography

### Font stack

```css
--font-primary: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

### Inter (sans-serif) — primary
Used for: all body text, UI elements, buttons, inputs, navigation, chat messages, product cards, forms, admin interface.

### Fraunces (serif) — display
Used for: the Zeno wordmark, landing page hero headline, taglines, emotional marketing copy. Never used for UI elements or body text. This font gives Zeno its editorial, premium feel.

### Font sizes and weights

```
Hero headline:     Fraunces 48px weight 500 (landing page only)
Page title:        Inter 28px weight 500
Section heading:   Inter 22px weight 500
Subsection:        Inter 18px weight 500
Body:              Inter 16px weight 400, line-height 1.6
Body small:        Inter 14px weight 400
Caption:           Inter 12px weight 400
Label:             Inter 13px weight 500
Button:            Inter 15px weight 500
Chat message:      Inter 15px weight 400, line-height 1.5
Price display:     Inter 28px weight 500 (in product cards)
Price small:       Inter 14px weight 400 (per month label)
```

### Rules
- Two weights only: 400 (regular) and 500 (medium). Never use 600, 700, or bold.
- Never use ALL CAPS except for very short labels (2-3 words max, e.g., "RECOMANDAT" badge)
- Headings and body use sentence case always
- Line height for body text is 1.6. For chat messages 1.5. For headings 1.2.
- Maximum content width: 640px for text-heavy pages (landing, dashboard). Chat panel also 640px max.

---

## 4. Brand voice

### Personality
Zeno speaks like a calm, knowledgeable friend who happens to understand insurance perfectly. Not a salesperson. Not a chatbot. Not a corporation. Think: the friend who's a doctor — they give you real answers, not corporate disclaimers.

### Voice attributes

**Calm, not cold.** Zeno never rushes, never pressures, never uses urgency tactics. But it's warm — it cares about the person, not the sale.

**Clear, not simple.** Zeno explains complex things in plain language but doesn't dumb things down. It respects the customer's intelligence.

**Honest, not blunt.** Zeno will tell you if something isn't covered. It won't hide exclusions. But it delivers honesty with care, not with clinical detachment.

**Confident, not arrogant.** Zeno knows the product inside out. It doesn't hedge with "I think" or "maybe." But it also says "I don't know" when that's the truth.

### Language rules

**Romanian first.** All customer-facing copy is Romanian by default. English as secondary language.

**Zero jargon.** Never use: "prima de asigurare" (say "costul lunar" or "plata lunară"), "suma asigurată" (say "ce primești" or "cât ești acoperit"), "beneficiar" (say "cine primește banii"), "excluderi" (say "ce nu este acoperit").

**One idea per message.** In the chat agent, each message should make one point clearly. Never stack three ideas in one bubble.

**Lead with the human situation, not the product.** "Ai un credit la bancă și doi copii." comes before "Protecția de viață Allianz..."

**Price in lei, monthly.** Always show "45 lei/lună" not "540 RON/an". Compare to familiar things: "cât o pizza", "cât un Netflix", "mai puțin de 2 lei pe zi."

### Forbidden phrases
- "Oferta noastră" (our offer) — sounds salesy
- "Nu ratați" (don't miss out) — urgency tactic
- "Cel mai bun preț" (best price) — unverifiable claim
- "Fără griji" (without worries) — dismissive
- "Asigurare inteligentă" or "AI-powered" — nobody cares about the tech
- "Click aici" (click here) — archaic CTA

### Sample copy by context

**Landing page hero:**
```
Dacă mâine primești un diagnostic grav,
ai fi pregătit?

Acces la tratament în cele mai bune clinici din lume.
De la 45 lei pe lună. Asigurare Allianz-Țiriac.

[Află în 3 minute]
```

**Agent opening message:**
```
Bună! Sunt Zeno. Te pot ajuta să înțelegi ce opțiuni 
de protecție ai — durează cam 5 minute și nu te 
obligă la nimic. Spune-mi puțin despre tine.
```

**Product recommendation:**
```
Pentru situația ta, îți recomand pachetul Standard 
Nivelul II cu protecție medicală internațională. 

Ce înseamnă concret: dacă primești un diagnostic 
de cancer sau altă boală gravă, ai acces la tratament 
în clinici de top din Germania, Austria, Turcia — 
oriunde, cu acoperire de până la 2 milioane euro.

Costul: 53 lei pe lună. Cam cât un abonament Netflix.
```

**After BD questionnaire rejection:**
```
Înțeleg. Din cauza răspunsurilor, nu putem activa 
componenta de tratament medical internațional. Dar 
protecția de viață rămâne disponibilă și îți oferă 
acoperire pentru familie. Vrei să continuăm cu ea?
```

---

## 5. Logo

### Wordmark
The Zeno wordmark uses Fraunces at weight 500. It is the primary logo element.

```
Zeno
```

Wordmark specs:
- Font: Fraunces, weight 500
- Color: Deep Forest (#1A3A2F) on light backgrounds, Soft White (#FAF8F5) on dark
- Letter spacing: -0.5px (slightly tight)
- Minimum size: 18px font size
- Clear space: at least 1x the height of the "Z" on all sides

### Mark (optional icon)
A simple geometric mark for favicon, app icon, small spaces:
- A circle with a subtle "Z" formed by negative space or a single continuous line
- Deep Forest (#1A3A2F) on light, Soft White on dark
- Minimum size: 24x24px
- Used for: favicon, mobile app icon, chat avatar, loading states

### Co-branded lockup
```
[Zeno wordmark]
powered by Allianz-Țiriac [Allianz logo]
```

- "powered by" in Inter 11px weight 400, color Muted (#8A8680)
- "Allianz-Țiriac" in Inter 11px weight 500, color Night (#1C1C1A)
- Allianz logo (their official eagle mark) at same height as the text
- Vertical gap between Zeno wordmark and the "powered by" line: 4px

---

## 6. UI components

### Buttons

**Primary button**
```css
background: #1A3A2F;
color: #F5EDE3;
font: Inter 15px weight 500;
padding: 12px 24px;
border-radius: 10px;
border: none;
transition: background 0.2s;
/* hover: #2D6B52 */
/* active: scale(0.98) */
```

**Secondary button**
```css
background: transparent;
color: #1A3A2F;
font: Inter 15px weight 500;
padding: 12px 24px;
border-radius: 10px;
border: 1px solid #E5E0D8;
/* hover: background #F5EDE3 */
```

**Text button / link**
```css
color: #2D6B52;
font: Inter 15px weight 500;
text-decoration: none;
/* hover: text-decoration underline */
```

### Cards

**Product tier card**
```css
background: #FAF8F5;
border: 1px solid #E5E0D8;
border-radius: 12px;
padding: 20px;
/* selected: border-color #1A3A2F, border-width 2px */
/* recommended: small badge top-right with Warm Sand background */
```

**Chat bubbles**
```css
/* Agent */
background: #F5EDE3;
color: #1C1C1A;
border-radius: 16px 16px 16px 4px;
padding: 12px 16px;
max-width: 85%;
font: Inter 15px/1.5;

/* User */
background: #1A3A2F;
color: #FAF8F5;
border-radius: 16px 16px 4px 16px;
padding: 12px 16px;
max-width: 85%;
font: Inter 15px/1.5;
```

**Suggestion pills (auto-complete options above chat input)**
```css
background: #FAF8F5;
border: 1px solid #E5E0D8;
border-radius: 20px;
padding: 8px 16px;
font: Inter 13px weight 400;
color: #1C1C1A;
/* hover: background #F5EDE3, border-color #D4A574 */
```

### Inputs

```css
background: #FAF8F5;
border: 1px solid #E5E0D8;
border-radius: 10px;
padding: 12px 16px;
font: Inter 15px;
color: #1C1C1A;
/* focus: border-color #2D6B52, box-shadow 0 0 0 3px rgba(45,107,82,0.1) */
/* error: border-color #8B2D2D */
/* placeholder color: #8A8680 */
```

### Badges

**Recommended tier badge**
```css
background: #D4A574;
color: #1C1C1A;
font: Inter 11px weight 500;
padding: 4px 10px;
border-radius: 6px;
text-transform: uppercase;
letter-spacing: 0.5px;
```

**Status badges**
```css
/* Active */    background: #E8F5E9; color: #2D6B52;
/* Pending */   background: #FFF8E1; color: #B8860B;
/* Expired */   background: #FBE9E7; color: #8B2D2D;
```

### Spacing system

```
4px   — minimal (between related micro-elements)
8px   — tight (inside components, between icon and label)
12px  — default (between list items, card internal gaps)
16px  — comfortable (between sections within a card)
24px  — spacious (between cards, between sections)
32px  — section break (between major page sections)
48px  — page section (landing page section spacing)
64px  — hero spacing (landing page hero to first section)
```

### Border radius

```
6px   — small elements (badges, pills, small buttons)
10px  — inputs, regular buttons
12px  — cards, product tiles
16px  — chat bubbles
20px  — large cards, modal windows
```

---

## 7. Page layouts

### Landing page

```
┌─────────────────────────────────────┐
│ [Zeno logo]              [Limba: RO]│  ← Minimal header
├─────────────────────────────────────┤
│                                     │
│   Dacă mâine primești un            │  ← Fraunces 48px
│   diagnostic grav, ai fi pregătit?  │
│                                     │
│   Acces la tratament în cele mai    │  ← Inter 18px, Muted
│   bune clinici din lume.            │
│   De la 45 lei pe lună.            │
│                                     │
│   [  Află în 3 minute  ]           │  ← Primary button, centered
│                                     │
│   Produs Allianz-Țiriac [logo]     │  ← Trust badge
│                                     │
├─────────────────────────────────────┤
│                                     │
│   ┌──────┐ ┌──────┐ ┌──────┐      │  ← 3 benefit cards
│   │ Fără │ │Tratat│ │Activ │      │
│   │examen│ │global│ │azi   │      │
│   │medical│ │      │ │      │      │
│   └──────┘ └──────┘ └──────┘      │
│                                     │
├─────────────────────────────────────┤
│   Cum funcționează?                 │  ← 3 steps, simple
│   1. Vorbești cu Zeno (5 min)      │
│   2. Alegi protecția potrivită     │
│   3. Ești protejat din acel moment │
│                                     │
├─────────────────────────────────────┤
│   Footer: legal, ASF, contact,     │
│   powered by Allianz-Țiriac        │
└─────────────────────────────────────┘
```

### Conversation interface

```
┌─────────────────────────────────────┐
│ [Z] Zeno                      [✕]  │  ← Minimal header, max 48px tall
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────┐           │  ← Agent bubble (left, Linen bg)
│  │ Bună! Sunt Zeno...  │           │
│  └─────────────────────┘           │
│                                     │
│           ┌─────────────────────┐  │  ← User bubble (right, Deep Forest bg)
│           │ Am 34 de ani...     │  │
│           └─────────────────────┘  │
│                                     │
│  ┌─────────────────────┐           │
│  │ [Product card]       │           │  ← Inline product cards
│  │ Standard II          │           │
│  │ 53 lei/lună          │           │
│  │ ☐ Selectează         │           │
│  └─────────────────────┘           │
│                                     │
│  ┌─ Da ─┐ ┌─ Nu ─┐ ┌─ Mai mult ─┐│  ← Suggestion pills
├─────────────────────────────────────┤
│  [ Scrie un mesaj...          ↑ ]  │  ← Input bar
└─────────────────────────────────────┘

Mobile: full screen, edge to edge
Desktop: centered, max-width 640px, with Soft White page background visible on sides
```

### Product tier cards (inline in chat)

```
┌─────────────────────────────────┐
│                    [RECOMANDAT] │  ← Warm Sand badge (only on recommended)
│  Standard Nivelul II            │  ← Inter 16px weight 500
│  Viață + Tratament Medical      │  ← Inter 13px, Muted
│                                 │
│  53 lei/lună                    │  ← Inter 28px weight 500
│  640 RON/an                     │  ← Inter 12px, Muted
│                                 │
│  ✓ Deces orice cauză: 40.000 lei│  ← Inter 13px
│  ✓ Tratament global: 2M EUR    │
│  ✓ Medicamente: 50.000 EUR     │
│  ✓ Spitalizare: 100 EUR/zi     │
│                                 │
│  [ Alege acest plan ]           │  ← Primary button
└─────────────────────────────────┘
```

### Post-purchase dashboard

```
┌─────────────────────────────────────┐
│ [Z] Zeno           [Cont] [Ieșire] │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐   │
│  │  Polița ta                  │   │  ← Hero card, Deep Forest bg
│  │  Standard Nivelul II + BD   │   │
│  │  [ACTIVĂ]                   │   │
│  │                             │   │
│  │  Acoperire totală:          │   │
│  │  2.040.000 EUR              │   │
│  │                             │   │
│  │  Următoarea plată: 53 lei   │   │
│  │  Data: 15 aprilie           │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────┐ ┌──────────┐ ┌────┐  │  ← Quick actions
│  │Vorbește │ │Descarcă  │ │Reco│  │
│  │cu Zeno  │ │polița    │ │man-│  │
│  │         │ │          │ │dă  │  │
│  └─────────┘ └──────────┘ └────┘  │
│                                     │
│  Documente                         │
│  ├ Poliță PDF                      │
│  ├ Raport suitabilitate (DNT)      │
│  └ Chitanță plată                  │
│                                     │
└─────────────────────────────────────┘
```

---

## 8. Iconography

### Style
- Line icons only, 1.5px stroke weight
- Rounded line caps and joins
- 24x24px default size, 16x16px for inline/small contexts
- Color: inherits from text color (Night or Muted)
- Source: Lucide icons (https://lucide.dev) — consistent with shadcn/ui

### Key icons

```
Shield          — coverage, protection (use for product features)
Heart           — health, medical (use for BD addon)
Globe           — international treatment (use for treatment abroad)
MessageCircle   — conversation, chat (use for "talk to Zeno")
FileText        — documents, policy PDF
Users           — family, beneficiaries
CreditCard      — payment
Check           — completed, confirmed
Clock           — pending, processing
AlertCircle     — attention needed
ChevronRight    — navigation, next step
Download        — download document
Share2          — referral, share
```

### Rules
- Never use filled/solid icons. Always outlined/line style.
- Never use emoji in the UI. Icons only.
- Never use decorative icons. Every icon should communicate function.
- Icon + text label together in buttons. Never icon-only buttons except close (✕) and back (←).

---

## 9. Motion and animation

### Philosophy
Zeno is calm. Animations are subtle and purposeful. Nothing bounces, flashes, or demands attention.

### Transitions
```css
--transition-fast: 150ms ease;    /* hover states, focus rings */
--transition-normal: 200ms ease;  /* card reveals, button states */
--transition-slow: 300ms ease;    /* page transitions, modals */
```

### Chat-specific animations
- **Message appear:** fade in + slide up 8px, 200ms ease. Agent messages from left, user from right.
- **Typing indicator:** three dots with a gentle pulse (opacity 0.4 to 1.0, staggered 150ms between dots). Use Deep Forest color dots on Linen background.
- **Product cards:** fade in + slide up 12px, 300ms ease, staggered 100ms between cards.
- **Suggestion pills:** fade in, 150ms, all at once (no stagger).
- **Streaming text:** no animation per character. Text appears in chunks as tokens arrive. The bubble grows smoothly to accommodate new text.

### Celebration (policy issued)
- Subtle confetti: small circles in Warm Sand and Sage, floating down, 2 seconds, then fade out. Not aggressive. Think gentle, not party.
- Policy card slides up from bottom with a slight spring (300ms).

### Rules
- Never use `animation-iteration-count: infinite` except for the typing indicator
- All animations respect `prefers-reduced-motion: reduce`
- No loading spinners. Use skeleton placeholders (Linen colored blocks that pulse gently).
- Page transitions: simple fade, 200ms. No slides or complex transitions.

---

## 10. Responsive behavior

### Breakpoints
```
Mobile:     < 640px   — full-width everything, edge-to-edge chat
Tablet:     640-1024px — centered content, max-width 640px
Desktop:    > 1024px  — centered content, max-width 640px for chat/content
                        max-width 1080px for admin dashboard
```

### Mobile-first rules
- The conversation interface is the primary product. It must be perfect on mobile.
- Chat takes 100% width on mobile, no side padding on bubbles container
- Input bar sticks to bottom, above keyboard on mobile
- Product cards stack vertically on mobile (never side by side)
- Landing page: single column always. No multi-column layouts.
- Dashboard: single column on mobile, 2-column grid on tablet+
- Admin: designed for tablet+ (1024px minimum). Mobile admin is read-only.

---

## 11. Accessibility

- All text meets WCAG 2.1 AA contrast ratios (4.5:1 for body text, 3:1 for large text)
- Focus rings visible on all interactive elements (3px Sage with 0.2 opacity spread)
- All images have alt text
- Chat messages are screen-reader accessible with proper ARIA roles
- Product cards are keyboard-navigable (tab between cards, enter to select)
- Color is never the only indicator of state (always paired with icon or text)
- Touch targets minimum 44x44px on mobile
- Form inputs have visible labels (not just placeholders)

---

## 12. File naming and asset conventions

```
/public/
  /brand/
    zeno-wordmark-dark.svg        — Dark text, for light backgrounds
    zeno-wordmark-light.svg       — Light text, for dark backgrounds
    zeno-mark-dark.svg            — Icon mark, dark
    zeno-mark-light.svg           — Icon mark, light
    zeno-lockup-allianz-dark.svg  — Full co-branded lockup, dark
    zeno-lockup-allianz-light.svg — Full co-branded lockup, light
    allianz-tiriac-badge.svg      — Allianz-Țiriac trust badge
    og-image.png                  — Social sharing image (1200x630)
    favicon.svg                   — Favicon using the mark
```

---

## 13. CSS variables (copy into your global stylesheet)

```css
:root {
  /* Colors - Light mode */
  --color-forest: #1A3A2F;
  --color-sage: #2D6B52;
  --color-sand: #D4A574;
  --color-linen: #F5EDE3;
  --color-soft-white: #FAF8F5;
  --color-night: #1C1C1A;
  --color-muted: #8A8680;
  --color-border: #E5E0D8;
  --color-success: #2D6B52;
  --color-warning: #B8860B;
  --color-error: #8B2D2D;
  --color-info: #2A5A7B;
  
  /* Typography */
  --font-primary: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  
  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  
  /* Radius */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 12px;
  --radius-bubble: 16px;
  --radius-xl: 20px;
  
  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 200ms ease;
  --transition-slow: 300ms ease;
  
  /* Shadows (functional only) */
  --shadow-sm: 0 1px 2px rgba(28, 28, 26, 0.05);
  --shadow-md: 0 4px 12px rgba(28, 28, 26, 0.08);
  --shadow-lg: 0 8px 24px rgba(28, 28, 26, 0.12);
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-forest: #3A7D5E;
    --color-sage: #5DCAA5;
    --color-sand: #D4A574;
    --color-linen: #282826;
    --color-soft-white: #141413;
    --color-night: #E8E4DC;
    --color-muted: #A09A90;
    --color-border: #3A3835;
    --color-success: #5DCAA5;
    --color-warning: #D4A574;
    --color-error: #E07070;
    --color-info: #6AADDB;
  }
}
```

---

## 14. Tailwind configuration

```javascript
// tailwind.config.js — extend with Zeno brand tokens
module.exports = {
  theme: {
    extend: {
      colors: {
        forest: '#1A3A2F',
        sage: '#2D6B52',
        sand: '#D4A574',
        linen: '#F5EDE3',
        'soft-white': '#FAF8F5',
        night: '#1C1C1A',
        muted: '#8A8680',
        'warm-border': '#E5E0D8',
      },
      fontFamily: {
        sans: ['Inter', ...defaultTheme.fontFamily.sans],
        display: ['Fraunces', ...defaultTheme.fontFamily.serif],
        mono: ['JetBrains Mono', ...defaultTheme.fontFamily.mono],
      },
      borderRadius: {
        'bubble': '16px',
      },
    },
  },
}
```

---

## 15. Do's and don'ts

### Do
- Use Fraunces for the wordmark and hero headlines only
- Lead every page with the human benefit, not the product feature
- Show prices in lei/month with familiar comparisons
- Include the Allianz-Țiriac endorsement on every purchase-path page
- Use Linen backgrounds for agent content, Deep Forest for user content
- Keep the chat interface clean — minimal chrome, maximum conversation
- Use skeleton loading states, never spinners
- Test all UI in both Romanian and English

### Don't
- Don't use Fraunces for body text, buttons, or UI elements
- Don't use pure white (#FFFFFF) or pure black (#000000) anywhere
- Don't use gradients, glows, or decorative shadows
- Don't use stock photos of happy families — use illustration or nothing
- Don't put the Allianz logo bigger than the Zeno wordmark
- Don't create multi-step forms — everything happens inside the conversation
- Don't use blue as a primary color — that's every other insurance company
- Don't animate aggressively — Zeno is calm, every transition is subtle
- Don't use "AI" or "inteligent" in customer-facing copy — the experience speaks for itself
