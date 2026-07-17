/**
 * Purchase Intent Handlers (T8, design 2026-07-15)
 *
 * set_purchase_intent — the customer's commitment to a quote or a purchase,
 * recorded as a LEDGERED commit the moment it happens (never prose). One
 * ACTIVE intent per customer: a newer intent supersedes the prior (→ stale),
 * an explicit withdrawal renounces it ({renounce: true}), and accept_quote
 * fulfils it (quote-handlers). The snapshot loader surfaces the latest
 * active row as the `intent` slice the briefing turns into momentum.
 */

import type { ToolHandler } from '@/lib/tools/types'
import { resolveProductRef, listAvailableProductRefs } from '@/lib/tools/resolve-product'

type IntentConfig = { tier?: string; level?: string; addon?: boolean }

const configsEqual = (a: IntentConfig | null, b: IntentConfig | null): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export const setPurchaseIntent: ToolHandler = async (args, context) => {
  try {
    if (args.renounce === true) {
      const updated = await context.db.purchaseIntent.updateMany({
        where: { customerId: context.customerId, status: 'active' },
        data: { status: 'renounced' },
      })
      // No active intent to renounce is a harmless no-op apply — rejecting
      // would only teach the model to hammer the tool.
      return {
        success: true,
        data: { renounced: updated.count > 0 },
        message: updated.count > 0 ? 'Purchase intent renounced.' : 'No active purchase intent to renounce.',
        confirmation: { category: 'save', label: 'Purchase intent', value: 'renounced', timestamp: new Date().toISOString() },
      }
    }

    // zod guarantees goal+productCode are present on the non-renounce path
    const goal = args.goal as 'quote' | 'purchase'
    const rawCode = args.productCode as string
    const config = (args.config as IntentConfig | undefined) ?? null

    // Tolerant resolution (set_candidate_product precedent): the agent
    // passes codes, ids and aliases in this slot — store the CANONICAL code.
    const ref = await resolveProductRef({ productId: rawCode, productCode: rawCode })
    if (!ref) {
      const available = await listAvailableProductRefs()
      return {
        success: false,
        error: `Product not found: "${rawCode}". Available codes: ${available.map((p) => p.code).join(', ') || '(none)'}.`,
      }
    }

    const current = await context.db.purchaseIntent.findFirst({
      where: { customerId: context.customerId, status: 'active' },
      orderBy: { capturedAt: 'desc' },
    })
    // Duplicate-safe (state-guarded, REPLAY_EXEMPT): an identical re-commit
    // is answered here, never by a stale ledger envelope.
    if (current && current.goal === goal && current.productCode === ref.code && configsEqual(current.config as IntentConfig | null, config)) {
      return {
        success: true,
        data: { intentId: current.id, goal, productCode: ref.code, config, unchanged: true },
        message: `Purchase intent already recorded: ${goal} ${ref.code}. No change.`,
        confirmation: { category: 'save', label: 'Purchase intent', value: `${goal} ${ref.code}`, timestamp: new Date().toISOString() },
      }
    }

    // A newer intent supersedes: the prior active row(s) go stale, ONE
    // active row remains per customer.
    const superseded = await context.db.purchaseIntent.updateMany({
      where: { customerId: context.customerId, status: 'active' },
      data: { status: 'stale' },
    })
    const intent = await context.db.purchaseIntent.create({
      data: {
        customerId: context.customerId,
        conversationId: context.conversationId,
        goal,
        productCode: ref.code,
        config: config ?? undefined,
      },
    })

    return {
      success: true,
      data: { intentId: intent.id, goal, productCode: ref.code, config, superseded: superseded.count },
      message: `Purchase intent recorded: ${goal} ${ref.code}${config ? ` (${[config.tier, config.level].filter(Boolean).join('/')}${config.addon ? ' + addon' : ''})` : ''}. The funnel proceeds without re-asking readiness.`,
      confirmation: { category: 'save', label: 'Purchase intent', value: `${goal} ${ref.code}`, timestamp: new Date().toISOString() },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
