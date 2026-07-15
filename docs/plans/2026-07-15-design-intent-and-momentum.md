# Design: Durable Purchase Intent + Funnel Momentum (T8)

**Status:** ruling (autonomous run); governs the momentum family (T13, T16, T19) and the prompt's ADVANCING conduct.
**Evidence:** after the DNT signature the agent asked "Ești gata să continuăm?" (msg 39) although the customer committed at msg 10 ("da hai sa mergem mai departe") and `set_application` was already exposed — intent existed only in prose. Grounding frame: Zeno is a SALES agent; a lost step is lost revenue; compliance lives in well-built tools, never in redundant confirmation prose.

## 1. Intent is a ledgered commit

New model + tool (migration `live_test_hardening`):

```prisma
model PurchaseIntent {
  id             String    @id @default(cuid())
  customerId     String
  conversationId String
  goal           String    // 'quote' | 'purchase'
  productCode    String
  config         Json?     // {tier?, level?, addon?} — advisory, selection truth stays with select_coverage
  status         String    @default("active") // active | fulfilled | stale | renounced
  capturedAt     DateTime  @default(now())
  renewedAt      DateTime?
  customer       Customer  @relation(fields: [customerId], references: [id])
  @@index([customerId, status])
}
```

Tool `set_purchase_intent` (commit, `sideEffect:'save'`, exposed from DISCOVERY on): the model calls it THE MOMENT the customer commits to buying or to a quote ("vreau să-l cumpăr", "fă-mi o ofertă", "hai să mergem mai departe" in a product context). A newer intent marks the prior `stale`. `accept_quote` applied → active intent `fulfilled`. Explicit customer withdrawal → `renounced` (same tool, `{renounce:true}`).

## 2. Prerequisites are consequences of intent

With an ACTIVE intent, DNT → application → coverage → questionnaire → medical sign → quote are CONSEQUENCES the agent executes without re-asking. The ONLY pauses are regulated express acts whose UI is itself the question: sign cards (DNT, medical), OTP entry, ID upload, acceptance, payment. Asking "are you ready?" before a step that has a card is a defect (the card IS the ask).

## 3. Momentum mechanics (deterministic > prompt)

1. **Action turns run the standard tool loop** (T13/P3.1): the GUI synthetic path currently executes one tool then narrates WITHOUT tools (orchestrator.ts:999-1002) — post-click chaining was structurally impossible (the T13 refusal). After the change, a card click (e.g. medical sign) flows into normal rounds: exposure re-derived, round-refresh `[State update]` injected, model can chain `generate_quote` in the same turn.
2. **Briefing surfaces the intent** (situationalBriefing): `Active intent: purchase protect (standard/level_1 + addon) — captured 2026-07-15. The customer has already committed; do NOT re-ask. Next: <nextBestAction>.`
3. **Constitution directive** (ADVANCING TO THE OFFER): with an active intent, never ask readiness questions ("Ești gata să continuăm?"); proceed; the only pauses are the cards. Capture intent via `set_purchase_intent` when commitment happens.
4. **`_autoChain` single-hop**: a commit handler may declare `data._autoChain = {tool, args}`; the orchestrator executes that ONE follow-up through the normal pipeline (gateway legality, ledger, uiAction emission) before the LLM rounds. Used where the follow-up is a deterministic consequence, not a judgment: contact-field submit → `start_channel_verification` (T19), OTP confirm → `request_document_upload` (T27). Single hop only — chains of judgment stay with the model inside the tool loop.

## 4. Freshness

- **Same-session** (intent.conversationId === current): never re-ask, regardless of age.
- **Cross-session or stale** (different conversation, or capturedAt > 7 days): do not silently assume — RENEW WITH CONTEXT. Briefing renders the renewal script from data: `Acum ${daysAgo} zile te interesa ${productCode} (${configSummary}) — lipsea ${missingThen}; acum ${missingNow === none ? 'totul este pregătit' : missingNow}. Continuăm?` One question, anchored in recorded state, then proceed or mark `renounced`.

## 5. Read exposure

Snapshot slice `intent: {goal, productCode, config, capturedAt, sameSession} | null` (snapshot-loader); `get_current_state` includes it; situationalBriefing renders it (stateGrounding stays the 4-fact section).

## 6. Consequence-planner verdict (evaluated, rejected as substrate)

`lib/engines/consequence-planner.ts` is a single-mutation, within-application engine (nodes = `answer:<CODE>`/`selection:<facet>` of ONE application; consumed by exactly 3 write handlers). It has no vocabulary for cross-tool sequencing or goals. The chaining substrate is instead: `deriveAndExpose`'s objective machinery (`GOAL_ACTIONS`/`NEXT_BEST_PRIORITY`, derive-and-expose.ts:336-376) + the tool loop with round-refresh + the intent briefing. The planner remains what it is — the questionnaire's mutation engine.
