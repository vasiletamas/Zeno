import { describe, it, expect } from 'vitest'
import { validateSideEffectClaims } from '@/lib/chat/side-effect-validator'

describe('orchestrator-side-effect-validation (subsystem C anomaly path)', () => {
  it('flags as anomaly when assistant writes "am notat" without a save tool call', () => {
    // Reproduces the validation step the orchestrator runs on each LLM response.
    const validation = validateSideEffectClaims(
      'Am notat răspunsul tău. Continuăm.',
      [],
      [],
      'ro',
    )

    expect(validation.valid).toBe(false)
    expect(validation.violations.length).toBeGreaterThan(0)
  })

  it('passes through when assistant text is purely conversational', () => {
    const validation = validateSideEffectClaims(
      'Apartamentul este într-un bloc din beton sau cărămidă?',
      [],
      [],
      'ro',
    )
    expect(validation.valid).toBe(true)
  })

  it('passes through when assistant writes "am notat" alongside a successful write_question_answer', () => {
    const validation = validateSideEffectClaims(
      'Am notat: 80 mp.',
      [{ id: 't1', name: 'write_question_answer', arguments: {} } as any],
      [{ success: true }] as any,
      'ro',
    )
    expect(validation.valid).toBe(true)
  })
})
