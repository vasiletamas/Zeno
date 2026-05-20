import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReasoningGateInput } from '@/lib/chat/reasoning-gate'

// ==============================================
// MOCK GATEWAY
// ==============================================

const mockGatewayCall = vi.fn()

vi.mock('@/lib/llm/gateway', () => ({
  gateway: {
    call: (...args: unknown[]) => mockGatewayCall(...args),
  },
}))

// Import after mocking
const {
  executeReasoningGate,
  formatGateBriefing,
  buildGateContextMessage,
} = await import('@/lib/chat/reasoning-gate')

// ==============================================
// HELPERS
// ==============================================

function makeInput(overrides: Partial<ReasoningGateInput> = {}): ReasoningGateInput {
  return {
    lastUserMessage: 'Cat costa asigurarea?',
    last3Messages: [
      { role: 'user', content: 'Buna ziua' },
      { role: 'assistant', content: 'Buna! Cum va pot ajuta?' },
      { role: 'user', content: 'Cat costa asigurarea?' },
    ],
    hasActiveQuestionnaire: false,
    currentQuestionText: null,
    workflowStepCode: 'product_presentation',
    availableTools: ['list_products', 'get_product_info'],
    customerProfile: {
      name: 'Ion Popescu',
      age: 35,
      family: 'married, 2 children',
      occupation: 'engineer',
      isReturningCustomer: false,
    },
    businessState: {
      selectedProduct: 'Protect',
      dntProgress: '3/8 questions',
      applicationProgress: null,
      hasQuote: false,
      quoteValue: null,
      hasPolicy: false,
    },
    ...overrides,
  }
}

const VALID_GATE_JSON = JSON.stringify({
  situationType: 'product_inquiry',
  complexity: 'moderate',
  confidence: 0.85,
  contradictions: [
    {
      tension: 'coaching says push price, workflow says answer questions',
      resolution: 'answer questions first',
      winner: 'customer',
    },
  ],
  concernActions: [
    {
      concern: 'price sensitivity',
      gateAssessment: 'genuinely_open',
      action: 'address_now',
      reason: 'customer explicitly asked about cost',
    },
  ],
  requiredSections: ['productContext', 'coachingBriefing'],
  excludedSections: ['customerMemory', 'capabilityManifest'],
  briefing: 'Customer is asking about pricing. Focus on value proposition.',
  toolGuidance: {
    prioritize: ['get_product_info'],
    discourage: ['submit_application'],
  },
  knowledgeGaps: ['customer budget range'],
})

// ==============================================
// TESTS
// ==============================================

describe('executeReasoningGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses clean JSON response correctly', async () => {
    mockGatewayCall.mockResolvedValue({
      content: VALID_GATE_JSON,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    })

    const result = await executeReasoningGate(makeInput())

    expect(result.situationType).toBe('product_inquiry')
    expect(result.complexity).toBe('moderate')
    expect(result.confidence).toBe(0.85)
    expect(result.requiredSections).toEqual(['productContext', 'coachingBriefing'])
    expect(result.excludedSections).toEqual(['customerMemory', 'capabilityManifest'])
    expect(result.briefing).toBe(
      'Customer is asking about pricing. Focus on value proposition.',
    )
    expect(result.toolGuidance.prioritize).toEqual(['get_product_info'])
    expect(result.toolGuidance.discourage).toEqual(['submit_application'])
    expect(result.contradictions).toHaveLength(1)
    expect(result.concernActions).toHaveLength(1)
    expect(result.knowledgeGaps).toEqual(['customer budget range'])
  })

  it('parses markdown-fenced JSON correctly', async () => {
    const fencedJSON = '```json\n' + VALID_GATE_JSON + '\n```'

    mockGatewayCall.mockResolvedValue({
      content: fencedJSON,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    })

    const result = await executeReasoningGate(makeInput())

    expect(result.situationType).toBe('product_inquiry')
    expect(result.complexity).toBe('moderate')
    expect(result.confidence).toBe(0.85)
    expect(result.briefing).toBe(
      'Customer is asking about pricing. Focus on value proposition.',
    )
  })

  it('returns fallback on malformed JSON', async () => {
    mockGatewayCall.mockResolvedValue({
      content: 'This is not JSON at all, just some text.',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    })

    const result = await executeReasoningGate(makeInput())

    expect(result.complexity).toBe('moderate')
    expect(result.confidence).toBe(0)
    expect(result.requiredSections).toEqual([])
    expect(result.excludedSections).toEqual([])
    expect(result.briefing).toBe('')
  })

  it('returns fallback on gateway error', async () => {
    mockGatewayCall.mockRejectedValue(new Error('Gateway timeout'))

    const result = await executeReasoningGate(makeInput())

    expect(result.complexity).toBe('moderate')
    expect(result.confidence).toBe(0)
    expect(result.briefing).toBe('')
    expect(result.toolGuidance).toEqual({ prioritize: [], discourage: [] })
  })

  it('returns fallback on invalid complexity value', async () => {
    const invalidJSON = JSON.stringify({
      situationType: 'test',
      complexity: 'extreme', // invalid
      confidence: 0.5,
      requiredSections: [],
      excludedSections: [],
      briefing: 'test',
      toolGuidance: { prioritize: [], discourage: [] },
    })

    mockGatewayCall.mockResolvedValue({
      content: invalidJSON,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    })

    const result = await executeReasoningGate(makeInput())

    // Invalid complexity should trigger fallback
    expect(result.complexity).toBe('moderate')
    expect(result.confidence).toBe(0)
  })

  it('clamps confidence to [0, 1]', async () => {
    const highConfJSON = JSON.stringify({
      situationType: 'test',
      complexity: 'simple',
      confidence: 1.5, // above 1
      requiredSections: [],
      excludedSections: [],
      briefing: 'high confidence test',
      toolGuidance: { prioritize: [], discourage: [] },
    })

    mockGatewayCall.mockResolvedValue({
      content: highConfJSON,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    })

    let result = await executeReasoningGate(makeInput())
    expect(result.confidence).toBe(1.0)

    const lowConfJSON = JSON.stringify({
      situationType: 'test',
      complexity: 'simple',
      confidence: -0.5, // below 0
      requiredSections: [],
      excludedSections: [],
      briefing: 'low confidence test',
      toolGuidance: { prioritize: [], discourage: [] },
    })

    mockGatewayCall.mockResolvedValue({
      content: lowConfJSON,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    })

    result = await executeReasoningGate(makeInput())
    expect(result.confidence).toBe(0)
  })

  it('returns fallback when response content is null', async () => {
    mockGatewayCall.mockResolvedValue({
      content: null,
      usage: { promptTokens: 100, completionTokens: 0, totalTokens: 100 },
    })

    const result = await executeReasoningGate(makeInput())

    expect(result.complexity).toBe('moderate')
    expect(result.confidence).toBe(0)
  })
})

describe('formatGateBriefing', () => {
  it('produces correct format with all fields', () => {
    const output = {
      situationType: 'product_inquiry',
      complexity: 'moderate' as const,
      confidence: 0.85,
      contradictions: [
        {
          tension: 'coaching vs workflow',
          resolution: 'follow customer',
          winner: 'customer',
        },
      ],
      concernActions: [
        {
          concern: 'price sensitivity',
          gateAssessment: 'genuinely_open',
          action: 'address_now',
          reason: 'customer asked about cost',
        },
        {
          concern: 'commitment anxiety',
          gateAssessment: 'addressed_not_closed',
          action: 'monitor',
          reason: 'mentioned thinking about it',
        },
      ],
      requiredSections: ['productContext'],
      excludedSections: [],
      briefing: 'Customer is asking about pricing.',
      toolGuidance: {
        prioritize: ['get_product_info'],
        discourage: ['submit_application'],
      },
      recommendedSkillPacks: [],
      complianceRelevant: false,
    }

    const formatted = formatGateBriefing(output)

    expect(formatted).toContain('=== SITUATIONAL ANALYSIS (moderate) ===')
    expect(formatted).toContain('Customer is asking about pricing.')
    expect(formatted).toContain('RESOLVED CONTRADICTIONS:')
    expect(formatted).toContain('coaching vs workflow')
    expect(formatted).toContain('(deferred to: customer)')
    expect(formatted).toContain('CONCERNS TO ADDRESS NOW:')
    expect(formatted).toContain('price sensitivity (genuinely_open)')
    expect(formatted).toContain('Monitoring: commitment anxiety')
    expect(formatted).toContain('Prioritize: get_product_info')
    expect(formatted).toContain('Discourage: submit_application')
  })

  it('handles minimal output without optional fields', () => {
    const output = {
      situationType: 'greeting',
      complexity: 'simple' as const,
      confidence: 0.9,
      requiredSections: [],
      excludedSections: [],
      briefing: 'Simple greeting, respond warmly.',
      toolGuidance: { prioritize: [], discourage: [] },
      recommendedSkillPacks: [],
      complianceRelevant: false,
    }

    const formatted = formatGateBriefing(output)

    expect(formatted).toContain('=== SITUATIONAL ANALYSIS (simple) ===')
    expect(formatted).toContain('Simple greeting, respond warmly.')
    expect(formatted).not.toContain('RESOLVED CONTRADICTIONS')
    expect(formatted).not.toContain('CONCERNS TO ADDRESS NOW')
    expect(formatted).not.toContain('Tool guidance')
  })
})

describe('buildGateContextMessage', () => {
  it('includes all input fields in the context message', () => {
    const input = makeInput()
    const message = buildGateContextMessage(input)

    // Recent conversation
    expect(message).toContain('RECENT CONVERSATION:')
    expect(message).toContain('Customer: Buna ziua')
    expect(message).toContain('Agent: Buna! Cum va pot ajuta?')

    // Workflow step
    expect(message).toContain('ACTIVE WORKFLOW STEP: product_presentation')

    // Questionnaire
    expect(message).toContain('QUESTIONNAIRE ACTIVE: No')

    // Available tools
    expect(message).toContain('AVAILABLE TOOLS: list_products, get_product_info')

    // Customer profile
    expect(message).toContain('Ion Popescu')
    expect(message).toContain('age 35')
    expect(message).toContain('engineer')
    expect(message).toContain('married, 2 children')

    // Business state
    expect(message).toContain('Product: Protect')
    expect(message).toContain('DNT: 3/8 questions')

    // Current message
    expect(message).toContain('CURRENT CUSTOMER MESSAGE: Cat costa asigurarea?')
  })

  it('handles active questionnaire', () => {
    const input = makeInput({
      hasActiveQuestionnaire: true,
      currentQuestionText: 'What is your annual income?',
    })

    const message = buildGateContextMessage(input)

    expect(message).toContain('QUESTIONNAIRE ACTIVE: Yes')
    expect(message).toContain('CURRENT QUESTION: What is your annual income?')
  })

  it('handles empty customer profile', () => {
    const input = makeInput({
      customerProfile: {
        name: null,
        age: null,
        family: null,
        occupation: null,
        isReturningCustomer: false,
      },
    })

    const message = buildGateContextMessage(input)

    expect(message).toContain('CUSTOMER: unknown')
  })

  it('handles returning customer flag', () => {
    const input = makeInput({
      customerProfile: {
        name: 'Maria',
        age: null,
        family: null,
        occupation: null,
        isReturningCustomer: true,
      },
    })

    const message = buildGateContextMessage(input)

    expect(message).toContain('(returning customer)')
  })

  it('handles quote in business state', () => {
    const input = makeInput({
      businessState: {
        selectedProduct: 'Protect',
        dntProgress: null,
        applicationProgress: null,
        hasQuote: true,
        quoteValue: 290,
        hasPolicy: false,
      },
    })

    const message = buildGateContextMessage(input)

    expect(message).toContain('Quote: 290 RON')
  })

  it('subsystem B — does NOT include the [Active Skill Packs] line in gate input', () => {
    const input = makeInput({
      currentMode: 'SALES',
      availableSkillPacks: [{ slug: 'life-insurance-discovery', description: 'Life insurance' }],
      activeSkillPacks: ['life-insurance-discovery'],
    })

    const message = buildGateContextMessage(input)

    expect(message).not.toContain('[Active Skill Packs]')
    expect(message).toContain('[Available Skill Packs]')
  })
})
