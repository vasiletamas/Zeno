/**
 * Profile Handlers
 *
 * get_customer_profile — re-backed by the B0 provenance store: profile
 * facts with provenance, surfaced conflicts, the DERIVED age (E4.1, M2 —
 * DOB else declaredAge else CNP, never a stored snapshot), and a history
 * summary of store counts. Declared-field writes ride
 * collect_customer_field (B0's single write path) — there is no
 * update_customer_profile.
 */

import { getProfile, getIdentityFacts, getAge } from '@/lib/customer/profile-service'
import { deriveIdentityTier, missingIdentityFields } from '@/lib/engines/identity-rules'
import type { ToolHandler } from '@/lib/tools/types'

// ─────────────────────────────────────────────
// get_customer_profile
// ─────────────────────────────────────────────

export const getCustomerProfile: ToolHandler = async (_args, context) => {
  try {
    const customer = await context.db.customer.findUnique({
      where: { id: context.customerId },
    })

    if (!customer) {
      return { success: false, error: 'Customer not found.' }
    }

    const profile = await getProfile(context.customerId)

    // B3 (M2): the identity slice — tier derived, never stored.
    const facts = await getIdentityFacts(context.customerId)
    const identity = {
      tier: deriveIdentityTier(facts),
      verifiedChannels: facts.verifiedChannels,
      missingFields: missingIdentityFields(facts),
    }

    // Load recent conversations
    const conversations = await context.db.conversation.findMany({
      where: { customerId: context.customerId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        channel: true,
        createdAt: true,
        productId: true,
      },
    })

    // Load policies
    const policies = await context.db.policy.findMany({
      where: { customerId: context.customerId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        premiumAnnual: true,
        createdAt: true,
      },
    })

    // E4.1 (M2): derived age + a compact history summary of store counts
    const age = await getAge(context.customerId)
    const [applicationCount, quoteCount, policyCount, conversationCount] = await Promise.all([
      context.db.application.count({ where: { customerId: context.customerId } }),
      context.db.quote.count({ where: { customerId: context.customerId } }),
      context.db.policy.count({ where: { customerId: context.customerId } }),
      context.db.conversation.count({ where: { customerId: context.customerId } }),
    ])

    return {
      success: true,
      data: {
        profile: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          dateOfBirth: customer.dateOfBirth?.toISOString() ?? null,
          language: customer.language,
          isAnonymous: customer.isAnonymous,
          age,
          fields: profile.fields as unknown as Record<string, unknown>,
          conflicts: profile.conflicts,
        },
        identity: identity as unknown as Record<string, unknown>,
        historySummary: { applications: applicationCount, quotes: quoteCount, policies: policyCount, conversations: conversationCount },
        recentConversations: conversations as unknown as Record<string, unknown>[],
        policies: policies as unknown as Record<string, unknown>[],
      },
      message: `Customer profile: ${customer.name ?? 'Anonymous'}${customer.email ? `, ${customer.email}` : ''}.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
