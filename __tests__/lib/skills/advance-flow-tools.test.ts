/**
 * Regression test: advance-flow toolset coverage
 *
 * Verifies that the skill packs active during the
 * converge → DNT → application → quote sequence
 * grant every tool the agent needs to drive that flow.
 */
import { describe, it, expect } from 'vitest'
import { SKILL_PACKS } from '@/prisma/seeds/seed-skill-packs'

const ADVANCE_TOOLS = [
  'check_dnt_status',
  'start_dnt_questionnaire',
  'save_dnt_answer',
  'sign_dnt',
  'start_application',
  'save_application_answer',
  'generate_quote',
]

function findPack(slug: string) {
  const pack = SKILL_PACKS.find((p) => p.slug === slug)
  if (!pack) throw new Error(`Skill pack "${slug}" not found in SKILL_PACKS`)
  return pack
}

describe('advance-flow tool coverage', () => {
  describe('life-insurance-closing', () => {
    const pack = findPack('life-insurance-closing')

    for (const tool of ADVANCE_TOOLS) {
      it(`grants ${tool}`, () => {
        expect(pack.allowedTools).toContain(tool)
      })
    }
  })

  describe('questionnaire-facilitation', () => {
    const pack = findPack('questionnaire-facilitation')

    for (const tool of ADVANCE_TOOLS) {
      it(`grants ${tool}`, () => {
        expect(pack.allowedTools).toContain(tool)
      })
    }
  })
})
