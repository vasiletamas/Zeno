import { prisma } from '@/lib/db'
import { resolveGroupCodes } from '@/lib/engines/question-groups'

export type Phase =
  | 'DISCOVERY'
  | 'SELECTION'
  | 'CONSENT'
  | 'QUESTIONNAIRE'
  | 'QUOTE'
  | 'CLOSING'

export interface DerivedState {
  phase: Phase
  product: { id: string; code: string; name: string } | null
  selection: { tier: string | null; level: string | null; addon: boolean | null } // codes, not ids
  consents: { gdpr: boolean; aiDisclosure: boolean }
  dnt: { signed: boolean; validUntil: string | null }
  application: {
    exists: boolean
    status: string | null
    answered: number
    required: number
    missing: string[] // question codes
  }
  quote: { exists: boolean; premiumAnnual: number | null } | null
  answers: Record<string, string> // questionCode -> value
  nextBestAction: string
}

type Selection = DerivedState['selection']
type ApplicationState = DerivedState['application']
type ProductState = DerivedState['product']

function determinePhase(
  acceptedQuote: { status: string } | null,
  application: ApplicationState,
  consents: DerivedState['consents'],
  dnt: DerivedState['dnt'],
  product: ProductState,
): Phase {
  if (acceptedQuote?.status === 'ACCEPTED') return 'CLOSING'
  if (application.exists && application.status === 'COMPLETED') return 'QUOTE'
  if (application.exists && application.missing.length > 0) return 'QUESTIONNAIRE'
  // Once a product is in play, GDPR + DNT must be in place before we can
  // proceed with selection / application. Missing either → CONSENT.
  if (product !== null && (!consents.gdpr || !dnt.signed)) return 'CONSENT'
  if (product !== null) return 'SELECTION'
  return 'DISCOVERY'
}

function determineNextBestAction(phase: Phase, application: ApplicationState): string {
  switch (phase) {
    case 'DISCOVERY':
      return 'call list_products, then set_candidate_product when the customer names a need'
    case 'SELECTION':
      return 'present tiers/levels; once chosen, record via change_selection (or pass tier/level/addon to start_application)'
    case 'CONSENT':
      return 'record_gdpr_consent and sign_dnt'
    case 'QUESTIONNAIRE':
      return `ask the next missing question: ${application.missing[0]}`
    case 'QUOTE':
      return 'call generate_quote'
    case 'CLOSING':
      return 'present the quote and proceed to accept_quote'
  }
}

function productName(name: unknown): string {
  if (typeof name === 'string') return name
  if (name && typeof name === 'object' && 'ro' in name) {
    const ro = (name as { ro?: unknown }).ro
    if (typeof ro === 'string') return ro
  }
  return 'Product'
}

export async function deriveState(conversationId: string): Promise<DerivedState> {
  // 1. Load the conversation
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  })
  if (!conversation) {
    throw new Error(`deriveState: conversation not found: ${conversationId}`)
  }

  // 2. Resolve the active product (committed > candidate)
  const activeProductId =
    conversation.productId ?? conversation.candidateProductId ?? null
  let product: ProductState = null
  if (activeProductId) {
    const prod = await prisma.product.findUnique({ where: { id: activeProductId } })
    if (prod) {
      product = { id: prod.id, code: prod.code, name: productName(prod.name) }
    }
  }

  // 3. Load the customer for consents
  const customer = await prisma.customer.findUnique({
    where: { id: conversation.customerId },
  })
  if (!customer) {
    throw new Error(`deriveState: customer not found: ${conversation.customerId}`)
  }
  const consents = {
    gdpr: customer.gdprConsentAt != null,
    aiDisclosure: customer.aiDisclosureAcknowledgedAt != null,
  }

  // 4. DNT state
  const dnt = {
    signed: conversation.dntSignedAt != null,
    validUntil: conversation.dntValidUntil?.toISOString() ?? null,
  }

  // 5. Application + selection + required/answered/missing
  const application = await prisma.application.findUnique({
    where: { conversationId },
  })

  let selection: Selection = { tier: null, level: null, addon: null }
  const applicationState: ApplicationState = {
    exists: false,
    status: null,
    answered: 0,
    required: 0,
    missing: [],
  }

  if (application) {
    applicationState.exists = true
    applicationState.status = application.status

    // Selection codes (tier / level resolved to their codes, not ids)
    let tierCode: string | null = null
    let levelCode: string | null = null
    if (application.tierId) {
      const tier = await prisma.pricingTier.findUnique({
        where: { id: application.tierId },
      })
      tierCode = tier?.code ?? null
    }
    if (application.levelId) {
      const level = await prisma.pricingLevel.findUnique({
        where: { id: application.levelId },
      })
      levelCode = level?.code ?? null
    }
    selection = {
      tier: tierCode,
      level: levelCode,
      addon: application.includesAddon,
    }

    // Required / answered / missing for the application questionnaire
    const groupCodes =
      (await resolveGroupCodes(application.productId, 'application')) ?? []
    if (groupCodes.length > 0) {
      const questions = await prisma.question.findMany({
        where: { group: { code: { in: groupCodes } } },
        select: { id: true, code: true },
      })
      const questionIds = questions.map((q) => q.id)
      const answeredRows = await prisma.answer.findMany({
        where: { conversationId, questionId: { in: questionIds } },
        select: { questionId: true },
      })
      const answeredIds = new Set(answeredRows.map((a) => a.questionId))
      applicationState.required = questions.length
      applicationState.answered = answeredIds.size
      applicationState.missing = questions
        .filter((q) => !answeredIds.has(q.id))
        .map((q) => q.code ?? q.id)
    }
  }

  // 6. Quote: latest DRAFT (current working quote) + any ACCEPTED (drives CLOSING)
  type QuoteRow = { status: string; premiumAnnual: number }
  let draftQuote: QuoteRow | null = null
  let acceptedQuote: QuoteRow | null = null
  if (application) {
    draftQuote = (await prisma.quote.findFirst({
      where: { applicationId: application.id, status: 'DRAFT' },
      orderBy: { createdAt: 'desc' },
      select: { status: true, premiumAnnual: true },
    })) as QuoteRow | null
    acceptedQuote = (await prisma.quote.findFirst({
      where: { applicationId: application.id, status: 'ACCEPTED' },
      select: { status: true, premiumAnnual: true },
    })) as QuoteRow | null
  }

  const quoteState: DerivedState['quote'] = draftQuote
    ? { exists: true, premiumAnnual: draftQuote.premiumAnnual }
    : acceptedQuote
      ? { exists: true, premiumAnnual: acceptedQuote.premiumAnnual }
      : null

  // 7. Answers map: questionCode -> value across the whole conversation
  const answers: Record<string, string> = {}
  if (application) {
    const allAnswers = await prisma.answer.findMany({
      where: { conversationId },
      select: { questionId: true, value: true },
    })
    if (allAnswers.length > 0) {
      const qids = allAnswers.map((a) => a.questionId)
      const answerQuestions = await prisma.question.findMany({
        where: { id: { in: qids } },
        select: { id: true, code: true },
      })
      const codeById = new Map(
        answerQuestions.map((q) => [q.id, q.code ?? q.id] as const),
      )
      for (const a of allAnswers) {
        const key = codeById.get(a.questionId) ?? a.questionId
        answers[key] = a.value
      }
    }
  }

  // 8. Phase + next best action
  const phase = determinePhase(
    acceptedQuote,
    applicationState,
    consents,
    dnt,
    product,
  )
  const nextBestAction = determineNextBestAction(phase, applicationState)

  return {
    phase,
    product,
    selection,
    consents,
    dnt,
    application: applicationState,
    quote: quoteState,
    answers,
    nextBestAction,
  }
}
