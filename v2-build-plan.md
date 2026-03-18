# V2 Build Plan — AI Insurance Sales Agent

**Allianz-Tiriac Protect + BD Addon**
Engineering Blueprint — From Extraction to Production
Based on 11,000-line knowledge extraction from V1 codebase

**CONFIDENTIAL**

---

## 1. Guiding principles

Non-negotiable rules governing every architectural decision, derived from V1 successes and failures.

**Principle 1: One execution path, not two.** V1 had button clicks going through one code path and LLM-initiated actions through another, both doing the same business logic differently. In V2, every action — whether triggered by a button, the LLM, or an API call — flows through the same pipeline: validate → authorize → gate → execute → refresh context.

**Principle 2: Real streaming from turn one.** V1 generated the full response, then faked streaming by chunking it. Users waited 5-15 seconds seeing nothing. V2 streams tokens from the provider as they arrive. First token visible in 200-400ms.

**Principle 3: Provider-agnostic by design.** V1's multi-provider abstraction was one of its strongest patterns. V2 keeps and improves it: unified LLMProvider interface, per-task provider+model assignment configurable from admin UI, automatic failover, and A/B testing. No provider-specific code outside provider files.

**Principle 4: Prompt economy.** V1 sent 5-8K token prompts for simple yes/no questionnaire answers. V2 is aggressive about prompt size: the reasoning gate classifies each turn's complexity, and only relevant prompt sections are included. A "Da" answer to a medical question gets a 2K prompt, not the full sales playbook.

**Principle 5: The database is the source of truth for all business logic.** Workflows, products, pricing, questions, objection strategies, agent configs — all in the database. Changing a sales flow, switching a model, or adding a product requires zero code changes.

**Principle 6: Observable by default.** Every turn gets a trace. Every LLM call gets recorded. Every anomaly gets flagged. V1's turn trace system with 18 anomaly rules was excellent. V2 carries it forward and adds cost tracking, conversion attribution, and A/B test segmentation.

---

## 2. Architecture decisions

### 2.1 What carries forward from V1 (keep the shape, rewrite the code)

| Pattern | V1 source | V2 adaptation |
|---------|-----------|---------------|
| Tool pipeline: LLM → Zod → RBAC → Gate → Handler → Refresh | lib/tools/chat-handler.ts, executor.ts, gate.ts | Same 5-stage pipeline. Unify action handler into same path (actions become synthetic tool calls). |
| Workflow engine: data-driven state machine | lib/workflows/engine.ts, gate.ts | Keep workflow → step → transition hierarchy. Simplify chaining. Remove dual execution paths. |
| Turn trace: 14-phase collector + anomaly detection | lib/tracing/collector.ts, anomaly-detector.ts | Keep collector pattern and fire-and-forget save. Add A/B segment tracking and cost attribution. |
| LLM gateway: dual API (simple + traced) | lib/llm/gateway.ts | Keep gateway.call() and TracedLLMClient. Add per-task failover and circuit breaker. |
| Dynamic prompt assembly: 3-layer section registry | lib/agents/prompt-builder.ts | Keep registry pattern. Be more aggressive with exclusions. Add token counting. |
| Learning loop: debrief → memory → knowledge | lib/agents/debrief-agent.ts, customer-memory.ts, knowledge.ts | Keep 3-tier loop. Add admin approval gate. Post-launch feature, not launch-blocking. |
| Multi-provider LLM abstraction | lib/llm/types.ts, providers/ | Keep unified interface. Add per-task assignment with admin UI, A/B routing, and automatic failover. |
| Bilingual EN/RO pattern | Json fields + t() helpers | Keep. Use same { en, ro } Json pattern. Detect language per message. |
| Product knowledge from DB | seed-protect-product.ts, product-catalog.json | Direct port. All product data, pricing, coverages, questionnaire seeded from extraction. |
| Objection handling strategies | seed-objections.ts, objection-handling-ro.md | Direct port. All 9 objection types with Romanian response strategies. |

### 2.2 What gets dropped from V1 (do not carry forward)

| Pattern | Why it's dropped | What replaces it |
|---------|-----------------|------------------|
| 2,767-line route.ts god file | Unmaintainable. Mixes orchestration, action handling, context building, and streaming. | Decomposed into: orchestrator (~300 lines), action handler module, context builder module, stream handler module. |
| Regex concern detection (355 lines, English-only) | Superseded by reasoning gate. Doesn't work in Romanian. | Reasoning gate handles concern detection bilingually via LLM. |
| Regex phase detection (162 lines) | Superseded by workflow engine step tracking. | Workflow currentStep is the authoritative phase. Display mapping only. |
| Strategy agent (removed but ghosts remain) | Removed in V1. Added 2-3s latency. Duplicative of reasoning gate. | Delete entirely. Playbook milestone helpers move to standalone module. |
| Fake streaming (chunk + delay) | Adds perceived latency on top of real latency. | Real SSE streaming from provider API. |
| Dual action/tool execution paths | Bug fixes applied in two places. Different transition logic. | Actions become synthetic tool calls. One path. |
| Conversion scoring system | Calculated every turn but never used by any business logic. | Remove. Debrief agent calculates conversation quality post-hoc. |
| JSON.parse(JSON.stringify()) workaround ×36 | Prisma Json type workaround for arrays. | Use String[] where possible. Reserve Json for truly unstructured data. |
| Regex JSON extraction from LLM responses ×6 files | Fragile. Fails on markdown-wrapped JSON. Silent fallback. | Structured output (tool use / json_object mode) for all agent responses. |

### 2.3 What's new in V2 (missing from V1)

| Feature | Priority | Description |
|---------|----------|-------------|
| Real streaming | P0 — launch | SSE streaming from provider. First token in 200-400ms. Typing indicator while reasoning gate runs. |
| Sliding window + summarization | P0 — launch | Last 20 messages full + compressed summary of older messages. The summarizer agent exists in V1 but is unused. Activate it. |
| Structured output for agents | P0 — launch | All secondary agents (reasoning gate, debrief, memory) use tool_use or json_object mode. No regex parsing. |
| Per-task provider assignment with admin UI | P0 — launch | Each agent role has primary + fallback provider/model configurable from admin UI. Dropdown per agent. No deploy needed to switch models. |
| Consumer-facing web app (PWA) | P0 — launch | V1 was admin/CRM focused. V2 is customer-facing: landing page, conversation UI, checkout, dashboard. |
| Payment integration | P0 — launch | Stripe or local Romanian processor. Charge at checkout. First premium collected in-session. |
| Concierge admin panel | P0 — launch | Internal tool: view new applications, generate Allianz submission, update policy status, configure agent models. |
| A/B testing framework | P1 — post-launch | Route conversations to different providers/prompts/hooks. Track conversion by variant. |
| Referral system | P1 — post-launch | Unique links, reward tracking, attribution. |
| Rate limiting | P1 — post-launch | Per-user rate limiting on chat endpoint. Missing in V1. |
| Webhook/event system | P2 — later | External integration points for CRM, email sequences, analytics. |
| Learning loop (debrief → memory → knowledge) | P2 — later | Carried from V1 but deferred. Not needed for launch. Add when 200+ conversations exist. |

---

## 3. Tech stack

| Layer | V1 | V2 | Why change (or not) |
|-------|----|----|---------------------|
| Framework | Next.js 15 App Router | Next.js 15 App Router | Same. Team knows it. SSR for landing page SEO. API routes for backend. |
| Language | TypeScript (strict) | TypeScript (strict) | Same. Non-negotiable. |
| Database | PostgreSQL (Prisma) | PostgreSQL (Prisma) — Supabase or Neon | Same ORM. Switch to managed hosting for zero ops. |
| LLM providers | OpenAI (primary) + Anthropic (fallback) | Both, per-task assignment via admin UI | Keep dual provider. V2 assigns provider per agent role via DB config, not globally. |
| LLM models | GPT-5, GPT-5-mini, GPT-4o-mini | Any model from either provider, admin-configurable | No hardcoded models. Agent table has provider + model fields. Admin UI dropdown to change. |
| Streaming | Fake (chunk + delay) | Real SSE from provider | Critical UX improvement. |
| UI | Tailwind + shadcn/ui (admin CRM) | Tailwind + shadcn/ui (consumer app) | Same toolkit, entirely new UI. Consumer-facing, not admin-facing. |
| Payments | None | Stripe + optional local (Netopia) | New. Required for checkout. |
| Auth | Admin auth only | Magic link (Supabase Auth) | Customer auth post-purchase only. No registration before checkout. |
| Email | None | Resend or Postmark | New. Confirmation, policy PDF delivery, reminders. |
| Hosting | Local dev | Vercel (frontend) + Railway (API) | Move to production hosting. EU region for GDPR. |
| Analytics | Turn traces only | PostHog + turn traces | Add funnel analytics alongside existing trace system. |
| Monitoring | None | Sentry | Error tracking for production. |

---

## 4. Data model (simplified from V1)

V1 has 45+ Prisma models. V2 launches with a focused subset (~26 models). Models are grouped by domain.

### 4.1 Core domain

| Model | Purpose | Key fields | Carried from V1? |
|-------|---------|------------|------------------|
| Product | Allianz product definition | code, name(json), description(json), eligibility(json), features, defaultPlaybook | Yes — direct port |
| PricingTier | Standard / Optim package | productId, code, name(json) | Yes |
| PricingLevel | Level I/II/III within a tier | tierId, code, name(json), premiumAnnual, currency | Yes |
| CoverageType | Type of coverage (death, accident, etc.) | code, name(json), category | Yes |
| CoverageAmount | Specific amount per level + age band | pricingLevelId, coverageTypeId, amount, minAge, maxAge, isAgeBased | Yes |
| Addon | BD treatment abroad addon | productId, code, name(json), coverages(json) | Yes |
| AddonPricingRule | Age-banded addon pricing | addonId, minAge, maxAge, premiumAnnual, currency | Yes |
| ObjectionStrategy | Objection handling playbook | type, title, strategy(text), addonContext | Yes |

### 4.2 Conversation and sales

| Model | Purpose | Key fields | Carried from V1? |
|-------|---------|------------|------------------|
| Customer | Person interacting with agent | name, email, phone, cnp(encrypted), dateOfBirth, address, language | Simplified from V1 |
| Conversation | One sales session | customerId, productId, status, channel, language, startedAt, completedAt | Simplified |
| Message | Single turn in conversation | conversationId, role(user/assistant/system), content, toolCalls(json), tokenCount | Yes |
| ConversationSummary | Compressed history for sliding window | conversationId, summary(text), messagesUpTo(int), tokenCount | New (V1 had agent but never used it) |

### 4.3 Workflow and questionnaire

| Model | Purpose | Key fields | Carried from V1? |
|-------|---------|------------|------------------|
| Workflow | Sales journey definition | code, name, steps (relation) | Yes |
| WorkflowStep | Single step in workflow | workflowId, code, name, allowedTools(json), agentInstructions | Yes |
| StepTransition | Condition-based step progression | fromStepId, toStepId, condition, priority | Yes |
| WorkflowSession | Active workflow instance | conversationId, workflowId, currentStepId, status | Yes |
| QuestionGroup | Group of questions (DNT / Application / BD) | code, name, productId | Yes |
| Question | Single question | groupId, text(json), type, options(json), validationRules(json), orderIndex | Yes |
| Answer | Customer's answer | questionId, conversationId, value, answeredAt | Simplified |

### 4.4 Quote and policy

| Model | Purpose | Key fields | Carried from V1? |
|-------|---------|------------|------------------|
| Application | Insurance application linked to conversation | conversationId, customerId, productId, tierId, levelId, addons(json), status | Simplified |
| Quote | Generated price quote | applicationId, premiumAnnual, premiumMonthly, coverages(json), validUntil, status | Yes |
| Policy | Issued policy after acceptance | quoteId, customerId, allianzPolicyNumber, status, issuedAt, expiresAt | Simplified |
| Payment | Premium payment record | policyId, amount, currency, stripePaymentId, status, paidAt | New |

### 4.5 Agent and observability

| Model | Purpose | Key fields | Carried from V1? |
|-------|---------|------------|------------------|
| Agent | LLM agent configuration | slug, name, type, provider, model, fallbackProvider, fallbackModel, temperature, maxTokens, systemPrompt, constraints | Yes — add provider/fallback fields + admin UI |
| ModelCatalog | Available models for dropdown | provider, modelId, displayName, supportsStreaming, supportsTools, costPer1kTokens | New — feeds admin config UI |
| TurnTrace | Per-turn pipeline snapshot | conversationId, messageIndex, phases(json), anomalies(json), cost, latencyMs | Yes |
| Referral | Referral tracking | referrerCustomerId, referredCustomerId, status, rewardApplied | New |

> V1 had 45+ models. V2 launches with ~26. Dropped: ConversionScore (unused), DetectedConcern (regex-based, replaced by gate), ConversationState (strategy agent removed), multiple admin/settings models. Add them back only if needed.

---

## 5. Agent architecture

V1 had 8 agents. V2 launches with 4, adds 2 more post-launch. Every agent's provider and model is configurable from the admin UI — no code changes or deploys needed to switch models.

### 5.1 Launch agents (P0)

| Agent | Role | Default model (admin-changeable) | Fallback (admin-changeable) | When it runs |
|-------|------|----------------------------------|----------------------------|--------------|
| main-chat | Customer-facing sales conversation. Romanian + English. | claude-sonnet (or gpt-5 via A/B test) | The other provider's equivalent | Every customer message. Real streaming. |
| reasoning-gate | Classifies turn complexity, selects prompt sections, detects concerns, guides tool usage. | claude-haiku (or gpt-5-mini) — cheapest available | The other provider's equivalent | Every customer message. <200ms target. Skip for trivial turns. |
| summarizer | Compresses older messages into a summary for sliding window. | claude-haiku (or gpt-5-mini) | The other provider's equivalent | When conversation exceeds 20 messages. Async. |
| profile-extractor | Extracts customer demographics from conversation. | claude-haiku (or gpt-5-mini) | The other provider's equivalent | Fire-and-forget after turns with personal info. |

> All default models above are starting points. The admin config UI (Section 5.3) lets you switch any agent to any model from either provider at any time. New models appear in the dropdown as soon as they're added to the ModelCatalog table.

### 5.2 Post-launch agents (P2)

| Agent | Role | When to add |
|-------|------|-------------|
| debrief | Post-conversation analysis: what worked, what didn't, customer memory update. | When you have 200+ completed conversations and want to start the learning loop. |
| re-engagement | Generates follow-up messages for abandoned conversations. | When you have enough drop-off data to make re-engagement meaningful. |

### 5.3 Agent model configuration (admin UI)

Each agent role is a row in the Agent table with configurable fields:

| Field | Type | Purpose |
|-------|------|---------|
| provider | enum (anthropic / openai) | Primary LLM provider for this agent |
| model | string (from ModelCatalog) | Primary model ID. Admin selects from dropdown. |
| fallbackProvider | enum (anthropic / openai) | Fallback provider if primary fails |
| fallbackModel | string (from ModelCatalog) | Fallback model ID |
| temperature | float 0.0-1.0 | LLM temperature. Slider in admin UI. |
| maxTokens | int | Max response tokens. Number input in admin UI. |
| isActive | boolean | Enable/disable agent entirely |

The ModelCatalog table contains all available models:

| Field | Type | Purpose |
|-------|------|---------|
| provider | enum | Which provider offers this model |
| modelId | string | API model identifier (e.g., claude-sonnet-4-20250514) |
| displayName | string | Human-readable name for dropdown (e.g., Claude Sonnet 4) |
| supportsStreaming | boolean | Whether this model supports SSE streaming |
| supportsTools | boolean | Whether this model supports function calling / tool use |
| supportsStructuredOutput | boolean | Whether this model supports json_object mode |
| costPer1kInputTokens | float | For cost tracking in turn traces |
| costPer1kOutputTokens | float | For cost tracking in turn traces |

When a new model is released by either provider, add a row to ModelCatalog. It immediately appears in the admin dropdown for any agent. No code change, no deploy.

**Cache behavior:** Agent configs are cached for 5 minutes in production. The admin UI has a "Flush cache" button for immediate effect during testing.

### 5.4 Per-turn pipeline (V2)

Simplified from V1's 16-step pipeline to 10 steps:

1. HTTP entry + auth (customer ID from session or anonymous)
2. Conversation resolution (get or create, load product)
3. Save user message to DB
4. Reasoning gate — classify turn, select prompt sections, detect concerns (skip for trivial turns)
5. Context assembly: product context + workflow prompt + questionnaire context + customer memory (only sections the gate requested)
6. Sliding window: last 20 messages full + summary of older messages
7. Dynamic prompt assembly (gate-driven section selection with token budget)
8. Main LLM call with streaming + tool execution loop (max 5 rounds)
9. Save assistant message + trigger async agents (profile extractor, summarizer if needed)
10. Turn trace save (fire-and-forget: phases, cost, latency, anomalies)

> Key difference from V1: Steps 4-7 are conditional. A simple "Da" answer to a questionnaire question triggers a fast path: skip reasoning gate, minimal prompt (agent identity + questionnaire context only), no playbook/coaching/memory. The full pipeline only runs for complex turns.

---

## 6. Prompt architecture

The prompt assembly system from V1 was well-designed. V2 keeps the 3-layer section registry but adds token budgeting and more aggressive section exclusion.

### 6.1 Three-layer model (carried from V1)

| Layer | Sections | Token budget | Always included? |
|-------|----------|-------------|------------------|
| Constitution | Agent identity, constraints, capability manifest, off-topic rules, customer autonomy rules | ~1,500 tokens | Yes — every turn |
| Reasoning | Situational briefing from reasoning gate (concern detected, priority action, tool guidance) | ~300-500 tokens | Yes if gate ran, No on fast path |
| Dynamic | Product context, coaching/playbook, workflow instructions, questionnaire context, customer memory, agent knowledge, customer context | ~1,000-5,000 tokens | Gate selects which sections. Budget enforced. |

### 6.2 Fast path vs full path

| Turn type | Path | Prompt size target | Sections included |
|-----------|------|--------------------|-------------------|
| Questionnaire answer (Da/Nu/selection) | Fast | ~2,000 tokens | Constitution + questionnaire context + workflow instructions. That's it. |
| Simple factual question about product | Medium | ~4,000 tokens | Constitution + reasoning briefing + product context + questionnaire context if active |
| Objection / emotional concern | Full | ~6,000-8,000 tokens | All sections. Coaching playbook, objection strategies, customer memory, full context. |
| Discovery / open conversation | Full | ~6,000-8,000 tokens | All sections including playbook and customer context. |

### 6.3 System prompt structure (V2)

The main agent system prompt is composed from these sections in order:

1. **AGENT IDENTITY** — Persona definition, core behaviors (carried verbatim from V1 extraction)
2. **CONSTRAINTS** — No invented links, no fake forms, no promises without actions, be honest (carried from V1)
3. **CAPABILITY MANIFEST** — What tools are available this turn (dynamically filtered by workflow gate)
4. **SITUATIONAL BRIEFING** — Reasoning gate output: what's happening, priority action, detected concerns
5. **PRODUCT CONTEXT** — Protect product details, pricing tiers, BD addon, relevant for current phase
6. **COACHING** — Sales playbook for current phase. Romanian scripts, price anchoring, BD value proposition
7. **WORKFLOW INSTRUCTIONS** — Current step, what needs to happen next, what tools to use
8. **QUESTIONNAIRE CONTEXT** — Current question, valid answers, validation rules, progress
9. **CUSTOMER MEMORY** — Returning customers: previous conversations, unresolved concerns (post-launch)
10. **AGENT KNOWLEDGE** — Learned insights: effective approaches, anti-patterns (post-launch)

---

## 7. Consumer web app

V1 was an admin CRM. V2 is a customer-facing product. Entirely new frontend.

### 7.1 Page structure

| Route | Auth | Purpose |
|-------|------|---------|
| / | Public | Landing page: hero hook, CTA to start conversation, trust indicators, Allianz badge |
| /chat | Public (anonymous session) | Conversation UI: full-screen chat, product cards inline, data collection inline, payment inline |
| /chat/[id] | Public (session-linked) | Resume an existing conversation |
| /dashboard | Authenticated | Post-purchase: policy card, documents, quick actions, referral link |
| /dashboard/documents | Authenticated | Policy PDF, suitability report, payment receipts |
| /dashboard/referral | Authenticated | Referral program: unique link, sharing, reward tracking |
| /admin | Admin auth | Concierge panel: new applications, Allianz submission, status updates |
| /admin/agents | Admin auth | Agent model configuration: provider/model dropdowns per agent role |
| /admin/conversations | Admin auth | Conversation browser with turn traces, anomaly flags |
| /admin/analytics | Admin auth | Funnel metrics, conversion rates, cost tracking |

### 7.2 Conversation UI specification

The conversation interface is the core product. Every design decision optimizes for conversion.

- Full-screen on mobile, centered 640px panel on desktop. Minimal chrome: logo top-left, close top-right.
- Agent messages: left-aligned bubbles. Typing indicator while LLM generates. Text streams in real-time.
- User messages: right-aligned bubbles. Auto-suggestion pills for common responses.
- Product cards: tiers displayed as tappable cards inline in chat. Price in RON/luna. Recommended tier highlighted.
- Data collection: inline form fields within chat (not a separate page). CNP validation. Address autocomplete.
- Payment: Stripe Elements embedded inline. No redirect.
- BD questionnaire: 6 yes/no cards within chat. Rejection handled sensitively.
- DNT: questions integrated into conversation flow. Signing is digital confirmation within chat.
- Success state: celebration animation, policy summary card, confirmation message.

### 7.3 Checkout flow (concierge model)

Since Allianz integration is manual, the checkout works as follows:

1. Customer selects tier + confirms BD addon inclusion in chat
2. Agent collects personal data conversationally (name, CNP, DOB, address, email, phone)
3. Agent presents summary: coverage + price + what's included
4. Customer confirms and enters payment card (Stripe Elements inline)
5. First premium charged immediately. Application record created with status pending_submission
6. Customer sees: "Polița ta se activează. Vei primi confirmarea pe email." Account auto-created.
7. Admin dashboard shows new application with all data pre-formatted for Allianz submission
8. Operator generates Allianz submission (pre-filled template), sends to Allianz
9. Allianz confirms → operator updates status to active, enters Allianz policy number
10. Customer receives: email with policy PDF + in-app notification

---

## 8. Build phases

Four sequential phases. Each phase produces a working increment. No phase starts until the previous one is complete.

### Phase A: Core engine

**Goal:** Working conversation with the AI agent that can sell Protect + BD addon end-to-end via API.

**Entry:** Extraction files available. Open decisions resolved (brand, payment processor, DB hosting).

**Exit:** Agent correctly handles discovery, DNT, application, BD questionnaire, quote generation, and all 9 objection types via API calls.

| Task | Output |
|------|--------|
| Next.js 15 project setup + TypeScript + Tailwind + shadcn/ui + CI | Repo with tooling configured |
| PostgreSQL + Prisma schema: all models from Section 4 | Schema migrated, ready for seeding |
| Seed scripts: Protect product data from extraction (product-catalog.json, medical-questionnaire.json, underwriting-flow.json) | Complete product data in DB matching V1 exactly |
| Seed scripts: objection strategies from extraction (objection-handling-ro.md) | All 9 objection types in DB |
| Seed scripts: workflow definitions (Sales Journey + Life Insurance workflows, steps, transitions) | Workflow engine data from V1 extraction |
| Seed scripts: agent configurations with default provider/model per role | 4 agent configs in DB |
| Seed scripts: ModelCatalog with all available models from both providers | Model dropdown data ready |
| LLM gateway: unified provider interface (OpenAI + Anthropic), per-agent config from DB, cached with flush | gateway.call() and TracedLLMClient working |
| Real SSE streaming: both providers | Streaming API returning tokens as they arrive |
| Tool pipeline: Zod validation → RBAC → workflow gate → handler → context refresh | Tool execution working for all tools |
| Actions as synthetic tool calls (unify action/tool paths) | One execution path for everything |
| Workflow engine: state machine with condition-driven transitions from DB | Workflow session tracking and step progression |
| Questionnaire engine: DNT, Application, BD medical questions from DB | save_answer, sign_dnt, BD rejection logic all working |
| Quote engine: tier + level + age + addon → premium + coverages | Accurate quotes matching V1 extraction logic |
| Objection handling: get_objection_strategy tool | All 9 types accessible |
| Reasoning gate: classify turn, select prompt sections, detect concerns (structured output, no regex) | Gate running with structured JSON response |
| Dynamic prompt assembly: 3-layer section registry, gate-driven selection, token budgeting | Fast path (~2K) and full path (~6-8K) working |
| Sliding window: last 20 messages + summarizer for older messages | No context overflow on long conversations |
| Turn trace: collector + fire-and-forget save + anomaly detection | Full observability per turn |
| Conversation API: POST /api/chat with streaming response | End-to-end conversation working via API |

### Phase B: Consumer UI + checkout

**Goal:** A customer can go from landing page to paid policy in one session in a browser.

**Entry:** Phase A complete. Brand identity finalized.

**Exit:** Full customer flow working: land → chat → select tier → provide data → pay → see confirmation. Admin can process applications.

| Task | Output |
|------|--------|
| Landing page: hero hook in Romanian, CTA, trust indicators, Allianz badge, mobile-first | Designed and built with brand identity applied |
| Conversation UI: full-screen chat, streaming display, typing indicator, auto-suggestion pills | Customer-facing chat interface |
| Product selector cards: tiers as tappable cards inline in chat, RON/luna pricing, recommended highlighted | Tier selection working in conversation flow |
| Inline data collection: name, CNP (with validation), DOB, address (autocomplete), email, phone | Form fields within chat, all validation working |
| BD medical questionnaire: 6 yes/no tappable cards, sensitive rejection messaging | Medical questions as cards, rejection flow working |
| DNT flow: regulatory questions integrated in conversation, digital signing | DNT compliance complete within chat |
| Stripe payment: Elements embedded inline in chat, first premium charged | Payment working end-to-end |
| Post-payment: application record created, auto-account creation, confirmation email sent | Customer gets account + confirmation automatically |
| Admin concierge panel: applications list, customer data view, generate Allianz submission template | Operator can see and process applications |
| Admin agent config: provider/model dropdown per agent role, temperature slider, flush cache button | Agent model configuration from browser |
| Policy activation: operator updates status, enters Allianz policy number, triggers notification | Full lifecycle from payment to active policy |
| Customer dashboard: policy card, documents section, quick actions | Authenticated post-purchase area |
| Email system: confirmation, policy PDF delivery, status updates | Transactional emails working |

### Phase C: Agent tuning + compliance

**Goal:** Agent sells correctly in Romanian, compliance is airtight, performance is optimized.

**Entry:** Phase B complete. Full customer flow working in browser.

**Exit:** Agent passes all E2E tests. IDD compliance verified. Performance targets met.

| Task | Output |
|------|--------|
| Port sales playbook scripts from extraction into system prompts (sales-playbook-ro.md) | Romanian conversation scripts active in agent |
| Port objection handling from extraction (objection-handling-ro.md) — verify all 9 types work | Agent handles all objections correctly in Romanian |
| E2E test suite: port scenarios from extraction (test-scenarios.md, client-simulator.md) | Automated test suite running against real agent |
| Run E2E tests: happy path, BD rejection, objection handling, change of mind, DNW flow | All scenarios passing |
| Agent script iteration: run conversations, analyze drop-offs, adjust Romanian scripts | Conversation-to-quote rate >40% |
| IDD compliance: DNT suitability report PDF auto-generation | PDF generated for every completed sale |
| IDD compliance: all mandatory disclosures verified in conversation log | Disclosures confirmed by automated check |
| GDPR: consent flow, data encryption verification, deletion endpoint | All PII encrypted. Consent collected. GDPR compliant. |
| Performance: prompt economy verification, fast path for simple turns | Average prompt <4K tokens across all turns |
| Performance: streaming latency optimization | P95 first-token latency <500ms |
| A/B test setup: main-chat agent on Claude Sonnet vs GPT-5, measure conversion by provider | Both providers running, metrics tracking |

### Phase D: Deploy + soft launch

**Goal:** Real customers, real money, real policies.

**Entry:** Phase C complete. All E2E tests passing. Compliance verified.

**Exit:** Policies being issued. Conversion data flowing. Iteration cycle running.

| Task | Output |
|------|--------|
| Production deployment: Vercel (EU) + Railway/Render + Supabase/Neon. Domain, SSL, DNS. | Production environment running |
| Monitoring: Sentry error tracking + PostHog funnel analytics + turn trace dashboard | Visibility into errors, funnels, agent performance |
| Facebook ad campaign: 5 hook variations targeting 25-45 Romania, limited budget | Ads running, traffic flowing to landing page |
| Manual Allianz submission SOP: documented process, SLA targets for operator | Operator can process applications reliably |
| Soft launch: limited traffic, monitor conversations, fix issues | First real policies issued |
| Iterate: adjust agent scripts based on real conversation data, optimize conversion | Improving conversion based on real data |

---

## 9. Porting guide (extraction → V2)

Specific instructions for what to take from each extraction file and how to adapt it.

| Extraction file | What to port | What to change |
|-----------------|-------------|----------------|
| product/product-catalog.json | ALL product data: tiers, levels, pricing, coverages by age band, addon pricing, quote calculation logic, payment frequency options | Convert to Prisma seed script. Keep exact data structure. Port quoteCalculationLogic into TypeScript function. |
| product/medical-questionnaire.json | ALL 6 questions with Romanian + English text, rejection logic, flag actions | Seed as QuestionGroup + Questions. Port rejectionLogic into tool handler. |
| product/underwriting-flow.json | DNT questions (consent + life-specific), Application questions, branching logic | Seed as QuestionGroups. Port conditionalLogic into questionnaire engine. |
| playbook/sales-playbook-ro.md | Entire 6-phase playbook with Romanian scripts, customer signal awareness, pacing rules, customer autonomy rules | Becomes coaching section of system prompt. Adapt for provider-agnostic prompting. |
| playbook/objection-handling-ro.md | All 9 objection types with full Romanian response strategies | Seed as ObjectionStrategy records. No changes to strategy text. |
| playbook/qualification-rules.md | Budget → product mapping, total cost scenarios, upgrade paths | Embed in coaching prompt section. |
| prompts/main-agent-prompt.md | Core behaviors, signal awareness, constraints, autonomy rules, off-topic handling, capability manifest | Becomes V2 constitution layer. Remove provider-specific phrasing. Keep behavioral rules. |
| prompts/synthesizer-prompt.md | Reasoning gate prompt structure, output format, concern categories, tool guidance | Adapt for structured output (tool_use). Remove regex-dependent JSON format. |
| prompts/prompt-composition.md | Section registry, priorities, gate-driven selection, formatting helpers | Port to V2 prompt builder. Reduce from 13 to 10 sections. |
| schemas/prisma-schema.prisma | Workflow, WorkflowStep, StepTransition, Question, QuestionGroup structures | Simplify. Keep workflow engine models verbatim. Simplify Customer/Conversation. |
| tests/test-scenarios.md | Happy path, questionnaire, objection, BD rejection, change-of-mind scenarios | Port to V2 test framework. Adapt API endpoints. |
| tests/client-simulator.md | Client persona, LLM-generated response logic, predefined answer maps | Port simulator. Adapt for V2 API. Keep answer maps. |

---

## 10. Risk register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Agent makes incorrect product claims or pricing | Medium | Critical | All product data from DB via tools, never from LLM knowledge. Automated test compares quotes against known-correct values. |
| Allianz rejects manual volume or changes submission process | Medium | High | Negotiate volume agreement before launch. Build toward API integration. |
| Conversion rate below 3% end-to-end | Medium | High | A/B test 5+ opening hooks. Iterate on agent scripts using drop-off data. Test both providers for Romanian quality. |
| LLM provider outage during peak traffic | Low | High | Per-task failover. Circuit breaker. Customer never sees an error. |
| Romanian language quality varies between providers | Medium | Medium | A/B test both providers for main-chat. Measure conversion by provider. Use whichever wins. |
| GDPR/ASF regulatory challenge | Low | High | Full IDD compliance from launch. DNT and suitability report auto-generated. All conversations logged. |
| Context window overflow on long conversations | Medium | Medium | Sliding window + summarizer. Token counting in prompt builder. |
| Customer distrust of AI agent | Medium | High | Never hide AI. Quality of conversation builds trust. Customer autonomy rules prevent pushiness. |
| Payment fraud or chargebacks | Low | Medium | Stripe fraud detection. CNP validation. 30-day cooling-off period communicated. |
| Team bandwidth | Medium | High | Prioritize ruthlessly. Phase A is mechanical translation from extraction. Phase B needs design judgment. Phase C needs human testing. |

---

## 11. Open decisions (blockers)

These must be resolved before Phase A starts:

| # | Decision | Options | Blocks |
|---|----------|---------|--------|
| 1 | Brand name | Vela / Alder / Zizoo / other | Phase B (UI), domain, all marketing |
| 2 | Default LLM for main chat | Claude Sonnet vs GPT-5 (can A/B test later) | Phase A (default config) |
| 3 | Payment processor | Stripe vs Netopia/mobilPay | Phase B (checkout) |
| 4 | Database hosting | Supabase vs Neon vs self-hosted | Phase A (schema setup) |
| 5 | Allianz submission format | Email template? Their portal? PDF form? | Phase B (admin panel) |
| 6 | ASF regulatory posture | Insurance broker vs agent vs intermediary | Phase C (compliance) |
| 7 | Team structure | Solo + Claude Code vs hire devs | All phases |
| 8 | Initial ad budget | Scale of soft launch spend | Phase D |

---

## 12. Launch criteria

The product launches when ALL of these are true:

1. A customer can go from landing page to paid policy in one session without human intervention (except Allianz backend)
2. The agent correctly handles all 6 tiers, BD addon pricing by age, and the medical questionnaire with rejection logic
3. The agent produces accurate quotes matching the V1 quote engine output for all tier/level/age/addon combinations
4. DNT suitability report is auto-generated as PDF for every completed sale
5. All 9 objection types are handled correctly in Romanian using ported strategies
6. Payment is collected and admin can process Allianz submission
7. Customer receives confirmation email and can access policy on dashboard
8. P95 first-token latency is under 500ms
9. E2E test suite passes: happy path + BD rejection + at least 3 objection scenarios
10. Monitoring (Sentry) and analytics (PostHog) are live in production
11. Agent model configuration is changeable from admin UI without deploy
