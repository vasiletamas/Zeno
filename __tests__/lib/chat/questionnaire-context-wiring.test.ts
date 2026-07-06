import { describe, it, expect, vi, beforeEach } from 'vitest'

// Task 1.2 (D2): the questionnaireContext loader was dead — loadAllSections
// hardcoded workflowStepCode=null, so the context-hit "DO NOT RE-ASK" block
// never rendered. The orchestrator now derives the step code from the
// engine's (phase, subphase) and patches the section from DerivedStateV3.

vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: { findUnique: vi.fn() },
    questionGroup: { findMany: vi.fn() },
    question: { findMany: vi.fn() },
    answer: { findMany: vi.fn() },
    dntAnswer: { findMany: vi.fn() },
    dntSession: { findFirst: vi.fn() },
    application: { findUnique: vi.fn() },
    questionDependency: { findMany: vi.fn() },
    customerInsight: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/errors/logger', () => ({ logWarn: vi.fn(), logInfo: vi.fn() }))

const { prisma } = await import('@/lib/db')
const { loadQuestionnaireContextForState } = await import('@/lib/chat/context-loaders')
const { workflowStepCodeFor } = await import('@/lib/chat/phase-sections-map')

const APP_GROUP = { id: 'g1', code: 'application', orderIndex: 6 }
const APP_QUESTION = {
  id: 'q1',
  code: 'PACKAGE_CHOICE',
  groupId: 'g1',
  text: { en: 'Which package?', ro: 'Ce pachet?' },
  helpText: null,
  type: 'DROPDOWN',
  options: [
    { value: 'Standard', label: { en: 'Standard', ro: 'Standard' } },
    { value: 'Optim', label: { en: 'Optim', ro: 'Optim' } },
  ],
  validationRules: null,
  insightKey: 'selectedTier',
  orderIndex: 1,
  isRequired: true,
}

describe('workflowStepCodeFor — (phase, subphase) → step code', () => {
  it('maps APPLICATION/QUESTIONNAIRE to application_fill', () => {
    expect(workflowStepCodeFor('APPLICATION', 'QUESTIONNAIRE')).toBe('application_fill')
  })
  it('maps APPLICATION/DNT to dnt_questionnaire', () => {
    expect(workflowStepCodeFor('APPLICATION', 'DNT')).toBe('dnt_questionnaire')
  })
  it('every other state carries no questionnaire surface', () => {
    expect(workflowStepCodeFor('DISCOVERY', null)).toBeNull()
    expect(workflowStepCodeFor('QUOTE', null)).toBeNull()
    expect(workflowStepCodeFor('APPLICATION', 'QUOTE_GENERATION')).toBeNull()
    expect(workflowStepCodeFor('PAYMENT', null)).toBeNull()
    expect(workflowStepCodeFor('POLICY', null)).toBeNull()
  })
})

describe('loadQuestionnaireContextForState — the orchestrator patch path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({ activeApplicationId: 'app-1', productId: 'p1', candidateProductId: null } as never)
    vi.mocked(prisma.questionGroup.findMany).mockResolvedValue([APP_GROUP] as never)
    vi.mocked(prisma.question.findMany).mockResolvedValue([APP_QUESTION] as never)
    vi.mocked(prisma.answer.findMany).mockResolvedValue([])
    vi.mocked(prisma.application.findUnique).mockResolvedValue({ tier: null, level: null, includesAddon: false } as never)
    vi.mocked(prisma.questionDependency.findMany).mockResolvedValue([])
    vi.mocked(prisma.customerInsight.findUnique).mockResolvedValue(null)
  })

  it('APPLICATION/QUESTIONNAIRE turn includes questionnaireContext with current question', async () => {
    const section = await loadQuestionnaireContextForState(
      { phase: 'APPLICATION', subphase: 'QUESTIONNAIRE' }, 'conv-1', 'cust-1', 'ro',
    )
    expect(section).toMatch(/current question/i)
    expect(section).toContain('Ce pachet?')
    expect(section).toContain('PACKAGE_CHOICE')
  })

  it('stored preference matching current question renders CONTEXT HIT block', async () => {
    vi.mocked(prisma.customerInsight.findUnique).mockResolvedValue({
      id: 'i1', customerId: 'cust-1', productId: null,
      category: 'PREFERENCE', key: 'selectedTier', value: 'Optim',
      confidence: 0.9, source: 'conv-1',
      lastConfirmedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    } as never)
    const section = await loadQuestionnaireContextForState(
      { phase: 'APPLICATION', subphase: 'QUESTIONNAIRE' }, 'conv-1', 'cust-1', 'ro',
    )
    expect(section).toContain('[CONTEXT HIT for current question]')
    expect(section).toContain('value: "Optim"')
    expect(section).toContain('INSTRUCTIONS — DO NOT RE-ASK')
  })

  it('APPLICATION/DNT walks the ACTIVE DNT session', async () => {
    vi.mocked(prisma.dntSession.findFirst).mockResolvedValue({ id: 'sess-1' } as never)
    vi.mocked(prisma.dntAnswer.findMany).mockResolvedValue([])
    vi.mocked(prisma.questionGroup.findMany).mockResolvedValue([{ id: 'g0', code: 'dnt_general', orderIndex: 1 }] as never)
    vi.mocked(prisma.question.findMany).mockResolvedValue([
      { ...APP_QUESTION, id: 'qd1', code: 'DNT_FAMILY_SIZE', groupId: 'g0', insightKey: 'familySize', text: { en: 'Family size?', ro: 'Câți membri are familia ta?' } },
    ] as never)
    const section = await loadQuestionnaireContextForState(
      { phase: 'APPLICATION', subphase: 'DNT' }, 'conv-1', 'cust-1', 'ro',
    )
    expect(section).toContain('DNT_FAMILY_SIZE')
    expect(section).toMatch(/current question/i)
  })

  it('DISCOVERY loads nothing and touches no questionnaire tables', async () => {
    const section = await loadQuestionnaireContextForState(
      { phase: 'DISCOVERY', subphase: null }, 'conv-1', 'cust-1', 'ro',
    )
    expect(section).toBeNull()
    expect(prisma.question.findMany).not.toHaveBeenCalled()
  })
})
