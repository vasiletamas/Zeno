# Vendor Setup Guide — Sub-Project #5 (Observability & Hooks)

This guide covers the external accounts needed for the observability layer. None of these block local development — everything works with `OTEL_ENABLED=false` and missing DSN/keys. But you'll need them for production and to test the integrations end-to-end.

---

## 1. Sentry (Error Tracking + Performance Monitoring)

**Already installed:** `@sentry/nextjs` v10.45.0
**Already configured:** `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
**What's missing:** Actual DSN values in `.env`

### Setup steps:

1. Go to [sentry.io](https://sentry.io) and sign up (free Developer plan: 5k errors/month, 10k performance transactions/month — plenty for launch)
2. Create a new project:
   - Platform: **Next.js**
   - Team: create one or use default
3. After creation, Sentry shows you a DSN like:
   ```
   https://abc123@o456.ingest.sentry.io/789
   ```
4. Add to your `.env`:
   ```
   SENTRY_DSN=https://abc123@o456.ingest.sentry.io/789
   NEXT_PUBLIC_SENTRY_DSN=https://abc123@o456.ingest.sentry.io/789
   ```
   (Both are the same DSN — one for server, one for client)

5. **Recommended Sentry project settings** (in Sentry dashboard):
   - Data Filters > Filter out `localhost` if you don't want dev noise
   - Performance > Set transaction rate to 10% (matches our `tracesSampleRate: 0.1`)
   - Alerts > Create an alert rule for `level:fatal` so you get notified immediately

### What Sub-project #5 uses Sentry for:
- Structured logger errors/fatals → Sentry issues (with errorId, layer, category tags)
- OpenTelemetry spans → Sentry Performance (pipeline phases, LLM calls, tool executions as transactions)

---

## 2. PostHog (Product Analytics)

**Already installed:** `posthog-node`
**Already configured:** `lib/analytics/posthog.ts` pointing to `eu.posthog.com`
**What's missing:** API key in `.env`

### Setup steps:

1. Go to [eu.posthog.com](https://eu.posthog.com) and sign up (free plan: 1M events/month — more than enough)
   - **Use the EU instance** — your data stays in EU (important for GDPR/Romanian market)
2. After signup, go to Project Settings > Project API Key
3. Copy the key (looks like `phc_abc123...`)
4. Add to your `.env`:
   ```
   POSTHOG_API_KEY=phc_abc123...
   POSTHOG_HOST=https://eu.posthog.com
   ```

### What Sub-project #5 uses PostHog for:
- Enriching existing funnel events (chat_started, quote_generated, etc.) with conversationMode, activeSkillPacks, turnCost, turnLatencyMs
- No new events added — just richer properties on existing ones

---

## 3. OpenTelemetry Collector (Tracing Backend) — OPTIONAL for dev

**New dependencies (added by sub-project #5):** `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`

OTel traces go to Sentry Performance via the `@sentry/opentelemetry` bridge. You do NOT need a separate tracing backend unless you want one.

### Option A: Sentry only (recommended for now)
No additional setup. OTel spans flow to Sentry via the bridge. Done.

### Option B: Local Jaeger (for detailed trace debugging)
If you want to see full trace waterfall diagrams locally:

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

Then set in `.env`:
```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Open `http://localhost:16686` to see traces.

### Option C: Grafana Tempo (production-grade, free tier)
If you later want a dedicated tracing backend in production:
1. Sign up at [grafana.com](https://grafana.com) (free tier: 50GB traces/month)
2. Create a Tempo data source
3. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the Grafana Cloud OTLP endpoint
4. Add auth headers via `OTEL_EXPORTER_OTLP_HEADERS`

Not needed now — revisit when you have real traffic.

---

## Environment Variables Summary

Add these to your `.env` and `.env.example`:

```bash
# Sentry (Error Tracking + Performance)
SENTRY_DSN=                                        # From sentry.io project settings
NEXT_PUBLIC_SENTRY_DSN=                            # Same DSN, exposed to client

# PostHog (Product Analytics)
POSTHOG_API_KEY=                                   # From eu.posthog.com project settings
POSTHOG_HOST=https://eu.posthog.com                # EU instance for GDPR

# OpenTelemetry (Tracing) — optional, disabled by default
OTEL_ENABLED=false                                 # Set true to enable tracing
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318  # OTLP collector endpoint
OTEL_SERVICE_NAME=zeno-agent                       # Service name in traces
```

---

## What Works Without Any Accounts

Everything in sub-project #5 works locally without external accounts:

- **EventBus** — pure TypeScript, no external deps
- **Cost calculator** — uses ModelCatalog from local DB
- **Anomaly detector** — pure in-memory logic
- **Structured logger** — still writes to console (Sentry transport silently skips if no DSN)
- **PostHog enrichment** — silently skips if no API key
- **OTel tracing** — disabled by default (`OTEL_ENABLED=false`)

You can implement and test the entire sub-project locally, then add accounts when ready to see data flow to external dashboards.
