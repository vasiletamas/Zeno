/**
 * T13 seams: a GUI action turn must be able to CHAIN — the synthetic
 * execution seeds the standard tool loop, and after an applied commit the
 * next LLM round gets the POST-commit tools + a [State update] message.
 * These are the two extracted decision points:
 *   - seedSyntheticLoopMessages: the assistant+tool exchange that primes the loop
 *   - buildRefreshArtifacts: which tools the LLM gets for the next round
 *     (fresh tool list + executor wall + the [State update] system message)
 * Historical instance (conv cmrm3fgku00056g0y4eb2hsme messageIndex 58): the
 * old path narrated over a TOOL-LESS stream call — generate_quote was
 * structurally unreachable in the same turn as the medical signature.
 */
import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from '@/__tests__/lib/engines/snapshot-fixtures'
import { VALID_DNT } from '@/__tests__/spec/helpers/spec-snapshots'
import { seedSyntheticLoopMessages } from '@/lib/chat/synthetic-turn'
import { buildRefreshArtifacts } from '@/lib/chat/round-refresh'
import { serializeToolResultForModel } from '@/lib/chat/tool-result-serializer'
import type { ToolResult } from '@/lib/tools/types'
import type { ToolCall } from '@/lib/llm/providers/types'

/** Complete application, coverage selected, medical declarations SIGNED —
 * the post-sign_medical_declarations world where generate_quote is legal. */
const SIGNED_SNAPSHOT = makeSnapshot({
  consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true },
  dnt: VALID_DNT,
  // generate_quote's identity row: anyDeclaredOf [cnp, dateOfBirth] (B3.2)
  identity: { tier: 'anonymous', fields: { dateOfBirth: { provenance: 'declared' } }, verifiedChannels: [], pendingChallenge: null },
  application: {
    id: 'app-1', status: 'OPEN', tier: 'standard', level: 'level_1', addon: false,
    answeredCount: 6, requiredCount: 6, missingCodes: [], frozen: false,
    medicalDeclarations: { requiredCodes: ['BD_CANCER_HISTORY'], answeredCodes: ['BD_CANCER_HISTORY'], signed: true },
  },
})

describe('seedSyntheticLoopMessages (T13)', () => {
  const tc: ToolCall = { id: 'click_1', name: 'sign_medical_declarations', arguments: { confirmSignature: true } }
  const result: ToolResult = {
    success: true,
    data: { _message: 'Medical declarations signed — 1 answers affirmed in one signature. The quote can be generated now.' },
    envelope: { outcome: 'applied', effects: [] },
  }

  it('returns the assistant tool-call message and the serialized tool result, in loop order', () => {
    const seeded = seedSyntheticLoopMessages(tc, result)
    expect(seeded).toEqual([
      { role: 'assistant', content: '', toolCalls: [tc] },
      { role: 'tool', content: serializeToolResultForModel(result), toolCallId: 'click_1' },
    ])
  })
})

describe('buildRefreshArtifacts (T13)', () => {
  const refreshed = deriveAndExpose(SIGNED_SNAPSHOT)

  it('fixture precondition: the post-sign exposure makes generate_quote available', () => {
    expect(refreshed.actions.available).toContain('generate_quote')
  })

  it('the next round\'s tool list contains generate_quote (the T13 chaining requirement)', () => {
    const artifacts = buildRefreshArtifacts(refreshed)
    expect(artifacts.tools.map((t) => t.function.name)).toContain('generate_quote')
  })

  it('the executor wall is exactly the refreshed exposure set', () => {
    const artifacts = buildRefreshArtifacts(refreshed)
    expect(artifacts.exposedTools).toEqual(refreshed.actions.available)
  })

  it('the [State update] system message lists generate_quote as available', () => {
    const artifacts = buildRefreshArtifacts(refreshed)
    expect(artifacts.stateUpdateMessage.role).toBe('system')
    expect(artifacts.stateUpdateMessage.content).toContain('[State update]')
    expect(artifacts.stateUpdateMessage.content).toMatch(/Available actions:.*generate_quote/)
  })
})
