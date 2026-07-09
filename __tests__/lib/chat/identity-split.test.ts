/**
 * E1 (autonomy-skills-cost plan 2026-07-06): the 5k-token MAIN_CHAT_PROMPT
 * splits into phase-scoped sections. CONSTITUTION_CORE stays always-on
 * (agentIdentity); FIRST_TURN_RULES ships only while messageCount <= 2;
 * DISCOVERY_CONDUCT (guardrails 1–6 + single-match + product knowledge +
 * pacing) ships only on DISCOVERY and QUOTE turns. ADVANCING TO THE OFFER
 * stays in the constitution until Workstream C (gated on SE-1.3).
 *
 * Content moves are inventoried in
 * docs/superpowers/notes/2026-06-zeno-prompt-section-inventory.md §7.
 */
import { describe, it, expect } from 'vitest'
import {
  CONSTITUTION_CORE,
  FIRST_TURN_RULES,
  DISCOVERY_CONDUCT,
  AGENTS,
} from '../../../prisma/seeds/seed-agents'
import {
  buildPrompt,
  detectFirstTurn,
  type PromptSections,
  type GateSelection,
} from '@/lib/chat/prompt-builder'
import { getRequiredSectionsFor, includeDiscoveryConduct } from '@/lib/chat/phase-sections-map'

// ==============================================
// Seed constants: every block lives in exactly one home
// ==============================================

describe('E1 seed split — block placement', () => {
  it('CONSTITUTION_CORE keeps identity, conduct-agnostic rules, and ADVANCING (until C)', () => {
    for (const marker of [
      'You are Zeno',
      'HUMAN HANDOFF',
      'CORE BEHAVIORS:',
      'CUSTOMER SIGNAL AWARENESS:',
      'TOOL USE IS INVISIBLE INFRASTRUCTURE:',
      "ANSWER FIRST — DON'T DEFLECT:",
      'ADVANCING TO THE OFFER',
      'OFF-TOPIC HANDLING:',
      'CRITICAL CONSTRAINTS - NEVER VIOLATE THESE:',
      'CUSTOMER AUTONOMY:',
      'WHAT I CAN DO:',
      'WHAT I CANNOT DO:',
    ]) {
      expect(CONSTITUTION_CORE, `missing from core: ${marker}`).toContain(marker)
    }
    // The never-"AI" vocabulary rule is global (customers ask at any turn) —
    // it moves from the first-turn IMPORTANT block into the constitution.
    expect(CONSTITUTION_CORE).toContain('NEVER use the words "AI"')
  })

  it('CONSTITUTION_CORE contains NO discovery-conduct or first-turn blocks', () => {
    for (const marker of [
      'FIRST-TURN RULES',
      'PRODUCT DISCOVERY GUARDRAILS',
      'SINGLE-MATCH CATEGORY',
      'PACING:',
      'PRODUCT KNOWLEDGE — WHAT WE SELL',
    ]) {
      expect(CONSTITUTION_CORE, `must not be in core: ${marker}`).not.toContain(marker)
    }
  })

  it('FIRST_TURN_RULES carries the opener rules and reference opening only', () => {
    expect(FIRST_TURN_RULES).toContain('FIRST-TURN RULES')
    expect(FIRST_TURN_RULES).toContain('Reference opening (Romanian):')
    expect(FIRST_TURN_RULES).toContain('Ce te-a adus pe aici azi?')
    // A cross-REFERENCE to the guardrails is fine (they render below on turn
    // 1); the block itself must not be here.
    expect(FIRST_TURN_RULES).not.toContain('PRODUCT DISCOVERY GUARDRAILS (apply on EVERY turn')
    expect(FIRST_TURN_RULES).not.toContain('CORE BEHAVIORS')
  })

  it('DISCOVERY_CONDUCT carries guardrails 1–6, single-match, product knowledge, pacing', () => {
    for (const marker of [
      'PRODUCT KNOWLEDGE — WHAT WE SELL',
      'PRODUCT DISCOVERY GUARDRAILS',
      'SINGLE-MATCH CATEGORY',
      'PACING:',
      'ONE QUESTION PER TURN',
      'INSURER DISCLOSURE',
    ]) {
      expect(DISCOVERY_CONDUCT, `missing from discovery conduct: ${marker}`).toContain(marker)
    }
    expect(DISCOVERY_CONDUCT).not.toContain('ADVANCING TO THE OFFER')
  })

  it('no sentence is lost: the three parts jointly preserve the load-bearing rules', () => {
    const whole = CONSTITUTION_CORE + FIRST_TURN_RULES + DISCOVERY_CONDUCT
    for (const marker of [
      'consilier virtual',
      'Allianz-Țiriac Asigurări S.A.',
      'vrei să verific',
      'pricing_examples',
      'open_dnt_session',
      'pendingCodes',
      'câți ani ai?',
      'NO INVENTED LINKS OR URLS',
      '"Not now" is a valid answer.',
    ]) {
      expect(whole, `lost rule: ${marker}`).toContain(marker)
    }
  })

  it('main-chat agent seeds CONSTITUTION_CORE as systemPrompt and the split sections as promptSections', () => {
    const main = AGENTS.find((a) => a.slug === 'main-chat')!
    expect(main.systemPrompt).toBe(CONSTITUTION_CORE)
    expect(main.promptSections).toEqual({
      firstTurnRules: FIRST_TURN_RULES,
      discoveryConduct: DISCOVERY_CONDUCT,
    })
  })

  it('char budget: the always-on constitution stays under 14KB (the sales-line TOOL FAILURE PROTOCOL + CUSTOMER FIELD DISCIPLINE blocks live here; drops toward ≤9KB once Workstream C removes ADVANCING)', () => {
    expect(CONSTITUTION_CORE.length).toBeLessThanOrEqual(14_000)
  })
})

// ==============================================
// Detectors (deterministic, the detectFastPath pattern)
// ==============================================

describe('E1 detectors', () => {
  it('detectFirstTurn: true through messageCount 2, false after', () => {
    expect(detectFirstTurn(0)).toBe(true)
    expect(detectFirstTurn(1)).toBe(true)
    expect(detectFirstTurn(2)).toBe(true)
    expect(detectFirstTurn(3)).toBe(false)
    expect(detectFirstTurn(10)).toBe(false)
  })

  it('includeDiscoveryConduct: DISCOVERY and QUOTE only', () => {
    expect(includeDiscoveryConduct('DISCOVERY')).toBe(true)
    expect(includeDiscoveryConduct('QUOTE')).toBe(true)
    expect(includeDiscoveryConduct('APPLICATION')).toBe(false)
    expect(includeDiscoveryConduct('PAYMENT')).toBe(false)
    expect(includeDiscoveryConduct('POLICY')).toBe(false)
  })

  it('phase map lists discoveryConduct on DISCOVERY and QUOTE, never on APPLICATION subphases', () => {
    expect(getRequiredSectionsFor('DISCOVERY', null)).toContain('discoveryConduct')
    expect(getRequiredSectionsFor('QUOTE', null)).toContain('discoveryConduct')
    expect(getRequiredSectionsFor('APPLICATION', 'DNT')).not.toContain('discoveryConduct')
    expect(getRequiredSectionsFor('APPLICATION', 'QUESTIONNAIRE')).not.toContain('discoveryConduct')
    expect(getRequiredSectionsFor('PAYMENT', null)).not.toContain('discoveryConduct')
  })
})

// ==============================================
// Assembly invariants (the E1 gate)
// ==============================================

function sectionsFor(opts: { phase: 'DISCOVERY' | 'APPLICATION' | 'QUOTE'; messageCount: number }): PromptSections {
  // Mirrors the orchestrator: loadAllSections returns the raw seeded content,
  // then the post-gate patch nulls out-of-scope sections (dntContext pattern).
  return {
    agentIdentity: CONSTITUTION_CORE,
    firstTurnRules: detectFirstTurn(opts.messageCount) ? FIRST_TURN_RULES : null,
    discoveryConduct: includeDiscoveryConduct(opts.phase) ? DISCOVERY_CONDUCT : null,
    capabilityManifest: 'My tools for this conversation: list_products',
    constraints: 'No invented URLs or links',
    stateGrounding: '=== CURRENT SYSTEM STATE ===',
    complianceGuidance: null,
    situationalBriefing: `Phase: ${opts.phase}`,
    customerMemory: null,
    agentKnowledge: null,
    customerContext: null,
    coachingBriefing: null,
    domainGuidance: null,
    questionnaireContext: opts.phase === 'APPLICATION' ? 'Q 3/10: smoker?' : null,
    productContext: null,
    catalogOverview: 'CATALOG: Protect',
    dntContext: null,
    paymentContext: null,
    policyContext: null,
  }
}

const GATE: GateSelection = { requiredSections: [], excludedSections: [], confidence: 1 }

describe('E1 assembly invariants', () => {
  it('turn 1 (DISCOVERY): prompt contains first-turn rules AND discovery conduct', () => {
    const r = buildPrompt(sectionsFor({ phase: 'DISCOVERY', messageCount: 1 }), GATE)
    expect(r.prompt).toContain('FIRST-TURN RULES')
    expect(r.prompt).toContain('PRODUCT DISCOVERY GUARDRAILS')
  })

  it('turn 5 (DISCOVERY): discovery conduct stays, first-turn rules are gone', () => {
    const r = buildPrompt(sectionsFor({ phase: 'DISCOVERY', messageCount: 9 }), GATE)
    expect(r.prompt).not.toContain('FIRST-TURN RULES')
    expect(r.prompt).toContain('PRODUCT DISCOVERY GUARDRAILS')
  })

  it('QUESTIONNAIRE turn: NO discovery guardrails, NO first-turn rules — constitution intact', () => {
    const r = buildPrompt(sectionsFor({ phase: 'APPLICATION', messageCount: 20 }), GATE)
    expect(r.prompt).not.toContain('PRODUCT DISCOVERY GUARDRAILS')
    expect(r.prompt).not.toContain('SINGLE-MATCH CATEGORY')
    expect(r.prompt).not.toContain('FIRST-TURN RULES')
    expect(r.prompt).toContain('TOOL USE IS INVISIBLE INFRASTRUCTURE:')
    expect(r.prompt).toContain('ADVANCING TO THE OFFER')
    expect(r.prompt).toContain('CUSTOMER AUTONOMY:')
  })

  it('QUOTE turn: discovery conduct present (pricing guardrails still bind)', () => {
    const r = buildPrompt(sectionsFor({ phase: 'QUOTE', messageCount: 30 }), GATE)
    expect(r.prompt).toContain('PRODUCT DISCOVERY GUARDRAILS')
  })

  it('both new sections render in the stable prefix (cacheable), not the dynamic suffix', () => {
    const r = buildPrompt(sectionsFor({ phase: 'DISCOVERY', messageCount: 1 }), GATE)
    expect(r.stablePrefix).toContain('FIRST-TURN RULES')
    expect(r.stablePrefix).toContain('PRODUCT DISCOVERY GUARDRAILS')
    expect(r.dynamicSuffix).not.toContain('FIRST-TURN RULES')
    expect(r.dynamicSuffix).not.toContain('PRODUCT DISCOVERY GUARDRAILS')
  })

  it('firstTurnRules renders right after the identity, before discovery conduct', () => {
    const r = buildPrompt(sectionsFor({ phase: 'DISCOVERY', messageCount: 1 }), GATE)
    const identityIdx = r.prompt.indexOf('You are Zeno')
    const firstTurnIdx = r.prompt.indexOf('FIRST-TURN RULES')
    const conductIdx = r.prompt.indexOf('PRODUCT DISCOVERY GUARDRAILS')
    expect(identityIdx).toBeGreaterThanOrEqual(0)
    expect(firstTurnIdx).toBeGreaterThan(identityIdx)
    expect(conductIdx).toBeGreaterThan(firstTurnIdx)
  })
})
