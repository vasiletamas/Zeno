# Slice D1: Production Readiness — Design Spec

**Project:** Zeno — AI Life Insurance Sales Agent V2
**Slice:** D1 (Dockerfile, Sentry, PostHog, Azure Deployment Config, Allianz SOP)
**Date:** 2026-03-23
**Status:** Approved
**Depends on:** Phases A-C (complete)

---

## 1. Goal

Make the app production-ready for Azure deployment: Dockerfile with standalone Next.js build, Sentry error tracking, PostHog funnel analytics, health check endpoint, production environment configuration, and Allianz submission SOP.

## 2. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hosting | Azure App Service (EU West) | GDPR-compliant EU region. Docker container deployment. Managed scaling. |
| Database | Azure Database for PostgreSQL Flexible Server | Managed, EU West, automatic backups, SSL. |
| Monitoring | Sentry + PostHog | Sentry for errors, PostHog for business funnel analytics. Both env-gated. |
| Docker | Multi-stage Dockerfile, standalone Next.js output | Small image (~150MB). No Docker Compose for prod — just the app container. |
| Domain | use-zeno.com | Custom domain with Azure-managed SSL. |

## 3. File Structure

```
Dockerfile                           — Multi-stage production build
.dockerignore                        — Exclude node_modules, .next, etc.
next.config.ts                       — MODIFIED: add output: 'standalone'
sentry.client.config.ts              — Sentry client-side init
sentry.server.config.ts              — Sentry server-side init
sentry.edge.config.ts                — Sentry edge runtime init
lib/analytics/posthog.ts             — PostHog server-side client
lib/analytics/events.ts              — Funnel event tracking functions
components/providers/posthog-provider.tsx — PostHog client-side provider
app/api/health/route.ts              — Health check endpoint
.env.production.example              — All production env vars documented
docs/allianz-submission-sop.md       — Operator guide for Allianz submission
```

## 4. Dockerfile

Multi-stage build optimized for Azure App Service:

```dockerfile
# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# Stage 3: Runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/lib/generated ./lib/generated

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

Requires `output: 'standalone'` in next.config.ts.

## 5. Sentry Integration

### Dependencies
```bash
npm install @sentry/nextjs
```

### `sentry.client.config.ts`
```typescript
import * as Sentry from '@sentry/nextjs'

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,        // 10% of transactions
    replaysSessionSampleRate: 0,   // no session replays
    replaysOnErrorSampleRate: 0.5, // 50% of error sessions
  })
}
```

### `sentry.server.config.ts`
```typescript
import * as Sentry from '@sentry/nextjs'

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  })
}
```

### `sentry.edge.config.ts`
Same as server but for edge runtime (middleware).

### Integration with Next.js
Sentry wraps `next.config.ts` via `withSentryConfig()`. Source maps uploaded at build time when `SENTRY_AUTH_TOKEN` is set.

Environment-gated: if `SENTRY_DSN` is not set, Sentry does nothing (safe for dev).

## 6. PostHog Integration

### Dependencies
```bash
npm install posthog-js posthog-node
```

### `lib/analytics/posthog.ts` (server-side)
```typescript
import { PostHog } from 'posthog-node'

let posthogClient: PostHog | null = null

export function getPostHog(): PostHog | null {
  if (!process.env.POSTHOG_API_KEY) return null
  if (!posthogClient) {
    posthogClient = new PostHog(process.env.POSTHOG_API_KEY, {
      host: process.env.POSTHOG_HOST || 'https://eu.posthog.com',
    })
  }
  return posthogClient
}
```

Note: Use `eu.posthog.com` for EU data residency (GDPR).

### `lib/analytics/events.ts` (server-side event tracking)
```typescript
export function trackEvent(event: string, properties?: Record<string, unknown>, distinctId?: string): void {
  const posthog = getPostHog()
  if (!posthog || !distinctId) return
  posthog.capture({ distinctId, event, properties })
}

// Pre-defined funnel events
export function trackChatStarted(customerId: string): void
export function trackProductSelected(customerId: string, tierCode: string, levelCode: string): void
export function trackDntCompleted(customerId: string): void
export function trackQuoteGenerated(customerId: string, premiumAnnual: number): void
export function trackQuoteAccepted(customerId: string, premiumAnnual: number): void
export function trackPaymentCompleted(customerId: string, amount: number): void
export function trackPolicyIssued(customerId: string, policyId: string): void
```

### `components/providers/posthog-provider.tsx` (client-side)
```typescript
'use client'
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { useEffect } from 'react'

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.posthog.com',
        capture_pageview: true,
        capture_pageleave: true,
      })
    }
  }, [])

  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return <>{children}</>
  return <PHProvider client={posthog}>{children}</PHProvider>
}
```

### Integration points (server-side events)
| Where | Event | When |
|-------|-------|------|
| `lib/chat/orchestrator.ts` (step 1) | `chat_started` | New conversation created |
| `lib/tools/handlers/application-handlers.ts` | `product_selected` | PACKAGE_CHOICE answered |
| `lib/tools/handlers/dnt-handlers.ts` (signDnt) | `dnt_completed` | DNT signed |
| `lib/tools/handlers/quote-handlers.ts` (generateQuote) | `quote_generated` | Quote created |
| `lib/tools/handlers/quote-handlers.ts` (acceptQuote) | `quote_accepted` | Quote accepted |
| `lib/payments/post-payment.ts` | `payment_completed` | Payment confirmed |
| `app/api/admin/policies/[id]/status/route.ts` | `policy_issued` | Policy activated by operator |

## 7. Health Check

### `app/api/health/route.ts`
```typescript
GET /api/health
Response: {
  status: 'ok',
  version: string,        // from package.json
  uptime: number,         // process.uptime() in seconds
  timestamp: string,      // ISO date
  database: 'connected' | 'error'
}
```

Checks DB connectivity via `prisma.$queryRaw('SELECT 1')`. Used by Azure App Service health probes.

## 8. Production Environment

### `.env.production.example`
```bash
# App
NODE_ENV=production
APP_URL=https://use-zeno.com
PORT=3000

# Database (Azure Database for PostgreSQL)
DATABASE_URL="postgresql://user:password@zeno-db.postgres.database.azure.com:5432/zeno?sslmode=require"

# LLM Providers
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Auth
JWT_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">

# Security
ENCRYPTION_KEY=<generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">

# Payment
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...

# Email
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM=Zeno <noreply@use-zeno.com>

# Monitoring
SENTRY_DSN=https://...@sentry.io/...
NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
SENTRY_AUTH_TOKEN=sntrys_...           # for source map upload at build
SENTRY_ORG=your-org
SENTRY_PROJECT=zeno

# Analytics
POSTHOG_API_KEY=phc_...
NEXT_PUBLIC_POSTHOG_KEY=phc_...
POSTHOG_HOST=https://eu.posthog.com
NEXT_PUBLIC_POSTHOG_HOST=https://eu.posthog.com

# Reports
REPORTS_PATH=/app/data/reports

# Admin
ADMIN_EMAIL=admin@use-zeno.com
ADMIN_PASSWORD=<change-this>
```

### Azure App Service Configuration
All env vars set via Azure Portal > App Service > Configuration > Application settings. Secrets marked as "slot settings" so they don't transfer between staging/production slots.

## 9. Allianz Submission SOP

### `docs/allianz-submission-sop.md`

Step-by-step guide for the Allianz operator:

1. **Login:** Navigate to `https://use-zeno.com/admin`, enter credentials
2. **Check new applications:** Dashboard shows "Aplicatii noi" count. Click to view.
3. **Review application:** Click an application → see all customer data, answers, quote
4. **Generate email:** Click "Generare Email Allianz" → pre-filled email appears. Click "Copiaza".
5. **Send to Allianz:** Paste into email client, send to Allianz contact
6. **Track submission:** Mark application as "Submitted" in admin panel
7. **Activate policy:** When Allianz confirms → "Activare Polita" → enter Allianz policy number
8. **Customer notification:** System automatically emails the customer with activation confirmation

**SLA targets:**
- New application → email to Allianz: within 2 hours (business hours)
- Allianz confirmation → policy activation: within 24 hours
- Customer receives activation email: immediately after operator activates

## 10. Exit Criteria

- [ ] Dockerfile builds successfully (`docker build -t zeno .`)
- [ ] Docker image runs correctly (`docker run -p 3000:3000 zeno`)
- [ ] Health check responds: `GET /api/health` → `{ status: 'ok' }`
- [ ] `next.config.ts` has `output: 'standalone'`
- [ ] Sentry integration: client + server + edge configs, env-gated
- [ ] PostHog integration: client provider + server events, env-gated
- [ ] 7 funnel events tracked (chat_started through policy_issued)
- [ ] `.env.production.example` documents all variables
- [ ] `.dockerignore` excludes non-essential files
- [ ] Allianz submission SOP document complete
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds

## 11. What D1 does NOT include

- Azure resource provisioning (done in Azure Portal/CLI by you)
- DNS configuration for use-zeno.com
- CI/CD pipeline (GitHub Actions — add when you want automated deploys)
- Load testing
- Facebook ad campaign
- Staging environment (single production for soft launch)
