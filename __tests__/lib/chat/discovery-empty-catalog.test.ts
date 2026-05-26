import { describe, it, expect } from 'vitest'
import { withDefaultDiscoveryTools } from '@/lib/chat/default-tools'
import { computeAllowedTools } from '@/lib/skills/skill-pack-loader'

describe('discovery flow (subsystem D regression)', () => {
  it('agent has list_products available with no workflow and no packs', () => {
    // Reproduces the orchestrator's tool-list construction sequence:
    //   stepAllowedTools = withDefaultDiscoveryTools(workflow ?? [])
    //   effectiveTools = computeAllowedTools(stepAllowedTools, packs)
    const workflowAllowedTools: string[] = []
    const packs: any[] = []

    const stepAllowedTools = withDefaultDiscoveryTools(workflowAllowedTools)
    const effectiveTools = computeAllowedTools(stepAllowedTools, packs)

    expect(effectiveTools).toContain('list_products')
    expect(effectiveTools).toContain('get_product_info')
    expect(effectiveTools).toContain('set_conversation_product')
  })

  it('agent retains discovery tools even when a pack contributes its own tools', () => {
    const workflowAllowedTools: string[] = []
    const packs: any[] = [
      { slug: 'life-insurance-discovery', allowedTools: ['calculate_premium'] },
    ]

    const stepAllowedTools = withDefaultDiscoveryTools(workflowAllowedTools)
    const effectiveTools = computeAllowedTools(stepAllowedTools, packs)

    expect(effectiveTools).toContain('list_products')
    expect(effectiveTools).toContain('calculate_premium')
  })

  it('agent has all baseline tools when workflow is active and pack contributes one extra', () => {
    const workflowAllowedTools = ['save_application_answer']
    const packs: any[] = [
      { slug: 'life-insurance-discovery', allowedTools: ['calculate_premium'] },
    ]

    const stepAllowedTools = withDefaultDiscoveryTools(workflowAllowedTools)
    const effectiveTools = computeAllowedTools(stepAllowedTools, packs)

    expect(effectiveTools).toEqual(
      expect.arrayContaining([
        'list_products',
        'get_product_info',
        'set_conversation_product',
        'set_candidate_product',
        'record_gdpr_consent',
        'acknowledge_ai_disclosure',
        'save_application_answer',
        'calculate_premium',
      ]),
    )
    expect(effectiveTools).toHaveLength(8)
  })
})
