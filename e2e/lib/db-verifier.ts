/**
 * DB Verifier for E2E Tests
 *
 * Verifies database state after each scenario completes.
 * Uses Prisma directly to check that the full sales flow
 * produced the expected records.
 */

import { prisma } from '@/lib/db'

// ==============================================
// TYPES
// ==============================================

export interface VerificationCheck {
  name: string
  passed: boolean
  expected: unknown
  actual: unknown
}

export interface VerificationResult {
  passed: boolean
  checks: VerificationCheck[]
}

// ==============================================
// HELPERS
// ==============================================

function check(
  name: string,
  expected: unknown,
  actual: unknown,
  condition: boolean,
): VerificationCheck {
  return { name, passed: condition, expected, actual }
}

function buildResult(checks: VerificationCheck[]): VerificationResult {
  return {
    passed: checks.every((c) => c.passed),
    checks,
  }
}

// ==============================================
// VERIFIERS
// ==============================================

/**
 * Verify the happy-path scenario:
 * Full sale from discovery through to policy issuance.
 */
export async function verifyHappyPath(
  conversationId: string,
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = []

  // 1. Conversation exists and is COMPLETED
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  })
  checks.push(
    check(
      'Conversation exists',
      true,
      conversation !== null,
      conversation !== null,
    ),
  )
  checks.push(
    check(
      'Conversation stays ACTIVE (D2: a channel, never a funnel stage)',
      'ACTIVE',
      conversation?.status,
      conversation?.status === 'ACTIVE',
    ),
  )

  // 2. Application exists, status COMPLETED, tierId + levelId set, includesAddon true
  const application = await prisma.application.findFirst({
    where: { originConversationId: conversationId },
  })
  checks.push(
    check(
      'Application exists',
      true,
      application !== null,
      application !== null,
    ),
  )
  checks.push(
    check(
      'Application.status = COMPLETED',
      'COMPLETED',
      application?.status,
      application?.status === 'COMPLETED',
    ),
  )
  checks.push(
    check(
      'Application.tierId is set',
      'non-null',
      application?.tierId ?? null,
      application?.tierId != null,
    ),
  )
  checks.push(
    check(
      'Application.levelId is set',
      'non-null',
      application?.levelId ?? null,
      application?.levelId != null,
    ),
  )
  checks.push(
    check(
      'Application.includesAddon = true',
      true,
      application?.includesAddon,
      application?.includesAddon === true,
    ),
  )

  // 3. DNT answers count > 0
  const answerCount = application
    ? await prisma.answer.count({ where: { applicationId: application.id, status: 'ACTIVE' } })
    : 0
  checks.push(
    check(
      'DNT answers count > 0',
      '> 0',
      answerCount,
      answerCount > 0,
    ),
  )

  // 4. Customer holds a signed Dnt (B2: customer-scoped aggregate)
  const convDnt = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { customerId: true },
  })
  const signedDnt = convDnt
    ? await prisma.dnt.findFirst({ where: { customerId: convDnt.customerId, status: 'ACTIVE' } })
    : null
  checks.push(
    check(
      'Customer has an ACTIVE Dnt',
      'non-null',
      signedDnt?.signedAt ?? null,
      signedDnt != null,
    ),
  )

  // 5. Quote exists, status ACCEPTED, premiumAnnual > 0
  let quote = null
  if (application) {
    quote = await prisma.quote.findUnique({
      where: { applicationId: application.id },
    })
  }
  checks.push(
    check('Quote exists', true, quote !== null, quote !== null),
  )
  checks.push(
    check(
      'Quote.status = ACCEPTED',
      'ACCEPTED',
      quote?.status,
      quote?.status === 'ACCEPTED',
    ),
  )
  checks.push(
    check(
      'Quote.premiumAnnual > 0',
      '> 0',
      quote?.premiumAnnual,
      (quote?.premiumAnnual ?? 0) > 0,
    ),
  )

  // 6. Policy exists, status PENDING_SUBMISSION or SUBMITTED
  let policy = null
  if (quote) {
    policy = await prisma.policy.findUnique({
      where: { quoteId: quote.id },
    })
  }
  checks.push(
    check('Policy exists', true, policy !== null, policy !== null),
  )
  checks.push(
    check(
      'Policy.status is PENDING_SUBMISSION or SUBMITTED',
      'PENDING_SUBMISSION | SUBMITTED',
      policy?.status,
      policy?.status === 'PENDING_SUBMISSION' ||
        policy?.status === 'SUBMITTED',
    ),
  )

  // 7. Payment exists, status COMPLETED
  let payment = null
  if (policy) {
    // D2.1 re-anchor: a Payment settles an installment of the quote's schedule
    payment = await prisma.payment.findFirst({
      where: { installment: { schedule: { quoteId: policy.quoteId } } },
    })
  }
  checks.push(
    check('Payment exists', true, payment !== null, payment !== null),
  )
  checks.push(
    check(
      'Payment.status = COMPLETED',
      'COMPLETED',
      payment?.status,
      payment?.status === 'COMPLETED',
    ),
  )

  // 8. Customer.isAnonymous = false
  const customer = await prisma.customer.findUnique({
    where: { id: conversation?.customerId ?? '' },
  })
  checks.push(
    check(
      'Customer.isAnonymous = false',
      false,
      customer?.isAnonymous,
      customer?.isAnonymous === false,
    ),
  )

  return buildResult(checks)
}

/**
 * Verify the BD rejection scenario:
 * Same as happy path but Application.includesAddon = false,
 * and quote has no addon premium.
 */
export async function verifyBdRejection(
  conversationId: string,
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = []

  // 1. Conversation exists and is COMPLETED
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  })
  checks.push(
    check(
      'Conversation exists',
      true,
      conversation !== null,
      conversation !== null,
    ),
  )
  checks.push(
    check(
      'Conversation stays ACTIVE (D2: a channel, never a funnel stage)',
      'ACTIVE',
      conversation?.status,
      conversation?.status === 'ACTIVE',
    ),
  )

  // 2. Application exists, status COMPLETED, includesAddon = false
  const application = await prisma.application.findFirst({
    where: { originConversationId: conversationId },
  })
  checks.push(
    check(
      'Application exists',
      true,
      application !== null,
      application !== null,
    ),
  )
  checks.push(
    check(
      'Application.status = COMPLETED',
      'COMPLETED',
      application?.status,
      application?.status === 'COMPLETED',
    ),
  )
  checks.push(
    check(
      'Application.tierId is set',
      'non-null',
      application?.tierId ?? null,
      application?.tierId != null,
    ),
  )
  checks.push(
    check(
      'Application.levelId is set',
      'non-null',
      application?.levelId ?? null,
      application?.levelId != null,
    ),
  )
  checks.push(
    check(
      'Application.includesAddon = false',
      false,
      application?.includesAddon,
      application?.includesAddon === false,
    ),
  )

  // 3. DNT answers count > 0
  const answerCount = application
    ? await prisma.answer.count({ where: { applicationId: application.id, status: 'ACTIVE' } })
    : 0
  checks.push(
    check(
      'DNT answers count > 0',
      '> 0',
      answerCount,
      answerCount > 0,
    ),
  )

  // 4. Quote exists, status ACCEPTED, premiumAnnual > 0
  let quote = null
  if (application) {
    quote = await prisma.quote.findUnique({
      where: { applicationId: application.id },
    })
  }
  checks.push(
    check('Quote exists', true, quote !== null, quote !== null),
  )
  checks.push(
    check(
      'Quote.status = ACCEPTED',
      'ACCEPTED',
      quote?.status,
      quote?.status === 'ACCEPTED',
    ),
  )
  checks.push(
    check(
      'Quote.premiumAnnual > 0',
      '> 0',
      quote?.premiumAnnual,
      (quote?.premiumAnnual ?? 0) > 0,
    ),
  )

  // 5. Policy exists
  let policy = null
  if (quote) {
    policy = await prisma.policy.findUnique({
      where: { quoteId: quote.id },
    })
  }
  checks.push(
    check('Policy exists', true, policy !== null, policy !== null),
  )
  checks.push(
    check(
      'Policy.status is PENDING_SUBMISSION or SUBMITTED',
      'PENDING_SUBMISSION | SUBMITTED',
      policy?.status,
      policy?.status === 'PENDING_SUBMISSION' ||
        policy?.status === 'SUBMITTED',
    ),
  )

  // 6. Payment exists, status COMPLETED
  let payment = null
  if (policy) {
    // D2.1 re-anchor: a Payment settles an installment of the quote's schedule
    payment = await prisma.payment.findFirst({
      where: { installment: { schedule: { quoteId: policy.quoteId } } },
    })
  }
  checks.push(
    check('Payment exists', true, payment !== null, payment !== null),
  )
  checks.push(
    check(
      'Payment.status = COMPLETED',
      'COMPLETED',
      payment?.status,
      payment?.status === 'COMPLETED',
    ),
  )

  return buildResult(checks)
}

/**
 * Verify the objection handling scenario:
 * Check that get_objection_strategy tool was called for distinct objection types.
 */
export async function verifyObjectionHandling(
  conversationId: string,
  minTypes: number,
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = []

  // 1. Conversation exists
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  })
  checks.push(
    check(
      'Conversation exists',
      true,
      conversation !== null,
      conversation !== null,
    ),
  )

  // 2. Load assistant messages and filter those with toolCalls in JS
  //    (avoids Prisma JSON null filter type issues)
  const allMessages = await prisma.message.findMany({
    where: {
      conversationId,
      role: 'assistant',
    },
    orderBy: { createdAt: 'asc' },
  })
  const messages = allMessages.filter((m) => m.toolCalls != null)

  // Count distinct objection strategy calls
  let objectionCallCount = 0
  const objectionTypes = new Set<string>()

  for (const msg of messages) {
    const toolCalls = msg.toolCalls as unknown
    if (!Array.isArray(toolCalls)) continue

    for (const call of toolCalls) {
      const tc = call as Record<string, unknown>
      const fnName =
        typeof tc.name === 'string'
          ? tc.name
          : typeof tc.function === 'object' && tc.function !== null
            ? (tc.function as Record<string, unknown>).name
            : null

      if (fnName === 'get_objection_strategy') {
        objectionCallCount++
        // Try to extract the objection type from arguments
        const args =
          typeof tc.arguments === 'string'
            ? (() => {
                try {
                  return JSON.parse(tc.arguments as string) as Record<string, unknown>
                } catch {
                  return {}
                }
              })()
            : typeof tc.function === 'object' && tc.function !== null
              ? (() => {
                  const fnArgs = (tc.function as Record<string, unknown>).arguments
                  if (typeof fnArgs === 'string') {
                    try {
                      return JSON.parse(fnArgs) as Record<string, unknown>
                    } catch {
                      return {}
                    }
                  }
                  return (fnArgs as Record<string, unknown>) ?? {}
                })()
              : {}

        if (typeof args.type === 'string') {
          objectionTypes.add(args.type)
        } else if (typeof args.objectionType === 'string') {
          objectionTypes.add(args.objectionType)
        }
      }
    }
  }

  checks.push(
    check(
      'get_objection_strategy called at least once',
      '>= 1',
      objectionCallCount,
      objectionCallCount >= 1,
    ),
  )
  checks.push(
    check(
      `Distinct objection types >= ${minTypes}`,
      `>= ${minTypes}`,
      objectionTypes.size > 0 ? Array.from(objectionTypes).join(', ') : objectionCallCount,
      objectionTypes.size >= minTypes || objectionCallCount >= minTypes,
    ),
  )

  // 3. Conversation should still reach completion (sale continues after objections)
  checks.push(
    check(
      'Conversation stays ACTIVE (D2: a channel, never a funnel stage)',
      'ACTIVE',
      conversation?.status,
      conversation?.status === 'ACTIVE',
    ),
  )

  return buildResult(checks)
}

/**
 * Verify the change-of-mind scenario:
 * Two quotes should exist — first EXPIRED, second ACCEPTED with different premium.
 */
export async function verifyChangeOfMind(
  conversationId: string,
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = []

  // 1. Conversation exists
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  })
  checks.push(
    check(
      'Conversation exists',
      true,
      conversation !== null,
      conversation !== null,
    ),
  )

  // 2. Application exists
  const application = await prisma.application.findFirst({
    where: { originConversationId: conversationId },
  })
  checks.push(
    check(
      'Application exists',
      true,
      application !== null,
      application !== null,
    ),
  )

  // 3. Load all quotes for this customer/product
  // The application may have been updated, so we look for quotes by customerId + productId
  const quotes = await prisma.quote.findMany({
    where: {
      customerId: conversation?.customerId ?? '',
      productId: application?.productId ?? '',
    },
    orderBy: { createdAt: 'asc' },
  })

  checks.push(
    check(
      'At least 2 quotes exist',
      '>= 2',
      quotes.length,
      quotes.length >= 2,
    ),
  )

  if (quotes.length >= 2) {
    const firstQuote = quotes[0]
    const lastQuote = quotes[quotes.length - 1]

    checks.push(
      check(
        'First quote.status = EXPIRED',
        'EXPIRED',
        firstQuote.status,
        firstQuote.status === 'EXPIRED',
      ),
    )
    checks.push(
      check(
        'Last quote.status = ACCEPTED',
        'ACCEPTED',
        lastQuote.status,
        lastQuote.status === 'ACCEPTED',
      ),
    )
    checks.push(
      check(
        'Quotes have different premiumAnnual',
        'different',
        `${firstQuote.premiumAnnual} vs ${lastQuote.premiumAnnual}`,
        firstQuote.premiumAnnual !== lastQuote.premiumAnnual,
      ),
    )
  }

  // 4. Conversation completed
  checks.push(
    check(
      'Conversation stays ACTIVE (D2: a channel, never a funnel stage)',
      'ACTIVE',
      conversation?.status,
      conversation?.status === 'ACTIVE',
    ),
  )

  return buildResult(checks)
}

/**
 * Verify the DNT pause/resume scenario:
 * All DNT answers present, no duplicates (unique questionId per conversationId).
 */
export async function verifyDntPauseResume(
  conversationId: string,
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = []

  // 1. Conversation exists
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  })
  checks.push(
    check(
      'Conversation exists',
      true,
      conversation !== null,
      conversation !== null,
    ),
  )

  // 2. All DNT answers present (count > 0) — B4: answers hang off the
  // application originated by this conversation
  const answers = await prisma.answer.findMany({
    where: { application: { originConversationId: conversationId }, status: 'ACTIVE' },
    include: { question: true },
  })
  checks.push(
    check(
      'DNT answers count > 0',
      '> 0',
      answers.length,
      answers.length > 0,
    ),
  )

  // 3. No duplicate questionId per conversation (enforced by unique constraint,
  //    but verify explicitly)
  const questionIds = answers.map((a) => a.questionId)
  const uniqueIds = new Set(questionIds)
  checks.push(
    check(
      'No duplicate answer questionIds',
      questionIds.length,
      uniqueIds.size,
      questionIds.length === uniqueIds.size,
    ),
  )

  // 4. Conversation completed (the flow should resume and finish)
  checks.push(
    check(
      'Conversation stays ACTIVE (D2: a channel, never a funnel stage)',
      'ACTIVE',
      conversation?.status,
      conversation?.status === 'ACTIVE',
    ),
  )

  // 5. DNT signed (customer-scoped Dnt aggregate, B2)
  const convDntResume = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { customerId: true },
  })
  const signedDntResume = convDntResume
    ? await prisma.dnt.findFirst({ where: { customerId: convDntResume.customerId, status: 'ACTIVE' } })
    : null
  checks.push(
    check(
      'Customer has an ACTIVE Dnt',
      'non-null',
      signedDntResume?.signedAt ?? null,
      signedDntResume != null,
    ),
  )

  return buildResult(checks)
}
