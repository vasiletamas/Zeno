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

### Sub-Project #5: Observability & Hooks — NOT STARTED

**Spec:** Not yet written
**Plan:** Not yet written
**Status:** Next up. Brainstorm started but context was cleared.

**Claude Code patterns to adopt:**
- **Hook system** (Claude Code: `src/utils/hooks.ts`) — ~15 lifecycle events: `pre_tool_use`, `post_tool_use`, `session_start`, `session_end`, `config_change`, `subagent_start/stop`, `task_created/completed`
- **OpenTelemetry spans** (Claude Code: `startHookSpan()`/`endHookSpan()`) — distributed tracing with lazy loading
- **Three-layer observability** (Claude Code: OTel tracing + analytics events + cost tracking)
- **Analytics with metadata sanitization** (Claude Code: `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`)
- **Cost tracking** (Claude Code: `cost-tracker.ts` — per-turn token counting, `getTotalCost()`, `maxBudgetUsd`)

**Expected deliverables (to be designed):**
- Lifecycle event bus — typed events for pipeline phases, mode transitions, skill pack changes, tool executions
- Sentry integration with pipeline context — connect structured logger to Sentry with errorId, layer, phases
- Cost calculation — use ModelCatalog pricing + actual token counts to fill TurnTrace.cost
- Anomaly detection — fill TurnTrace.anomalies (unusual latency, high token use, error patterns)
- Metrics aggregation — latency percentiles, error rates, token cost distributions, skill pack usage
- Request/trace ID propagation — correlate logs across async operations
- Hook subscribers — composable handlers that react to lifecycle events

**Existing infrastructure to build on:**
- Structured logger (`lib/errors/logger.ts`) — writes JSON, needs Sentry transport
- TurnTrace model — phases JSON captures all 10 steps, anomalies field unused, cost field always null
- Sentry configured (`sentry.*.config.ts`) — basic init, not integrated with pipeline
- PostHog (`lib/analytics/posthog.ts`) — 7 funnel events, needs expansion
- Gateway call records (`lib/llm/gateway.ts`) — volatile 200-entry ring buffer, not persisted
- ModelCatalog — has `costPer1kInputTokens`/`costPer1kOutputTokens`, not used for calculation

---

### Sub-Project #6: Performance — NOT STARTED

**Spec:** Not yet written
**Plan:** Not yet written

**Claude Code patterns to adopt:**
- **Lazy module loading** (Claude Code: OpenTelemetry ~1.1MB loaded only when enabled)
- **Parallel prefetch on startup** (Claude Code: MDM, keychain, API preconnect in parallel)
- **Memoization** (Claude Code: memoized git status, CLAUDE.md content)

**Expected deliverables (to be designed):**
- Prompt caching optimization — fine-tune stable/dynamic prefix split for max cache hits
- LRU cache tuning — monitor hit rates, adjust TTLs based on data volatility
- Database query optimization — N+1 elimination, connection pooling
- Response latency optimization — identify and fix slowest pipeline phases using TurnTrace data

**Depends on:** Sub-project #1 (prompt caching infra), Sub-project #5 (metrics to identify bottlenecks)

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
| **5** | **Observability & Hooks** | **NEXT** | 0 | — | — |
| 6 | Performance | Planned | 0 | — | — |
| 7 | Self-Improvement Engine | Planned | 0 | — | — |

**Completed:** 4 of 7 sub-projects (29 commits)
**Next:** Sub-project #5 (Observability & Hooks)

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
| **Hook system (~15 lifecycle events)** | `src/utils/hooks.ts` | **Planned** | **#5** |
| **OpenTelemetry spans** | `startHookSpan()`/`endHookSpan()` | **Planned** | **#5** |
| **Three-layer observability** | OTel + analytics + cost tracking | **Planned** | **#5** |
| **Cost tracking** | `cost-tracker.ts`, `getTotalCost()` | **Planned** | **#5** |
| **Feature flags** | GrowthBook + `bun:bundle` feature() | **Planned** | **#7** |
| **Lazy module loading** | OTel loaded only when enabled | **Planned** | **#6** |
| **Parallel prefetch** | Startup preconnect | **Planned** | **#6** |

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
