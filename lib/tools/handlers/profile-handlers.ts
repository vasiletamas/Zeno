/**
 * Profile Handlers
 *
 * get_customer_profile. Profile facts live in the CustomerProfileField
 * provenance store (B0); until B0.4 re-backs this handler with the
 * profile-service, `fields` is returned empty.
 */

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
          fields: {},
        },
        recentConversations: conversations as unknown as Record<string, unknown>[],
        policies: policies as unknown as Record<string, unknown>[],
      },
      message: `Customer profile: ${customer.name ?? 'Anonymous'}${customer.email ? `, ${customer.email}` : ''}.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
