import type { EventBus } from './event-bus'
import type { ZenoEvent } from './types'
import { prisma } from '@/lib/db'
import { LRUCache } from '@/lib/cache/lru-cache'
import { logWarn } from '@/lib/errors/logger'

// ==============================================
// PRICING CACHE
// ==============================================

interface ModelPricing {
  costPer1kInputTokens: number
  costPer1kOutputTokens: number
}

const pricingCache = new LRUCache<string, ModelPricing | null>(50, 5 * 60 * 1000)

async function getModelPricing(provider: string, model: string): Promise<ModelPricing | null> {
  const key = `${provider}:${model}`
  const cached = pricingCache.get(key)
  if (cached !== undefined) return cached

  try {
    const catalog = await prisma.modelCatalog.findFirst({
      where: { provider, modelId: model },
      select: { costPer1kInputTokens: true, costPer1kOutputTokens: true },
    })

    if (!catalog || catalog.costPer1kInputTokens === null || catalog.costPer1kOutputTokens === null) {
      pricingCache.set(key, null)
      return null
    }

    const pricing: ModelPricing = {
      costPer1kInputTokens: catalog.costPer1kInputTokens,
      costPer1kOutputTokens: catalog.costPer1kOutputTokens,
    }
    pricingCache.set(key, pricing)
    return pricing
  } catch {
    return null
  }
}

// ==============================================
// TURN COST ACCUMULATOR
// ==============================================

const turnCosts = new Map<string, number>()

export function getTurnCost(traceId: string): number | null {
  return turnCosts.get(traceId) ?? null
}

// ==============================================
// SUBSCRIBER
// ==============================================

export function registerCostSubscriber(bus: EventBus): void {
  bus.on('turn:start', (event) => {
    if (event.type !== 'turn:start') return
    turnCosts.set(event.traceId, 0)
  })

  bus.on('llm:call:end', (event) => {
    if (event.type !== 'llm:call:end') return
    const { traceId, provider, model, inputTokens, outputTokens } = event

    void getModelPricing(provider, model).then((pricing) => {
      if (!pricing) {
        logWarn({
          layer: 'orchestrator',
          category: 'cost_lookup_miss',
          message: `No pricing found for ${provider}/${model}`,
          context: { traceId, provider, model },
        })
        return
      }

      const cost =
        (inputTokens / 1000) * pricing.costPer1kInputTokens +
        (outputTokens / 1000) * pricing.costPer1kOutputTokens

      const current = turnCosts.get(traceId) ?? 0
      turnCosts.set(traceId, current + cost)
    })
  })

  bus.on('turn:end', (event) => {
    if (event.type !== 'turn:end') return
    setTimeout(() => turnCosts.delete(event.traceId), 1000)
  })
}
