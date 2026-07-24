import { PrismaClient } from '../../lib/generated/prisma/client'

// ============================================================
// MODEL CATALOG DEFINITIONS
// ============================================================

interface ModelDef {
  provider: 'OPENAI' | 'ANTHROPIC' | 'MOONSHOT'
  modelId: string
  displayName: string
  contextWindow: number
  supportsStreaming: boolean
  supportsTools: boolean
  supportsStructuredOutput: boolean
  costPer1kInputTokens: number
  costPer1kOutputTokens: number
}

export const MODELS: ModelDef[] = [
  {
    provider: 'OPENAI',
    modelId: 'gpt-5.4',
    displayName: 'GPT-5.4',
    contextWindow: 128_000,
    supportsStreaming: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    costPer1kInputTokens: 0.003,
    costPer1kOutputTokens: 0.015,
  },
  {
    provider: 'OPENAI',
    modelId: 'gpt-5.4-mini',
    displayName: 'GPT-5.4 Mini',
    contextWindow: 128_000,
    supportsStreaming: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    costPer1kInputTokens: 0.0004,
    costPer1kOutputTokens: 0.0016,
  },
  {
    // PLACEHOLDER pricing — replace with real rates (gpt-5.6-sol pricing was
    // unpublished as of 2026-07-15; values copied from gpt-5.4 so turn costs
    // stay order-of-magnitude sane rather than zero).
    provider: 'OPENAI',
    modelId: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    contextWindow: 128_000,
    supportsStreaming: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    costPer1kInputTokens: 0.003,
    costPer1kOutputTokens: 0.015,
  },
  {
    // PLACEHOLDER pricing — copied from claude-sonnet-4-6; this is main-chat's
    // seeded fallbackModel and previously had no catalog row at all.
    provider: 'ANTHROPIC',
    modelId: 'claude-sonnet-5',
    displayName: 'Claude Sonnet 5',
    contextWindow: 200_000,
    supportsStreaming: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    costPer1kInputTokens: 0.003,
    costPer1kOutputTokens: 0.015,
  },
  {
    provider: 'ANTHROPIC',
    modelId: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    contextWindow: 200_000,
    supportsStreaming: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    costPer1kInputTokens: 0.015,
    costPer1kOutputTokens: 0.075,
  },
  {
    provider: 'ANTHROPIC',
    modelId: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    contextWindow: 200_000,
    supportsStreaming: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    costPer1kInputTokens: 0.003,
    costPer1kOutputTokens: 0.015,
  },
  {
    provider: 'ANTHROPIC',
    modelId: 'claude-sonnet-4-20250514',
    displayName: 'Claude Sonnet 4',
    contextWindow: 200_000,
    supportsStreaming: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    costPer1kInputTokens: 0.003,
    costPer1kOutputTokens: 0.015,
  },
  {
    provider: 'ANTHROPIC',
    modelId: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    contextWindow: 200_000,
    supportsStreaming: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    costPer1kInputTokens: 0.0008,
    costPer1kOutputTokens: 0.004,
  },
  // ---- Moonshot AI (Kimi) — OpenAI-compatible vendor ----
  {
    // Kimi K2 flagship. PLACEHOLDER pricing — set the live Moonshot rates in
    // production; these are order-of-magnitude, not billing-accurate.
    provider: 'MOONSHOT',
    modelId: 'kimi-k2-0711-preview',
    displayName: 'Kimi K2',
    contextWindow: 128_000,
    supportsStreaming: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    costPer1kInputTokens: 0.0006,
    costPer1kOutputTokens: 0.0025,
  },
  {
    // Kimi K2 Turbo — higher throughput, larger context. PLACEHOLDER pricing.
    provider: 'MOONSHOT',
    modelId: 'kimi-k2-turbo-preview',
    displayName: 'Kimi K2 Turbo',
    contextWindow: 256_000,
    supportsStreaming: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    costPer1kInputTokens: 0.0024,
    costPer1kOutputTokens: 0.010,
  },
  {
    // Long-context Moonshot v1. PLACEHOLDER pricing.
    provider: 'MOONSHOT',
    modelId: 'moonshot-v1-128k',
    displayName: 'Moonshot v1 128k',
    contextWindow: 128_000,
    supportsStreaming: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    costPer1kInputTokens: 0.002,
    costPer1kOutputTokens: 0.005,
  },
]

// ============================================================
// SEED FUNCTION
// ============================================================

export async function seedModelCatalog(prisma: PrismaClient) {
  console.log('  Seeding model catalog...')

  for (const model of MODELS) {
    await prisma.modelCatalog.upsert({
      where: {
        provider_modelId: {
          provider: model.provider,
          modelId: model.modelId,
        },
      },
      update: {
        displayName: model.displayName,
        contextWindow: model.contextWindow,
        supportsStreaming: model.supportsStreaming,
        supportsTools: model.supportsTools,
        supportsStructuredOutput: model.supportsStructuredOutput,
        costPer1kInputTokens: model.costPer1kInputTokens,
        costPer1kOutputTokens: model.costPer1kOutputTokens,
      },
      create: {
        provider: model.provider,
        modelId: model.modelId,
        displayName: model.displayName,
        contextWindow: model.contextWindow,
        supportsStreaming: model.supportsStreaming,
        supportsTools: model.supportsTools,
        supportsStructuredOutput: model.supportsStructuredOutput,
        costPer1kInputTokens: model.costPer1kInputTokens,
        costPer1kOutputTokens: model.costPer1kOutputTokens,
      },
    })

    console.log(`    Model "${model.displayName}" (${model.provider}/${model.modelId}) upserted`)
  }

  console.log(`  ${MODELS.length} models seeded.`)
}
