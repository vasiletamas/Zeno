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
        'set_candidate_product',
        'record_gdpr_consent',
        'acknowledge_ai_disclosure',
        'get_current_state',
        'set_answer',
        'change_selection',
        'switch_product',
        'preview_product_requirements',
        'save_application_answer',
        'calculate_premium',
      ]),
    )
    // 10 baseline discovery/state tools + 1 workflow tool + 1 pack tool
    expect(effectiveTools).toHaveLength(12)
  })
})
