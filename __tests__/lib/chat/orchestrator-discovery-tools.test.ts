import { describe, it, expect } from 'vitest'
import { withDefaultDiscoveryTools } from '@/lib/chat/default-tools'

// Pure-function reproduction of the orchestrator's tool-list assembly,
// guarded so that a regression in withDefaultDiscoveryTools or the
// orchestrator's usage shows up here.

describe('orchestrator tool list assembly (subsystem D)', () => {
  it('includes the three discovery tools when no workflow is active', () => {
    const workflowAllowedTools: string[] = []
    const stepAllowedTools = withDefaultDiscoveryTools(workflowAllowedTools)

    expect(stepAllowedTools).toContain('list_products')
    expect(stepAllowedTools).toContain('get_product_info')
  })

  it('includes discovery tools alongside workflow tools when both present', () => {
    const workflowAllowedTools = ['save_application_answer', 'start_application']
    const stepAllowedTools = withDefaultDiscoveryTools(workflowAllowedTools)

    expect(stepAllowedTools).toContain('list_products')
    expect(stepAllowedTools).toContain('save_application_answer')
    expect(stepAllowedTools).toContain('start_application')
  })
})
