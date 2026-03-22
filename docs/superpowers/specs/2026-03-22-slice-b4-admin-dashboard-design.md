# Slice B4: Admin Panel + Customer Dashboard — Design Spec

**Project:** Zeno — AI Life Insurance Sales Agent V2
**Slice:** B4 (Auth/RBAC, Admin Panel, Customer Dashboard)
**Date:** 2026-03-22
**Status:** Approved
**Depends on:** Slice B3 (Payment + Checkout) — complete

---

## 1. Goal

Build proper auth with RBAC (CUSTOMER/ADMIN/OPERATOR), an admin panel for managing applications and agent configs, and a customer dashboard for post-purchase policy viewing. This completes Phase B.

## 2. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth | Custom RBAC, no Supabase | Build properly from the start. Supabase removed from plan entirely. |
| Sessions | JWT via HttpOnly cookies (jose) | Edge-compatible, no session store needed. |
| Password hashing | bcryptjs | Pure JS, works in Edge runtime. |
| Customer auth | Magic link (email → token → JWT session) | Low friction. Already partially built in B3. |
| Admin/Operator auth | Email + password | Simple, appropriate for internal users. |
| Admin layout | Table-based, 1080px max-width | Functional, not marketing. Same brand colors. |

## 3. Schema Changes

**New User model:**
```prisma
model User {
  id             String    @id @default(cuid())
  email          String    @unique
  passwordHash   String?               // null for customers (magic link only)
  role           UserRole  @default(CUSTOMER)
  customerId     String?   @unique     // links to Customer for CUSTOMER role
  isActive       Boolean   @default(true)
  lastLoginAt    DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  customer       Customer? @relation(fields: [customerId], references: [id])
}
```

**Customer model — add reverse relation:**
```prisma
user User?    // reverse relation from User.customerId
```

The `UserRole` enum already exists: `CUSTOMER`, `ADMIN`, `OPERATOR`.

**Seed: admin user**
Create a default admin user in seeds:
```typescript
// seed-users.ts
email: process.env.ADMIN_EMAIL || 'admin@zeno.ro'
password: process.env.ADMIN_PASSWORD || 'admin123' (hashed with bcryptjs)
role: ADMIN
```

## 4. File Structure

```
middleware.ts                  — Next.js middleware at PROJECT ROOT: route protection by role

lib/auth/
  jwt.ts                    — sign/verify JWT with jose
  passwords.ts              — hash/verify with bcryptjs
  middleware.ts              — role-checking helpers (NOT the Next.js middleware file)
  types.ts                  — AuthUser, JWTPayload types

app/
  api/auth/
    login/route.ts           — POST: email+password → JWT cookie (admin/operator)
    magic-link/route.ts      — POST: email → send magic link (customer)
    verify/route.ts          — GET: ?token=... → create session → redirect
    logout/route.ts          — POST: clear cookie
    me/route.ts              — GET: current user from JWT

  admin/
    layout.tsx               — Admin shell: sidebar nav, header with user info
    page.tsx                 — Dashboard: counts + recent activity
    login/page.tsx           — Admin login form
    applications/
      page.tsx               — Applications list with filters
      [id]/page.tsx          — Application detail + Allianz email generation
    policies/
      page.tsx               — Policies list: status management
    conversations/
      page.tsx               — Conversation browser (ADMIN only)
      [id]/page.tsx          — Single conversation with messages + traces
    agents/
      page.tsx               — Agent model configuration
    users/
      page.tsx               — Operator account management (ADMIN only)

  dashboard/
    layout.tsx               — Customer shell: header with Zeno + logout
    page.tsx                 — Policy card + quick actions + documents
    documents/page.tsx       — Document list (placeholders)
    login/page.tsx           — Magic link request form

components/
  admin/
    admin-sidebar.tsx        — Navigation sidebar
    admin-header.tsx         — Top bar with user name + role
    application-table.tsx    — Applications data table
    policy-table.tsx         — Policies data table
    agent-config-row.tsx     — Single agent config with dropdowns
    allianz-email-generator.tsx — Pre-filled email template
    conversation-viewer.tsx  — Message list viewer for admin

  dashboard/
    policy-hero-card.tsx     — Policy status card (from brand book)
    quick-actions.tsx        — Action buttons row
    document-list.tsx        — Document links
```

## 5. Auth System

### 5.1 JWT (`lib/auth/jwt.ts`)

```typescript
import { SignJWT, jwtVerify } from 'jose'

interface JWTPayload {
  userId: string
  role: 'CUSTOMER' | 'ADMIN' | 'OPERATOR'
  email: string
}

async function signToken(payload: JWTPayload, expiresIn: string): Promise<string>
async function verifyToken(token: string): Promise<JWTPayload | null>
```

Secret: `process.env.JWT_SECRET` (random 256-bit string in env).
Algorithm: HS256.
Expiry: '7d' for CUSTOMER, '24h' for ADMIN/OPERATOR.

**Cookie attributes (mandatory):**
- Name: `zeno_auth`
- HttpOnly: true
- SameSite: Lax (CSRF protection)
- Secure: true in production (`process.env.NODE_ENV === 'production'`)
- Path: /

### 5.2 Passwords (`lib/auth/passwords.ts`)

```typescript
import bcrypt from 'bcryptjs'

async function hashPassword(password: string): Promise<string>  // 12 rounds
async function verifyPassword(password: string, hash: string): Promise<boolean>
```

### 5.3 Auth types (`lib/auth/types.ts`)

```typescript
interface AuthUser {
  userId: string
  role: 'CUSTOMER' | 'ADMIN' | 'OPERATOR'
  email: string
  customerId?: string
}
```

### 5.4 Middleware helpers (`lib/auth/middleware.ts`)

```typescript
// Extract auth user from request cookies
async function getAuthUser(request: NextRequest): Promise<AuthUser | null>

// Check if user has required role
function hasRole(user: AuthUser, requiredRoles: string[]): boolean

// Verify user is still active in DB (for admin/operator roles)
// Called by middleware on every protected request for ADMIN/OPERATOR
// Adds one DB query but prevents deactivated users from using active tokens
async function verifyUserActive(userId: string): Promise<boolean>
```

### 5.5 Next.js Middleware (`middleware.ts` at PROJECT ROOT)

Route protection rules:
```typescript
const PROTECTED_ROUTES = [
  { pattern: '/admin/login', roles: [] },          // public
  { pattern: '/admin/*', roles: ['ADMIN', 'OPERATOR'] },
  { pattern: '/dashboard/login', roles: [] },      // public
  { pattern: '/dashboard/*', roles: ['CUSTOMER'] },
  { pattern: '/api/admin/*', roles: ['ADMIN', 'OPERATOR'] },
]
```

If user not authenticated → redirect to login page.
If user authenticated but wrong role → redirect to appropriate area.

Cookie name: `zeno_auth`.

## 6. Auth API Endpoints

### `POST /api/auth/login`
Body: `{ email, password }`
1. Find User by email (must be ADMIN or OPERATOR, isActive=true)
2. Verify password
3. Update lastLoginAt
4. Sign JWT (24h expiry)
5. Set `zeno_auth` cookie
6. Return `{ user: { id, email, role } }`

### `POST /api/auth/magic-link`
Body: `{ email }`
1. Find Customer by email
2. Generate token: `crypto.randomUUID()`
3. Find or create User (role: CUSTOMER, customerId linked)
4. Update Customer.magicLinkToken + expiresAt (30 minutes — short-lived for security. The JWT session after verification lasts 7 days.)
5. Send magic link email: `${APP_URL}/api/auth/verify?token=${token}`
6. Return `{ sent: true }`

### `GET /api/auth/verify?token=...`
1. Find Customer by magicLinkToken (using @unique index)
2. Check not expired
3. Find or create User linked to this Customer
4. Sign JWT (7 day expiry)
5. Set `zeno_auth` cookie
6. Clear magicLinkToken (one-time use)
7. Redirect to `/dashboard`

### `POST /api/auth/logout`
1. Clear `zeno_auth` cookie
2. Return `{ success: true }`

### `GET /api/auth/me`
1. Extract JWT from cookie
2. Return user info or 401

## 7. Admin Panel

### 7.1 Admin Layout (`app/admin/layout.tsx`)

Server component. Checks auth (redirect to `/admin/login` if not authenticated).

Sidebar navigation:
- Dashboard (home icon)
- Applications (FileText icon)
- Policies (Shield icon)
- Conversations (MessageCircle icon) — ADMIN only
- Agent Config (Settings icon) — ADMIN only
- Users (Users icon) — ADMIN only

Header: "Zeno Admin" + user email + role badge + logout button.

Max-width: 1080px. Background: Soft White. Same Zeno color tokens.

### 7.2 Admin Dashboard (`app/admin/page.tsx`)

Summary cards:
- New applications (OPEN) — count
- Pending policies (PENDING_SUBMISSION + SUBMITTED) — count
- Active policies — count
- Conversations today — count

Recent activity list: latest 10 applications with status.

### 7.3 Applications Page (`app/admin/applications/page.tsx`)

Table columns: Customer Name, Product, Tier/Level, Status, Date, Actions.
Filters: status dropdown (OPEN, PAUSED, COMPLETED, all).
Click row → detail page.

### 7.4 Application Detail (`app/admin/applications/[id]/page.tsx`)

Full customer data display:
- Customer: name, email, phone, CNP (masked: ****-****-*****), DOB, address
- Application: tier, level, addon, status, flags
- Answers: all questionnaire answers grouped by section
- Quote: premium breakdown
- Policy: status, Allianz number (if entered)

**Actions:**
- "Generate Allianz Email" → opens a pre-filled email template in a modal/panel:
  ```
  Subject: Cerere de emitere polita Protect - [Customer Name]
  To: [Allianz contact email]

  Stimate partener,

  Va rugam sa emiteti polita de asigurare cu urmatoarele date:

  Asigurat: [Name]
  CNP: [CNP]
  Data nasterii: [DOB]
  Adresa: [Address]
  Email: [Email]
  Telefon: [Phone]

  Produs: Protect [Tier] [Level]
  Addon BD: [Da/Nu]
  Prima anuala: [Amount] RON
  Frecventa plata: [Annual/Semi/Quarterly]

  Plata primei prime a fost efectuata.

  Cu stima,
  Echipa Zeno
  ```
  Copy-to-clipboard button.

- "Mark as Submitted" → Policy.status = SUBMITTED
- "Activate Policy" → modal: enter Allianz policy number → Policy.status = ACTIVE, allianzPolicyNumber set → triggers email to customer ("Polita ta a fost activata")

### 7.5 Policies Page (`app/admin/policies/page.tsx`)

Table: Customer, Product, Status, Allianz Number, Premium, Date.
Status filter. Inline status update for quick workflow.

### 7.6 Agent Config (`app/admin/agents/page.tsx`)

ADMIN only. One card per agent:
- Agent name + slug + type (read-only label: MAIN_CHAT, REASONING_GATE, etc.)
- Provider: dropdown (OPENAI, ANTHROPIC) — populated from LLMProvider enum
- Model: dropdown — populated from ModelCatalog where provider matches
- Fallback Provider + Model: same dropdowns
- Temperature: range slider 0.0-1.0 (step 0.1)
- Max Tokens: number input
- isActive: toggle
- "Save" button per agent
- "Flush Cache" button → calls `flushAgentConfigCache()`

When provider dropdown changes → model dropdown filters to that provider's models.

### 7.7 Conversation Browser (`app/admin/conversations/page.tsx`)

ADMIN only. Table: Customer, Status, Messages Count, Last Activity, Duration.
Click → detail page showing full message history + turn traces (phases, tokens, cost, latency, sections included).

### 7.8 User Management (`app/admin/users/page.tsx`)

ADMIN only. Table: Email, Role, Active, Last Login.
"Create Operator" button → modal: email + password → creates User with OPERATOR role.
Toggle active/inactive.

## 8. Customer Dashboard

### 8.1 Dashboard Layout (`app/dashboard/layout.tsx`)

Server component. Checks CUSTOMER auth (redirect to `/dashboard/login` if not).
Header: Zeno wordmark + "Contul meu" + logout button.
Max-width 640px centered (matches chat width).

### 8.2 Dashboard Page (`app/dashboard/page.tsx`)

Load customer's policies (most recent first).

**Policy hero card** (from brand book Section 7):
- Tier + Level + addon status
- Status badge: PENDING_SUBMISSION (warning), SUBMITTED (warning), ACTIVE (success)
- Total coverage amount
- Next payment date + amount
- Card: `bg-forest text-soft-white rounded-xl p-6` (dark card per brand book wireframe)

**Quick actions:**
- "Vorbeste cu Zeno" → navigates to `/chat`
- "Descarca polita" → placeholder ("Disponibil dupa activare" for non-ACTIVE)
- "Recomanda un prieten" → placeholder ("In curand")

**Documents section:**
- Policy PDF → placeholder
- DNT suitability report → placeholder
- Payment receipt → placeholder
- All show "Documentul va fi disponibil dupa activarea politei" for non-ACTIVE policies

### 8.3 Magic Link Login (`app/dashboard/login/page.tsx`)

Simple form: email input + "Trimite link de acces" button.
On submit: POST to `/api/auth/magic-link`.
Success: "Verifica email-ul. Am trimis un link de acces."

## 9. Admin API Endpoints

Server actions or API routes for admin operations:

```
PATCH /api/admin/policies/[id]/status    — Update policy status + optional allianzPolicyNumber
PATCH /api/admin/agents/[id]             — Update agent config
POST /api/admin/agents/flush-cache       — Flush agent config cache
POST /api/admin/users                    — Create operator user
PATCH /api/admin/users/[id]              — Toggle active status
GET  /api/admin/stats                    — Dashboard counts
```

All protected by admin middleware.

## 10. New Dependencies

```bash
npm install jose bcryptjs
npm install -D @types/bcryptjs
```

## 11. Environment Variables

Add:
```
JWT_SECRET=your-random-256-bit-secret-here
ADMIN_EMAIL=admin@zeno.ro
ADMIN_PASSWORD=change-this-in-production
```

## 12. Exit Criteria

**Auth:**
- [ ] User model with RBAC (CUSTOMER, ADMIN, OPERATOR)
- [ ] JWT sessions via jose (HttpOnly cookie)
- [ ] Magic link auth for customers
- [ ] Password auth for admin/operator
- [ ] Middleware protects /admin/* and /dashboard/* routes
- [ ] Auth endpoints: login, magic-link, verify, logout, me
- [ ] Default admin user seeded

**Admin panel:**
- [ ] Login page
- [ ] Dashboard with summary counts
- [ ] Applications list + detail + Allianz email generator
- [ ] Policy management (status update, Allianz number entry, activation)
- [ ] Agent config (provider/model dropdowns, temperature, flush cache)
- [ ] User management (create operator, toggle active)
- [ ] Conversation browser (ADMIN only)

**Customer dashboard:**
- [ ] Magic link login page
- [ ] Policy hero card with status badge
- [ ] Quick actions (chat link, download placeholder, referral placeholder)
- [ ] Documents list (placeholders)

**Build:**
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds

## 13. What B4 does NOT include

- Policy PDF generation (Phase C)
- DNT suitability report PDF (Phase C)
- Referral system + `/dashboard/referral` route (P1)
- Analytics dashboard `/admin/analytics` (Phase D — PostHog integration)
- Sentry monitoring (Phase D)
- A/B test management (P1)
- Email template builder (hardcoded templates are fine)
- systemPrompt/constraints editing in admin UI (Phase C — large text, needs dedicated editor)
- Rate limiting on auth endpoints (add before production deployment)
