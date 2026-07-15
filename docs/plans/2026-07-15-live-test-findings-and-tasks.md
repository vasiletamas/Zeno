# Live sales-test findings & task inventory — 2026-07-15

**Source:** a full end-to-end manual sales test on `main`, driven by Vasile as the customer with turn-by-turn evidence analysis. One conversation went greeting → discovery → DNT (signed) → application → medical declarations (signed) → quote → identity/OTP → disclosures → acceptance → ID upload → payment → **Policy created (PENDING_SUBMISSION)**.

**Evidence trail:** conversation `cmrm3fgku00056g0y4eb2hsme` in the dev DB — every claim below is grounded in its `TurnDebug` payloads, `CommitLedger` rows, and domain rows. Use `npx tsx scripts/diagnose-conversation.ts cmrm3fgku00056g0y4eb2hsme --json` and the `diagnose-conversation` skill to re-verify anything. **Never diagnose from prose; read the recorded state.**

## Environment facts (as left at session end)

- Dev DB: docker `zeno-db-1`, port 5435. Was **reset** this session to the clean `baseline_main + v3_upgrade` migration chain + full reseed (`npx prisma migrate status` → clean). Pre-reset backup: `backups/zeno-pre-v3-reset-2026-07-15.dump` (14.9MB, pg_dump custom format). `/backups/` is gitignored (added this session).
- Dev server: `.claude/launch.json` → `zeno-dev`, port **3001**.
- Providers (`.env`): `EMAIL_PROVIDER=mock` (code logged to console + `lastMockEmailTo` seam + `/api/dev/last-verification-email`), `PAYMENT_PROVIDER=mock` (getPaymentStatus always returns completed), `DOCUMENT_EXTRACTION_PROVIDER` unset → mock (returns empty fixture → documents auto-validate with zero verified fields).
- Main Chat Agent model: **OPENAI / gpt-5.6-sol** (live DB row; seed still says gpt-5.4 — see task 3). ModelCatalog has a gpt-5.6-sol row with **placeholder** pricing (gpt-5.4's numbers — task 2).
- **UNCOMMITTED working-tree changes** (task 1): `lib/llm/providers/openai.ts` (gpt-5.6-sol quirk: forces `reasoning_effort:'none'` on tool-bearing calls — /v1/chat/completions 400s otherwise), `__tests__/lib/llm/openai-reasoning-tools-quirk.test.ts` (5 tests, green; full llm suite 43/43 green), `.gitignore` (+/backups/), and this document.

## Methodology contract (non-negotiable, from the user's global rules + project memory)

- Plan first (writing-plans), then implement ALL tasks to completion without pausing to ask "continue?" — TDD per task (failing test first), one logical change per commit, commit each task when green.
- "Build succeeds" is never verification. Run the test suite AND runtime-verify: the scripted sims + browser verification via the preview tools caught what unit tests missed, repeatedly, tonight.
- Verify assumptions from source (schema, recorded payloads) before coding. Effort is not a decision factor — decide on architectural merit.
- Diagnostics ratchet rule: when a task adds a checker (tasks 11, 13, 16, 29, 30), add it to `lib/diagnostics/` TEST-FIRST; the catalog only grows.

## Architecture laws distilled from the night (govern many tasks)

1. **UI for acts, prose for talk** — anything that commits state gets a deterministic card; the model only narrates. Cards ride commits (auto-emitted in tool results as `_uiAction`), never model initiative.
2. **Single-confirmation principle** — for any signable artifact, the ONLY confirmation is the signature/action click on an auto-appearing review card. No prose confirms, no "are you ready?" preludes, no confirmation-on-confirmation.
3. **Capability truth lives in exactly one place (the schema)** — the agent tries tools and trusts their errors; it never adjudicates its own documentation. Manifest text derives from runtime config.
4. **Fresh evidence supersedes stale snapshots** — a successful tool result within a turn overrides the turn-start state section.
5. **Emission↔renderer↔adapter parity is testable** — every uiAction type emitted must have a client renderer; every action type a client posts must have an adapter case. Enforce with static tests.

---

## TASK INVENTORY (30 tasks, as filed during the session)

### Phase 0 — housekeeping (do first)

**T1. Commit the gpt-5.6-sol provider quirk fix + test.** Uncommitted on main: `lib/llm/providers/openai.ts` (reasoning_effort:'none' forced on tool-bearing calls for gpt-5.6-sol), `__tests__/lib/llm/openai-reasoning-tools-quirk.test.ts` (5 tests green), `.gitignore` (/backups/), this doc. Commit before anything else touches the tree.

**T2. Replace placeholder gpt-5.6-sol pricing in ModelCatalog.** Row was inserted with gpt-5.4's pricing (0.003/0.015 per 1k) as placeholder — turn costs computed from it are wrong. Get real pricing, update the row, add to `prisma/seeds/seed-model-catalog.ts`.

**T3. Decide whether gpt-5.6-sol survives reseeds.** `prisma/seeds/seed-agents.ts` still sets main-chat to gpt-5.4; any reseed reverts the live switch. If permanent → update seed; if experimental → document.

**T4. Chat widget: Enter/Return does not send the message.** Typing + Return leaves text in the input (verified); only the Send button works. Decide intent; if Enter-to-send is wanted, fix the input's keydown handling.

### Phase 1 — design standards (govern the card family)

**T12. Questionnaire UX Standard — ONE uniform model for ALL questionnaires (DNT, application/medical, future).** User ruling; T7/T9/T10/T11 are implementation slices. Contract: (1) entry card auto-emits deterministically (no prose-only entry); (2) questions render ONLY on cards, agent prose ≤ one transition line, never repeats question/options (conduct instruction embedded in every tool-result `_message`, as DNT already does); (3) card click primary, typed fallback via same write tool, every write ledgered, validation-reject re-emits the same card; (4) NAVIGATION: customer can revisit/change any answered question — rides existing invalidation semantics (`write_question_answer` returns invalidations/questionsAdded/Removed) + CONFIRM_ON_MODIFY; (5) completion ALWAYS auto-emits a summary card (all Q+A), never model-initiated; (6) confirmation: exactly ONE — the confirm/sign button on the summary card (confirmToken two-step for signatures; required consents as unchecked checkboxes on the same card gating the button); (7) model narrates only. **Deliverable: a shared module used by dnt-handlers and application-handlers so the standard holds by construction.**

**T8. Intent capture: durable purchase-intent state + funnel momentum (no re-asking).** Evidence: after DNT signature the agent asked "Ești gata să continuăm?" though the customer committed at turn 6 and `set_application` was ALREADY exposed; intent existed only in prose. Design: (1) intent as a ledgered commit `{goal: quote|purchase, productCode, config{tier,level,addon}, capturedAt, status: active|fulfilled|stale|renounced}`; (2) prerequisites are consequences of intent — with an active intent the agent chains DNT→application→medical→quote WITHOUT re-asking, pausing ONLY at regulated express acts (whose UI is the question); (3) freshness: same-session → never re-ask; cross-session/stale → renew WITH CONTEXT ("Acum 10 zile te interesa X, lipsea DNT-ul — acum îl avem. Continuăm?"); (4) read tool / stateGrounding exposure of active intent. Evaluate `lib/engines/consequence-planner.ts` as the chaining substrate. Governing frame: Zeno is a sales agent; compliance via well-built tools, never redundant confirmation prose.

### Phase 2 — card/parity family (implement per T12)

**T7. DNT completion → single review/sign card.** On the final `write_dnt_answer` (complete:true) auto-emit the review card: compact recap of all session answers + TWO unchecked checkboxes (GDPR processing + AI-disclosure ack — GDPR requires affirmative action, pre-ticked is void) + Sign button disabled until both checked. Maps 1:1 onto the existing `sign_dnt` contract (`confirmSignature` + `consent:{gdpr,aiDisclosure}` — dnt-handlers.ts:447-462); atomic commit semantics preserved (Dnt + session SIGNED + 3 ConsentEvents in one tx). Evidence: mid-questionnaire results carry `_uiAction`, the completion result does not — that asymmetry caused the prose round-trips.

**T9. Application questionnaire entry card + no prose doubling.** Cards DO exist on the app path (write_question_answer emits show_question, application-handlers.ts:355) but the ENTRY read `get_next_question` (application-handlers.ts:132) emits NO uiAction → first question is prose-only (verified: HEALTH_DECLARATION_CONFIRM had no card). Fix: emit the card from the entry read (or at set_application commit, mirroring open_dnt_session). ALSO: application result `_message`s ("Answer saved. N remaining.") carry no conduct instruction, unlike DNT's ("NEVER list the options in prose...") → the model prints the question above every card. Embed the same no-doubling instruction. Keep: validation-reject re-emits the same card; verify reload re-derives the pending card.

**T10. Medical-history cards: default "No" (NO-type questions).** User wants preselect-No for one-click flow. Tension to resolve at implementation: answers are hashed into the signed MedicalDeclarationSignature — preselected "safe" answers invite click-through and claims disputes. Options: (a) preselect No + explicit per-question confirm; (b) No rendered as primary action, not preselected; (c) insurtech bulk pattern: ONE card listing all 6 conditions + "Niciuna dintre acestea nu mi se aplică" + individual toggles. User decides at implementation; (c) may serve the speed goal best.

**T11. Hallucinated-card bug: medical declarations completion stranded.** After the 7th answer, the completion result instructed "sign_medical_declarations must confirm them (one card)" with NO uiAction; the model wrote "pe cardul afișat" WITHOUT calling the tool — card never existed; customer stranded until manual "confirm declarațiile". SINGLE-CONFIRMATION PRINCIPLE (user ruling): the signature click on the auto-appearing review card is the ONLY confirmation. Fix: (1) engine — completion with pending declarations deterministically surfaces the review/sign card; (2) constitution — model may only reference "cardul afișat" when a uiAction was emitted THIS turn; narration of an emitted card is ≤ one invite line; (3) diagnostics ratchet: `hallucinated_ui_reference` check (assistant references a card in a turn whose tool results carried no uiAction).

**T15. Offer-card conversion moment: prose sells, card informs.** show_quote card renders the full offer AND the agent repeats prices/coverages in prose. Desired: card carries ALL numbers; prose carries ONLY short personalized persuasion anchored to CustomerInsight (addonInterest 0.92, budgetSensitivity high → streaming-subscription framing from product content; lead with the 2M EUR benefit). Embed conduct instruction in generate_quote's `_message`. Fix card rendering: per-day coverages show bare numbers without units ("Spitalizare accident: 20 RON", "Indemnizație zilnică: 100 EUR") — must render "/zi" + caps (max 60 zile/eveniment, 90 zile/an, franșiză 3 zile).

**T19. Channel verification: auto-send code on field submit + code-entry card.** After the customer submitted their phone in a field labeled "for identity verification", the model asked "trimit codul...?" in prose (start_channel_verification WAS available). Fix: submitting the contact field IS the consent; auto-send + code-entry card ("cod trimis la 0735•••607", 6-digit input, [Retrimite], [Folosește emailul]) — channel choice is an escape hatch ON the card, never a pre-question.

**T22. History rendering: card interactions show as raw [Action: …] after reload.** Reloaded history renders "[Action: answer_question]", "[Action: sign_dnt]" as user bubbles; question cards and chosen answers absent — customer can't see what they answered/signed. Fix: render history interactions from existing data (DntAnswer/Answer rows + CommitLedger targetRef → compact "question → answer" chips; signatures → "Analiza semnată ✓ <ts>"); never show [Action: *] to customers. Coordinate with T12 so live and reloaded renderings match.

**T23. Disclosure ack + payment frequency join the acceptance card.** acknowledge_disclosures is a ledgered commit — currently typed prose ("am citit documentele"). Acceptance card: offer recap + in-app-viewer document links (needs T21) + ONE checkbox "Confirm că am citit și înțeles IPID și Termenii" (commits acknowledge_disclosures) + payment-frequency selector AS A COMPARISON from the quote's precomputed fields (Anual 540 | Semestrial 270×2=540/an | Trimestrial 135×4=540/an — equal totals is itself a selling point; never a blind prose question) + Accept button disabled until checked.

**T29. Missing renderer: show_document_upload silently dropped.** request_document_upload emitted `uiAction {type: show_document_upload, payload: {kind, uploadUrl: /api/documents/upload}}` (twice, ledgered) but `components/chat/rich/rich-content.tsx` has NO case for it → nothing renders; customer told "Folosește controlul securizat afișat" with nothing on screen. Fix: (1) add the renderer (secure file-picker card, multipart POST, progress + validation outcome); (2) defensive default — unknown uiAction types render a visible fallback + anomaly log, never vanish; (3) PARITY RATCHET (test-first): static test enumerating every uiAction type emitted by lib/tools/handlers/** asserting rich-content has a case for each.

**T30. Mock payment path never settles + payment_complete action unknown.** `payment-card.tsx` handleMockPayment (~line 420) fakes 2s then calls onPaymentComplete WITHOUT POSTing `/api/payments/confirm` — the verified-settlement inbox (which mints the Policy in-transaction) never runs; onPaymentComplete → rich-content.tsx:308 posts chat action `{type:'payment_complete'}` → `lib/chat/action-adapter.ts` has no case → POST /api/chat 400 "Unknown action type" at the moment of paying. Fix: (a) mock path POSTs /api/payments/confirm then signals (mirror Stripe branch, payment-card.tsx:149); (b) add payment_complete adapter case (notify-turn: call get_payment_status, narrate outcome/policy); (c) extend T29's parity ratchet in BOTH directions (component-posted actions ↔ adapter cases).

### Phase 3 — reasoning/prompt correctness

**T5. Robotic first-turn greeting.** gpt-5.6-sol reproduced FIRST_TURN_RULES' "reference opening" word-for-word — every customer gets an identical canned greeting. Rephrase seed section (prisma/seeds/seed-agents.ts) to style guidance + required elements (name, automated-system disclosure, ONE open question, no products/insurer) + "vary the wording; do not reproduce the example verbatim".

**T13. Stale-gate reasoning: tool results supersede turn-start state.** After sign_medical_declarations committed mid-turn (result: "The quote can be generated now"), the model refused generate_quote (zero attempts) and told the customer "calcularea nu poate fi finalizată în această conversație" (false) — it obeyed the stale turn-start manifest because the constitution's ground-truth rule has no supersession clause. Fix candidates: (1) constitution supersession clause (freshest evidence wins); (2) engine: after each applied commit, inject a structured state-delta into the tool result ("unblocked: generate_quote"); (3) diagnostics ratchet: `stale_gate_claim` (assistant claims unavailable while a same-turn tool result declared it available). Note: gateway legality evaluates at call time — an attempt would have succeeded.

**T16. Self-repair loop: detect claim-vs-state contradictions and auto-retry.** Same class as T13, detection+repair side: (1) outbound guard (deterministic, orchestrator-level, pre-emission): scan drafted reply for impossibility/blocked claims about funnel actions, check against CURRENT derived gate (grounding-guard.ts is precedent); (2) on contradiction: one-shot self-repair re-invocation with injected correction; cap 1 retry; ledger `self_repair_triggered` anomaly; (3) T13's offline check doubles as the detector's twin. Frame: a false "I can't" at a funnel step is lost revenue.

**T20. Single source of truth for channel availability (SMS disagreement).** The agent OFFERED an SMS code, then on "da" refused with "SMS nu este disponibilă momentan" — ZERO tool calls. Three layers disagree: manifest advertises "email or phone"; handler (identity-handlers.ts:22-27) hard-rejects sms with a legible redirect ("not available yet — verify the EMAIL address instead"); constitution's over-broad "You cannot: Send emails, SMS, or documents" made the model refuse WITHOUT calling (and its email offer 'violates' the same clause). Fix: (1) schema-level — restrict channel arg to 'email' while SMS unimplemented; derive manifest text from provider config; (2) scope the constitution clause to free-form messaging (system-generated codes/documents via dedicated tools always allowed); (3) conduct principle: when a tool exists for the request, TRY IT and trust its error.

### Phase 4 — quote-engine integrity

**T14. Quote auditability: freeze full rating-input snapshot at issuance (user: ASAP).** Rating used age 40 derived from declared CNP → band 31-45 → addonDelta 350, but NONE of {ageUsed+source, band, delta, component premiums, pricing content versions, medical answersHash, DNT id} is recorded on the Quote — re-derivation drifts. Application.frozenAt freezes answers/selection; this adds the rating COMPUTATION record (ratingInputs on Quote or QuoteRatingRecord). Contract: no rating factor may be re-derived after issuance.

**T17. Replace fantasy BD-addon rate card with real product rates.** Engine verified correct (quote-engine.ts sums base + AddonPricingRule by age band; throws on unmatched band): 190+350=540. But the seeded AddonPricingRule values (200/350/500/700 RON) are the REAL product's EUR values mislabeled as RON (350 EUR ≈ 1750 RON). Obtain the real rate card; reseed in TRUE denomination (EUR — see T18); pricing-examples.ts derives from the rules (auto-propagates). Cascade check: Product.pricingExampleGrid seed data; authored positioning ("streaming subscription" framing breaks at ~140 lei/month); sim assertions pinned to old premiums.

**T18. Currency model + FX reference for the quote engine.** Engine is currency-blind: `premiumAnnual = base + addon` naked sum, no consistency check; PricingLevel.currency/AddonPricingRule.currency columns exist but are never read; NO FX table anywhere. Romanian market pattern: tariffs in EUR, premiums payable in RON at a reference rate. Fix: (1) currency guard — rating throws on mixed-currency inputs absent an explicit conversion; (2) FX reference (BNR daily vs contract-fixed — business decision) + conversion step; tariff vs payment currency distinct; (3) fx rate used + date + source frozen into T14's snapshot; (4) coordinate with T17 (seed in EUR, engine owns conversion).

### Phase 5 — identity & onboarding redesign

**T28. Slim early identity collection (data minimization).** (1) REMOVE DNT_CNP from seed-questions.ts — CNP never asked by mouth; (2) quote uses declared AGE asked directly (rating snapshot records ageUsed+source=declared); (3) pre-acceptance collection shrinks to phone+email ONLY; name/DOB arrive via ID extraction (T27) with stronger provenance; (4) reconcile at issuance: declaredAge vs document DOB via the existing conflict slots — band-changing mismatch → re-rate or refer. Replaces current flow (DNT asks masked CNP at Q4; accept-gate collects name+DOB+email+phone).

**T26. Account creation after email verification + returning-user OTP re-auth.** (a) On confirm_channel_verification success, create a real account (today isAnonymous stays true, no login exists); (b) when a chat session starts with a zeno_session cookie pointing at an authenticated account holder, do NOT silently resume — ask for OTP re-auth in-chat (reuse challenge primitive + OTP card); success → bind session to account; decline → fresh anonymous conversation. Cross-refs: claim-merge in /api/session, T21(c) resume semantics.

**T27. ID-document upload after email verification → extraction completes the profile.** After email OTP, ask for ID upload; extract name/DOB/CNP/address → CustomerProfileField with document-grade provenance + conflict detection (conflictValue/Source columns exist); document stored + listed in account zone. Machinery exists: CustomerDocument model, request_document_upload tool, document-pipeline.ts (deterministic checks: expiry, CNP checksum, declared-vs-extracted; findings → DOCUMENT_REVIEW WorkItem), extraction-provider seam (mock returns empty fixture in dev → rubber-stamp validated). PLACEMENT EVIDENCE: current engine gates payment on identity (`ensure_payment_session → requires_identity, needs: [document:id_card]` from Product.verificationRequirements) so the ID demand ambushes the customer AT THE PAYMENT MOMENT — front-load at account bootstrap so the money moment is frictionless.

**T21. Disclosure documents: 401 for chat customers + navigation destroys the funnel (production-severity).** (a) AUTH MISMATCH: chat sessions hold zeno_session (raw customer id); GET /api/documents/[id] demands the zeno_auth JWT (login-issued) → every disclosure link 401s for the very customer required to read them (curl no-cookie → 401 reproduced). Note: /api/documents/upload ACCEPTS zeno_session — inconsistent. Fix: accept zeno_session for owned + STATIC_PER_PRODUCT_VERSION docs, or signed URLs, or (best) in-app viewer card. (b) links render as bare markdown anchors navigating the SPA away. (c) FUNNEL LOSS: /chat entry always creates a NEW conversation instead of resuming the customer's open one (evidence: empty conv minted on re-entry while the real one sat mid-funnel with an issued quote) — resume-by-default; new-conversation is a deliberate action. (d) router artifact: back-nav requested /chat/<documentId> → 404. Recovery that worked: direct /chat/<conversationId>.

**T25. Customer account zone: document library.** List all customer documents (policy docs, signed DNT, medical declarations, acknowledged IPID/Terms versions, quotes, receipts — SUITABILITY_REPORT and PAYMENT_RECEIPT already exist as rows born at settlement). Depends on T21 auth + T26 account. Grouped per product/application; open-in-viewer + download.

**T6. Customer-memory coverage: promote DNT facts to profile/insights.** The profile-extractor IS alive (wrote 2 insights: addonInterest 0.92, budgetSensitivity 0.63 — the latter inferred from price reasoning, never stated). The gap: rich declared DNT facts (occupation=entrepreneur, family_size=3, minor_children=1, education=postgraduate, income_source) stay stranded in DntAnswer — none promoted to CustomerProfileField (only CNP was) or insights. Precedent IN CODE: sign_dnt already lifts the marketing answer to a customer-level ConsentEvent ("never stays trapped there"). Design the promotion rule: which questionnaire answers become durable profile fields (provenance=declared, source=dnt) vs insights; audit extractor scope.

### Phase 6 — infra

**T24. Payment mock simulation via Stripe CLI/SDK test mode.** Upgrade dev payments from PAYMENT_PROVIDER=mock to a Stripe-CLI-driven simulation (webhook forwarding, stripe trigger, test cards incl. failure/3DS). Deliverable: documented recipe + scripted sim covering success/failure/retry. Note settlement is already webhook-shaped (transactional inbox, settlement.ts).

---

## Autonomous-run rulings (pre-made so the run never stalls; flag each in the final report)

- **T1 is DONE** — committed 2026-07-15 at the end of the test session (provider quirk fix + test + .gitignore + this doc).
- **T3:** make gpt-5.6-sol the seed default for main-chat (`prisma/seeds/seed-agents.ts`), keep fallback `claude-sonnet-5` — the user selected this model deliberately and future reseeds must not revert it.
- **T2:** real gpt-5.6-sol pricing is unknown — keep the placeholder values but move them into `seed-model-catalog.ts` with an explicit `// PLACEHOLDER pricing — replace with real rates` comment; flag in report.
- **T4:** enable Enter-to-send (universal chat convention); Shift+Enter for newline.
- **T10:** implement option (c) — ONE card listing all 6 conditions with primary action "Niciuna dintre acestea nu mi se aplică" + individual toggles for exceptions.
- **T18:** FX source = BNR daily reference rate (standard Romanian market practice), pluggable provider seam with a fixed-rate override per contract; rate value + date + source frozen into T14's rating snapshot.
- **T17:** the REAL rate card values are unavailable — reseed the existing values in their true denomination (EUR) and let the T18 conversion produce RON premiums; flag "verify against the actual Allianz tariff sheet" in the report.
- Push policy: commit per task locally; do NOT push to origin — the user reviews on return.

## Suggested execution order

0. ~~T1 (commit)~~ DONE → T2, T3, T4
1. T12 + T8 design docs (they govern phases 2–3; get user sign-off on both before implementing)
2. T29 + T30 (parity ratchet first — it then guards everything else) → T9, T7, T11, T22, T19, T23, T15, T10
3. T13 + T16 (one prevention+detection pair) → T20, T5
4. T14 → T18 → T17 (snapshot, then currency machinery, then real rates ride both)
5. T28 → T26 → T27 → T21 → T25 → T6 (the onboarding redesign, in dependency order)
6. T24

## Verification norms for this work

- Full suite green before each commit (`npx vitest run`); known flake: `__tests__/lib/events/instrumentation.test.ts` (timing race — PASS if it's the only failure).
- After behavior-affecting phases: run a scripted end-to-end sim of the sales funnel and/or a manual browser pass (preview tools, port 3001) — tonight proved unit-green ≠ working at least four times.
- For diagnostics ratchets: add the check test-first in `lib/diagnostics/`; re-run the checker against conversation `cmrm3fgku00056g0y4eb2hsme` — it should flag the historical instances (hallucinated_ui_reference, stale_gate_claim).
