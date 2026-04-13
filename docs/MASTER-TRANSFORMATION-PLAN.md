# Zeno Agent — Master Transformation Plan

**Last updated:** 2026-04-12
**Branch:** `feat/agent-extensibility`
**Reference codebase:** `C:\GitHub\CC-Clones\claude-code-leaks\genuine\codeaashu-claude-code`

---

## Vision

Transform the Zeno AI sales agent from a linear pipeline into a modular, self-improving agent platform — adopting proven architectural patterns from Claude Code (Anthropic's CLI agent). The goal is an agent that observes its own performance, adapts its behavior through skill packs, recovers gracefully from errors, and proposes its own improvements — all while remaining controllable via an admin UI.

---

## What Already Exists (Phases A–D)

Before the transformation sub-projects, the Zeno agent was built in 4 phases across 12 slices:

| Phase | Slices | What was built |
|-------|--------|----------------|
| **A — Core Engine** | A1 Foundation, A2 LLM Pipeline, A3 Agents & Prompts, A4 Sales Engine | Next.js 15 + Prisma + 27 models, LLM gateway with provider abstraction, 10-step orchestrator pipeline, reasoning gate, prompt builder with section registry, sliding window + summarizer, 8 sales tools, questionnaire + quote engines |
| **B — Consumer UI** | B1 Conversation UI, B2 Sales Flow UI, B3 Payment & Checkout, B4 Admin Dashboard | Landing page, chat UI with SSE streaming, 8 rich inline components, Stripe/PayU payment abstraction, RBAC auth (customer/admin/operator), admin panel, customer dashboard |
| **C — Compliance** | C1 E2E Test Suite, C2 Compliance, C3 Romanian Sales Scripts | E2E test library + 5 scenarios, encryption + DNT PDF + GDPR deletion, IDD-compliant AI disclosure, comprehensive Romanian playbooks |
| **D — Production** | D1 Production Readiness | Dockerfile, Sentry (basic), PostHog (basic funnel), health check, Allianz submission SOP |

**Total commits:** ~80+
**All slices:** Spec designed, plan written, implemented, tested.

---

## The 7 Transformation Sub-Projects

These sub-projects upgrade the existing agent with patterns inspired by Claude Code's architecture: lifecycle hooks, tool classification, circuit breakers, agent extensibility, observability telemetry, and self-improvement loops.

### Dependency Graph

```
FOUNDATION LAYER (no dependencies)
  #1 Context & Memory ─────┐
  #2 Error Recovery ────────┤
                            ▼
CAPABILITY LAYER
  #3 Tool System ───────────┐  (depends on #1 LRU cache, #2 circuit breakers)
                            │
  #4 Agent Extensibility ───┤  (depends on #1, #2, #3)
                            ▼
INFRASTRUCTURE LAYER
  #5 Observability & Hooks ─┤  (depends on #2 structured logger, #4 lifecycle events)
                            │
OPTIMIZATION LAYER          │
  #6 Performance ───────────┤  (depends on #1 prompt caching infra)
                            ▼
AUTONOMOUS LAYER
  #7 Self-Improvement ──────   (depends on #1, #3, #4, #5)
```

---

### Sub-Project #1: Context & Memory — COMPLETE

**Spec:** `docs/superpowers/specs/2026-04-10-context-and-memory-design.md`
**Plan:** `docs/superpowers/plans/2026-04-10-context-and-memory.md`
**Commit:** `04e35d7`

**Claude Code patterns adopted:**
- Memory system with file-based persistent knowledge (Claude Code: `src/memdir/`)
- Context compression / reactive compaction (Claude Code: proactive + reactive context strategies)
- LRU caching for expensive data (Claude Code: memoized system/user context)

**What was delivered:**
- Token budget system (`lib/chat/token-budget.ts`) — dynamic message window replacing hardcoded 20-message limit
- Reactive compaction (`lib/chat/compaction.ts`) — catches context overflow, compresses message history
- Customer memory (`CustomerInsight` model) — cross-conversation learning with categories and confidence scores
- Agent knowledge (`AgentKnowledge` model) — proven patterns with success metrics
- LRU cache (`lib/cache/lru-cache.ts`) — TTL-based caching for agent config, product context, tools
- Stable system prompt prefix — reorders sections for provider-level prompt caching (Anthropic ephemeral cache, OpenAI automatic prefix cache)

**Files added:** `lib/chat/token-budget.ts`, `lib/chat/compaction.ts`, `lib/cache/lru-cache.ts`, seed updates
**Files modified:** orchestrator, prompt builder, context loaders, schema (2 new models + ModelCatalog.contextWindow)

---

### Sub-Project #2: Error Recovery — COMPLETE

**Spec:** `docs/superpowers/specs/2026-04-11-error-recovery-design.md`
**Plan:** `docs/superpowers/plans/2026-04-11-error-recovery.md`
**Commits:** `929f8af` through `89d99d3` (10 commits)

**Claude Code patterns adopted:**
- Structured error logging with errorId tracking (Claude Code: `logForDebugging()`, `logError()`)
- Circuit breaker with 3-state machine (Claude Code: feature-gated circuit breakers)
- Exponential backoff with jitter (Claude Code: `withRetry.ts` — `DEFAULT_MAX_RETRIES=10`, backoff + jitter)
- Layered error boundaries (Claude Code: structured `CannotRetryError` with retry context)

**What was delivered:**
- Structured JSON logger (`lib/errors/logger.ts`) — errorId, severity, layer, category, context, stack
- Error types (`lib/errors/types.ts`) — `CircuitOpenError`, `TimeoutError`
- Circuit breaker (`lib/errors/circuit-breaker.ts`) — closed/open/half-open, per-provider (5 failures/60s) and per-tool (3 failures/30s)
- Gateway hardening — adaptive backoff, `retry-after` parsing, streaming error recovery
- Orchestrator hardening — step-level error boundaries, graceful degradation, queued retry (5s/10s/20s), 90s timeout
- Tool executor hardening — per-tool circuit breaker, 15s timeout
- API route hardening — concurrency guard (3 per conversation), error catch, structured SSE errors

**Files added:** `lib/errors/logger.ts`, `lib/errors/types.ts`, `lib/errors/circuit-breaker.ts`
**Files modified:** gateway, orchestrator, tool executor, API route, SSE handler (7 files)

**Deferred to #5:** External error transports (Sentry integration with pipeline context)

---

### Sub-Project #3: Tool System — COMPLETE

**Spec:** `docs/superpowers/specs/2026-04-11-tool-system-design.md`
**Plan:** `docs/superpowers/plans/2026-04-11-tool-system.md`
**Commits:** `2751ee1` through `db90cdd` (5 commits)

**Claude Code patterns adopted:**
- Tool classification flags (Claude Code: `isReadOnly()`, `isConcurrencySafe()`, `isDestructive()`)
- Parallel tool execution for read-only tools (Claude Code: concurrency-safe tools run in parallel)
- Result caching (Claude Code: memoized computations for expensive operations)

**What was delivered:**
- Tool definition extensions (`lib/tools/types.ts`) — `sideEffects`, `cacheable`, `cacheTtlMs` flags
- Tool result cache (`lib/tools/cache.ts`) — LRU with per-tool TTL, deterministic cache keys
- Tool classification — 4 cacheable tools (product queries), 2 read-only non-cached, rest sequential
- Parallel execution in orchestrator — Phase 1 (read-only parallel via `Promise.all`), Phase 2 (writing sequential)

**Files added:** `lib/tools/cache.ts`
**Files modified:** `lib/tools/types.ts`, tool registry, tool executor, orchestrator (4 files)

**Deferred:** Speculative execution (predicting next tool call), cache warming

---

### Sub-Project #4: Agent Extensibility — COMPLETE

**Spec:** `docs/superpowers/specs/2026-04-11-agent-extensibility-design.md`
**Plan:** `docs/superpowers/plans/2026-04-11-agent-extensibility.md`
**Commits:** `10ebd10` through `8527961` (13 commits)

**Claude Code patterns adopted:**
- Skill/command registration pattern (Claude Code: `buildTool()` factory, command types with `allowedTools`)
- Multi-agent coordination (Claude Code: `AgentTool` spawning workers, `coordinatorMode`)
- Permission/capability scoping (Claude Code: per-tool permission checks, wildcard rules)
- Dynamic tool filtering (Claude Code: commands declare `allowedTools` per context)

**What was delivered:**
- `SkillPack` Prisma model — DB bundles of prompt sections, tools, constraints with priority-based merging
- 7 initial skill packs seeded (life-insurance-discovery, closing, questionnaire-facilitation, 4 post-sale packs)
- Skill pack loader (`lib/skills/skill-pack-loader.ts`) — load, cache (LRU 5min), merge, filter tools
- Conversation mode tracking — `mode` field (SALES/ONBOARDING/SUPPORT/CLAIMS/RENEWAL) + `activeSkillPacks`
- Agent resolver (`lib/chat/agent-resolver.ts`) — route conversation mode to agent config
- Extended reasoning gate — recommends skill packs, detects mode transitions, flags compliance moments
- Compliance checker agent — parallel non-blocking evaluation, `complianceGuidance` prompt injection
- Agent.type enum replaced with Agent.role string (flexible)
- Orchestrator refactored — no hardcoded 'main-chat', dynamic agent + tools per mode
- Admin UI for skill packs (`/admin/skill-packs`) — list, edit, toggle, flush cache
- Admin API routes — GET list, GET detail, PUT update, POST toggle, POST flush-cache

**Files added:** 8 new files (skill pack loader, agent resolver, compliance checker, admin UI/API)
**Files modified:** 10 files (schema, orchestrator, reasoning gate, prompt builder, etc.)

**Deferred to #5:** Lifecycle events for mode transitions, metrics dashboard for skill pack usage
**Deferred to #7:** Debrief agent, automated skill pack suggestions, A/B testing of variations

---

### Sub-Project #5: Observability & Hooks — COMPLETE

**Spec:** `docs/superpowers/specs/2026-04-12-observability-hooks-design.md`
**Plan:** `docs/superpowers/plans/2026-04-12-observability-hooks.md`
**Commits:** `c149b54` through `83f43ff` (9 commits)

**Claude Code patterns adopted:**
- **Hook system** (Claude Code: `src/utils/hooks.ts`) — Typed lifecycle event bus with 12 events (turn, phase, LLM, tool, mode, skillpack, compliance)
- **OpenTelemetry spans** (Claude Code: `startHookSpan()`/`endHookSpan()`) — Full OTel tracing with lazy SDK loading, span tree per turn
- **Three-layer observability** (Claude Code: OTel tracing + analytics events + cost tracking) — OTel subscriber + Sentry bridge + cost calculator + anomaly detector + PostHog enrichment
- **Cost tracking** (Claude Code: `cost-tracker.ts`) — Per-turn cost accumulated from ModelCatalog pricing, persisted in TurnTrace.cost

**What was delivered:**
- Event types (`lib/events/types.ts`) — ZenoEvent discriminated union with 12 lifecycle event types, Anomaly interface
- Event bus (`lib/events/event-bus.ts`) — Singleton with emit/on/once, fire-and-forget, handler errors caught
- OTel setup (`lib/events/otel-setup.ts`) — Lazy SDK initialization (~1.1MB only when OTEL_ENABLED=true), SentrySpanProcessor bridge
- OTel subscriber (`lib/events/otel-subscriber.ts`) — Creates span tree per turn: root → phase → LLM/tool child spans, business events as span events
- Cost subscriber (`lib/events/cost-subscriber.ts`) — Accumulates per-turn cost from ModelCatalog with LRU-cached pricing lookups
- Anomaly subscriber (`lib/events/anomaly-subscriber.ts`) — Threshold-based detection (latency, cost, error patterns, behavioral) with RollingStats
- Sentry transport in logger (`lib/errors/logger.ts`) — error/fatal → Sentry with errorId, layer, category tags
- PostHog enrichment (`lib/analytics/events.ts`) — enrichEventProps helper adds cost/mode/skillpacks to funnel events
- Barrel export (`lib/events/index.ts`) — initObservability() registers all subscribers
- Orchestrator instrumented (`lib/chat/orchestrator.ts`) — traceId in TurnState, phase:start/end around all 10 steps, business events emitted
- Gateway instrumented (`lib/llm/gateway.ts`) — traceId threading, llm:call:start/end emits
- Tool executor instrumented (`lib/tools/executor.ts`) — traceId threading, tool:start/end emits with cached flag
- Sentry server config updated (`sentry.server.config.ts`) — skipOpenTelemetrySetup for custom OTel management

**Files added:** 7 new files in `lib/events/`, 7 test files
**Files modified:** 6 files (orchestrator, gateway, executor, logger, analytics events, sentry config)

**Deferred to #7:** Relative anomaly thresholds (RollingStats infra built, fixed thresholds for now), admin metrics dashboard, alerting rules

---

### Sub-Project #6: Performance — COMPLETE

**Spec:** `docs/superpowers/specs/2026-04-13-performance-design.md`
**Plan:** `docs/superpowers/plans/2026-04-13-performance.md`
**Commits:** `a3ea8df` through `a65ee40` (11 commits)

**Claude Code patterns adopted:**
- **Parallel prefetch** (Claude Code: MDM, keychain, API preconnect in parallel) — Steps 3+4 run concurrently, consolidated turn context query (4 parallel DB queries replace ~10 sequential)
- **Session memory / proactive summarization** (Claude Code: incremental background extraction) — Stale-while-revalidate summaries, proactive background refresh in Step 9, incremental summarization
- **Prompt cache optimization** (Claude Code: prompt caching strategy) — Generic `CacheHint` on `Message` type, Anthropic adapter maps to `cache_control` on separate system content blocks, `cache:status` event for hit rate tracking
- **Memoization** (Claude Code: memoized git status, CLAUDE.md content) — Deterministic tool sort for stable prompt prefix serialization

**What was delivered:**
- Pipeline parallelization — Steps 3 (reasoning gate) + 4 (context assembly) run concurrently via `Promise.all`
- Consolidated turn context query (`lib/chat/turn-context.ts`) — 4 parallel queries replace ~10 sequential DB round trips
- `loadAllSections` accepts `prefetchedCustomer` to skip redundant customer DB query
- Proactive summarizer — stale-while-revalidate in `buildSlidingWindow`, background refresh via `updateSummaryIfStale` in Step 9, incremental summarization prompt
- Generic `CacheHint` interface on `Message` type (`lib/llm/providers/types.ts`)
- Anthropic adapter creates separate system content blocks with `cache_control` based on `cacheHint`
- `cache:status` event in `ZenoEvent` union with `parseCacheUsage` in gateway (Anthropic + OpenAI)
- Deterministic alphabetical sort in `getToolsForLLM` for stable prompt prefix
- Performance benchmark suite (`__tests__/performance/`) — 4 scenarios with timing assertions, mock LLM provider, phase timing collector

**Files added:** `lib/chat/turn-context.ts`, `__tests__/performance/bench-helpers.ts`, `__tests__/performance/bench-pipeline.test.ts`, + 6 test files
**Files modified:** `lib/chat/orchestrator.ts`, `lib/chat/context-loaders.ts`, `lib/chat/sliding-window.ts`, `lib/llm/providers/types.ts`, `lib/llm/providers/anthropic.ts`, `lib/llm/gateway.ts`, `lib/events/types.ts`, `lib/tools/registry.ts`

**Depends on:** Sub-project #1 (prompt caching infra, LRU cache), Sub-project #5 (event bus for timing)

---

### Sub-Project #7: Self-Improvement Engine — NOT STARTED

**Spec:** Not yet written
**Plan:** Not yet written

**Claude Code patterns to adopt:**
- **Feature flags for safe rollout** (Claude Code: GrowthBook integration, build-time feature flags via `bun:bundle`)
- **Scratchpad / shared knowledge store** (Claude Code: durable cross-worker knowledge directory)
- **Multi-agent coordination** (Claude Code: coordinator spawns workers, results arrive async, never fabricated)

**Expected deliverables (to be designed):**
- Debrief agent — analyzes conversation outcomes after each session
- Daily batch analysis — aggregate learnings, identify patterns across conversations
- AgentKnowledge writer — propose new objection responses, tool sequences, conversation patterns
- Human-in-the-loop approval — admin reviews + approves/rejects proposed changes
- Feedback loop — track effectiveness of adopted improvements
- A/B testing — skill pack variations with conversion tracking

**Depends on:** Sub-project #1 (AgentKnowledge model), #3 (tool system), #4 (skill pack system), #5 (lifecycle events to observe)

---

## Progress Summary

| # | Sub-Project | Status | Commits | Spec | Plan |
|---|-------------|--------|---------|------|------|
| 1 | Context & Memory | COMPLETE | 1 | 2026-04-10 | 2026-04-10 |
| 2 | Error Recovery | COMPLETE | 10 | 2026-04-11 | 2026-04-11 |
| 3 | Tool System | COMPLETE | 5 | 2026-04-11 | 2026-04-11 |
| 4 | Agent Extensibility | COMPLETE | 13 | 2026-04-11 | 2026-04-11 |
| 5 | Observability & Hooks | COMPLETE | 9 | 2026-04-12 | 2026-04-12 |
| 6 | Performance | COMPLETE | 11 | 2026-04-13 | 2026-04-13 |
| **7** | **Self-Improvement Engine** | **NEXT** | 0 | — | — |

**Completed:** 6 of 7 sub-projects (49 commits)
**Next:** Sub-project #7 (Self-Improvement Engine)

---

## Claude Code Reference Architecture

Source: `C:\GitHub\CC-Clones\claude-code-leaks\genuine\codeaashu-claude-code`

Key architectural patterns already adopted or planned for adoption:

| Claude Code Pattern | Location in CC | Zeno Status | Sub-Project |
|---|---|---|---|
| Tool classification (readOnly, destructive, concurrencySafe) | `src/Tool.ts` | Adopted (sideEffects, cacheable) | #3 |
| Parallel tool execution | `buildTool()` + isConcurrencySafe | Adopted | #3 |
| Circuit breaker | Feature-gated in retry logic | Adopted (3-state) | #2 |
| Exponential backoff + jitter | `src/services/api/withRetry.ts` | Adopted | #2 |
| Structured error logging | `logForDebugging()`, `logError()` | Adopted | #2 |
| Memory system (file-based) | `src/memdir/` | Adopted (DB-based CustomerInsight + AgentKnowledge) | #1 |
| Context compression | Reactive + proactive strategies | Adopted (reactive compaction) | #1 |
| LRU caching | Memoized system/user context | Adopted | #1 |
| Prompt caching (stable prefix) | Message caching strategy | Adopted | #1 |
| Skill/command registration | `buildTool()`, command registry | Adopted (SkillPack model) | #4 |
| Multi-agent coordination | `coordinatorMode.ts`, `AgentTool` | Adopted (compliance checker, agent resolver) | #4 |
| Permission/capability scoping | `useCanUseTool()`, wildcard rules | Adopted (tool scoping per skill pack) | #4 |
| Hook system (12 lifecycle events) | `src/utils/hooks.ts` | Adopted (EventBus + typed events) | #5 |
| OpenTelemetry spans | `startHookSpan()`/`endHookSpan()` | Adopted (lazy OTel SDK + span subscriber) | #5 |
| Three-layer observability | OTel + analytics + cost tracking | Adopted (OTel + Sentry + cost + anomaly + PostHog) | #5 |
| Cost tracking | `cost-tracker.ts`, `getTotalCost()` | Adopted (ModelCatalog pricing → TurnTrace.cost) | #5 |
| **Feature flags** | GrowthBook + `bun:bundle` feature() | **Planned** | **#7** |
| Lazy module loading | OTel loaded only when enabled | Adopted (Sub-project #5) | #5 |
| Parallel prefetch / pipeline parallelization | Startup preconnect | Adopted (Steps 3+4 concurrent, turn context) | #6 |
| Prompt cache optimization | Prompt caching strategy | Adopted (CacheHint, Anthropic adapter, cache:status event) | #6 |
| Proactive summarization | Session memory extraction | Adopted (stale-while-revalidate, background refresh) | #6 |

---

## How to Use This Document

**Starting a new session:** Read this file first. It tells you where we are, what's done, and what's next.

**Before implementing a sub-project:** Read its spec and plan from `docs/superpowers/specs/` and `docs/superpowers/plans/`.

**After completing a sub-project:** Update the Progress Summary table above and add the commit range.

**Key files for orientation:**
- `v2-build-plan.md` — Original 4-phase build plan (Phases A–D)
- `docs/superpowers/specs/` — Design specs for each sub-project
- `docs/superpowers/plans/` — Implementation plans for each sub-project
- `lib/chat/orchestrator.ts` — The 10-step pipeline (central nervous system)
- `lib/errors/logger.ts` — Structured logging (Sub-project #5 builds transports on this)
- `prisma/schema.prisma` — All models including TurnTrace, SkillPack, CustomerInsight, AgentKnowledge
