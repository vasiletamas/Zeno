# Slice B4: Admin + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build proper auth with RBAC, admin panel for managing applications/agents/policies, and customer dashboard for post-purchase policy viewing. Completes Phase B.

**Architecture:** Custom auth via JWT (jose) + bcryptjs. Next.js middleware at project root for route protection. Admin pages use server components with data loading. Customer dashboard uses magic link → JWT session flow.

**Tech Stack:** jose (JWT), bcryptjs (passwords), Next.js middleware, React server components

**Spec:** `docs/superpowers/specs/2026-03-22-slice-b4-admin-dashboard-design.md`

---

## File Map

### New files (~30)

**Auth (5):** `lib/auth/jwt.ts`, `passwords.ts`, `middleware.ts`, `types.ts`, `middleware.ts` (project root)
**Auth API (5):** `app/api/auth/login/route.ts`, `magic-link/route.ts`, `verify/route.ts`, `logout/route.ts`, `me/route.ts`
**Admin API (5):** `app/api/admin/stats/route.ts`, `policies/[id]/status/route.ts`, `agents/[id]/route.ts`, `agents/flush-cache/route.ts`, `users/route.ts`
**Admin pages (10):** layout, dashboard, login, applications list+detail, policies, conversations list+detail, agents, users
**Dashboard pages (3):** layout, dashboard, login
**Components (8):** admin sidebar, header, application table, policy table, agent config row, allianz email generator, conversation viewer; dashboard policy card, quick actions, documents

### Modified files

`prisma/schema.prisma` (User model), `prisma/seeds/` (seed admin user), `.env.example` (JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD)

---

## Task 1: Auth System

**Files:**
- Modify: `prisma/schema.prisma`, `prisma/seeds/`
- Create: `lib/auth/jwt.ts`, `lib/auth/passwords.ts`, `lib/auth/types.ts`, `lib/auth/middleware.ts`
- Create: `middleware.ts` (project root)
- Create: all 5 `app/api/auth/` routes

- [ ] **Step 1: Schema + deps**

Install: `npm install jose bcryptjs && npm install -D @types/bcryptjs`

Add User model to schema (spec Section 3). Add reverse relation on Customer. Push + generate.

Seed default admin user in `prisma/seeds/seed-users.ts`.

- [ ] **Step 2: Create auth lib (4 files)**

`lib/auth/types.ts`: AuthUser, JWTPayload interfaces.
`lib/auth/jwt.ts`: signToken (jose SignJWT) + verifyToken (jose jwtVerify). Cookie attributes: HttpOnly, SameSite=Lax, Secure in production.
`lib/auth/passwords.ts`: hashPassword (bcryptjs, 12 rounds) + verifyPassword.
`lib/auth/middleware.ts`: getAuthUser (extract from cookie), hasRole, verifyUserActive (DB check for admin/operator).

- [ ] **Step 3: Create Next.js middleware**

`middleware.ts` at PROJECT ROOT (not in app/):
- Match routes: `/admin/*`, `/dashboard/*`, `/api/admin/*`
- Extract JWT from `zeno_auth` cookie
- Verify token
- Check role against route requirements
- For admin/operator: also verify isActive via DB
- Redirect to appropriate login page if unauthorized

- [ ] **Step 4: Create auth API routes (5 files)**

`POST /api/auth/login`: email+password → verify → JWT cookie (24h) → return user.
`POST /api/auth/magic-link`: email → find Customer → generate token (30-min expiry) → send email → return success.
`GET /api/auth/verify`: token param → validate → create/find User → JWT cookie (7d) → clear token → redirect to /dashboard.
`POST /api/auth/logout`: clear cookie → return success.
`GET /api/auth/me`: extract JWT → return user info or 401.

- [ ] **Step 5: Verify + commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat(b4): add auth system with RBAC, JWT sessions, and route protection middleware"
```

---

## Task 2: Admin Panel

**Files:**
- Create: all admin pages + components + API routes

- [ ] **Step 1: Admin layout + login + dashboard**

`app/admin/layout.tsx`: Server component. Check auth. Sidebar nav + header. Max-width 1080px.
`app/admin/login/page.tsx`: Login form (email + password). Posts to /api/auth/login. Redirects to /admin on success.
`app/admin/page.tsx`: Dashboard with summary counts (applications, policies, conversations). Query DB for counts.

Components: `admin-sidebar.tsx` (nav links with Lucide icons), `admin-header.tsx` (user email + role + logout).

- [ ] **Step 2: Applications pages**

`app/admin/applications/page.tsx`: Table with filter by status. Load from DB with pagination.
`app/admin/applications/[id]/page.tsx`: Full application detail + customer data + answers + quote + policy.

Components: `application-table.tsx`, `allianz-email-generator.tsx` (pre-filled email template with copy button).

- [ ] **Step 3: Policies + Agent config + Users + Conversations**

`app/admin/policies/page.tsx`: Table with status filter. Inline status update (PENDING_SUBMISSION → SUBMITTED → ACTIVE). Enter Allianz policy number.
`app/admin/agents/page.tsx`: One card per agent. Provider/model dropdowns (from ModelCatalog), temperature slider, flush cache button. ADMIN only.
`app/admin/users/page.tsx`: Table + create operator modal. ADMIN only.
`app/admin/conversations/page.tsx`: Table with click-through to detail. ADMIN only.
`app/admin/conversations/[id]/page.tsx`: Full message history + turn traces.

Components: `policy-table.tsx`, `agent-config-row.tsx`, `conversation-viewer.tsx`.

- [ ] **Step 4: Admin API routes**

`GET /api/admin/stats`: Dashboard counts.
`PATCH /api/admin/policies/[id]/status`: Update policy status + allianzPolicyNumber. Trigger activation email if status=ACTIVE.
`PATCH /api/admin/agents/[id]`: Update agent config fields.
`POST /api/admin/agents/flush-cache`: Call flushAgentConfigCache().
`POST /api/admin/users`: Create operator (email + password + role=OPERATOR).
`PATCH /api/admin/users/[id]`: Toggle isActive.

All routes check ADMIN or OPERATOR role. Agent config + users: ADMIN only.

- [ ] **Step 5: Verify + commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat(b4): add admin panel with applications, policies, agents, users management"
```

---

## Task 3: Customer Dashboard

**Files:**
- Create: dashboard pages + components

- [ ] **Step 1: Dashboard layout + login**

`app/dashboard/layout.tsx`: Server component. Check CUSTOMER auth. Header: Zeno wordmark + "Contul meu" + logout. Max-width 640px.
`app/dashboard/login/page.tsx`: Magic link request form. Email input + submit. Posts to /api/auth/magic-link.

- [ ] **Step 2: Dashboard page**

`app/dashboard/page.tsx`: Load customer's policies (via User → Customer → policies). Show policy hero card, quick actions, documents.

Components:
- `policy-hero-card.tsx`: Dark Forest bg, Soft White text, tier+level, status badge, total coverage, next payment. Per brand book wireframe.
- `quick-actions.tsx`: 3 buttons — "Vorbeste cu Zeno" (→/chat), "Descarca polita" (placeholder), "Recomanda" (placeholder).
- `document-list.tsx`: Policy PDF, DNT report, payment receipt — all placeholders.

`app/dashboard/documents/page.tsx`: Document list with placeholder messages.

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "feat(b4): add customer dashboard with policy card, quick actions, documents"
```

---

## Task 4: Final Verification

- [ ] **Step 1: Type check + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 2: Tests**

```bash
npx vitest run
```

- [ ] **Step 3: Re-seed**

```bash
npx prisma db push --force-reset
npx prisma db seed
```
Verify admin user is seeded.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(b4): complete Slice B4 — auth, admin panel, customer dashboard. Phase B complete."
```

---

## Notes for Implementer

1. **Middleware at PROJECT ROOT:** `middleware.ts` goes next to `package.json`, NOT in `app/`. Next.js silently ignores `app/middleware.ts`.
2. **jose for JWT:** Edge-compatible. Import: `import { SignJWT, jwtVerify } from 'jose'`. Secret must be encoded: `new TextEncoder().encode(process.env.JWT_SECRET)`.
3. **bcryptjs (not bcrypt):** Pure JS. Works everywhere. `import bcrypt from 'bcryptjs'`.
4. **Cookie name:** `zeno_auth`. Attributes: HttpOnly, SameSite=Lax, Secure in production.
5. **Magic link token:** 30-minute expiry on the token. JWT session = 7 days after verification.
6. **Admin isActive check:** Middleware must call `verifyUserActive()` for ADMIN/OPERATOR on every request. One DB query — acceptable for internal users.
7. **Agent config dropdowns:** Provider dropdown → model dropdown filters by `ModelCatalog.where({ provider })`. When provider changes, model list updates.
8. **Allianz email:** Pre-formatted template with customer data. Copy-to-clipboard, not actual email sending (operator pastes into their email client).
9. **Admin max-width:** 1080px. Dashboard max-width: 640px. Both centered.
10. **Brand book:** Admin uses same Zeno colors (Forest, Linen, etc.) but functional/table-based layout, not marketing.
