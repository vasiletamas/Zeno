import { PrismaClient } from '../../lib/generated/prisma/client'

// ============================================================
// MODEL CATALOG DEFINITIONS
// ============================================================

interface ModelDef {
  provider: 'OPENAI' | 'ANTHROPIC'
  modelId: string
  displayName: string
  supportsStreaming: boolean
  supportsTools: boolean
  supportsStructuredOutput: boolean
  costPer1kInputTokens: number
  costPer1kOutputTokens: number
}

const MODELS: ModelDef[] = [
  {
    provider: 'OPENAI',
    modelId: 'gpt-5.2',
    displayName: 'GPT-5.2',
    supportsStreaming: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    costPer1kInputTokens: 0.003,
    costPer1kOutputTokens: 0.015,
  },
  {
    provider: 'OPENAI',
    modelId: 'gpt-5.2-mini',
    displayName: 'GPT-5.2 Mini',
    supportsStreaming: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    costPer1kInputTokens: 0.0004,
    costPer1kOutputTokens: 0.0016,
  },
  {
    provider: 'ANTHROPIC',
    modelId: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
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
    supportsStreaming: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    costPer1kInputTokens: 0.0008,
    costPer1kOutputTokens: 0.004,
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
