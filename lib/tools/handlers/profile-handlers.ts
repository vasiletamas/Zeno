/**
 * Profile Handlers
 *
 * get_customer_profile, update_customer_profile
 */

import { prisma } from '@/lib/db'
import type { ToolHandler } from '@/lib/tools/types'

// ─────────────────────────────────────────────
// get_customer_profile
// ─────────────────────────────────────────────

export const getCustomerProfile: ToolHandler = async (_args, context) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: context.customerId },
    })

    if (!customer) {
      return { success: false, error: 'Customer not found.' }
    }

    const extractedProfile = (customer.extractedProfile ?? {}) as Record<string, unknown>

    // Load recent conversations
    const conversations = await prisma.conversation.findMany({
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
    const policies = await prisma.policy.findMany({
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
          extractedProfile,
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

// ─────────────────────────────────────────────
// update_customer_profile
// ─────────────────────────────────────────────

export const updateCustomerProfile: ToolHandler = async (args, context) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: context.customerId },
    })

    if (!customer) {
      return { success: false, error: 'Customer not found.' }
    }

    // Merge fields into extractedProfile
    const existing = (customer.extractedProfile ?? {}) as Record<string, unknown>
    const merged = { ...existing, ...args }

    await prisma.customer.update({
      where: { id: context.customerId },
      data: { extractedProfile: JSON.parse(JSON.stringify(merged)) },
    })

    const updatedFields = Object.keys(args)

    return {
      success: true,
      data: {
        updatedFields,
        extractedProfile: merged,
      },
      message: `Updated customer profile: ${updatedFields.join(', ')}.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
