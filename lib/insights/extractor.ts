import { prisma } from '@/lib/db'
import { gateway } from '@/lib/llm/gateway'
import { logError, logWarn } from '@/lib/errors/logger'
import { getActiveInsightKeys, findKeySpec, type InsightKeySpec } from '@/lib/insights/keys'

const DEFAULT_CONFIDENCE = 0.7
const PERSONAL_INFO_REGEX =
  /\b(ani|varsta|vârstă|copil|copii|soț|soție|sot|sotie|lucrez|căsătorit|casatorit|familie|venit|salariu|\d{13})\b/i

const PER_PRODUCT_CATEGORIES = new Set(['PREFERENCE'])

export interface ExtractorInput {
  message: string
  customerId: string
  conversationId: string
  productId: string | null
  mode: string
  traceId: string
}

interface ExtractedInsight {
  key: string
  value: unknown
  confidence?: number
}

export async function extractAndPersistInsights(input: ExtractorInput): Promise<void> {
  const { message, customerId, conversationId, productId, mode, traceId } = input

  if (mode !== 'SALES' && !PERSONAL_INFO_REGEX.test(message)) return

  let active: InsightKeySpec[]
  try {
    active = await getActiveInsightKeys(productId)
  } catch (err) {
    logError({
      layer: 'orchestrator',
      category: 'extractor_keys',
      message: 'Failed to load active insight keys',
      context: { customerId, conversationId, productId },
      error: err,
    })
    return
  }

  const systemPrompt = buildExtractorPrompt(active)

  let response
  try {
    response = await gateway.call('profile-extractor', {
      messages: [{ role: 'user' as const, content: message }],
      overrideSystemPrompt: systemPrompt,
      traceId,
    })
  } catch (err) {
    logError({
      layer: 'orchestrator',
      category: 'profile_extractor',
      message: 'Profile extractor LLM call failed',
      context: { customerId, conversationId },
      error: err,
    })
    return
  }

  if (!response.content) return

  let parsed: { insights?: ExtractedInsight[] }
  try {
    parsed = JSON.parse(response.content)
  } catch (err) {
    logWarn({
      layer: 'orchestrator',
      category: 'extractor_parse',
      message: 'Profile extractor returned non-JSON',
      context: { customerId, conversationId, raw: response.content.slice(0, 200) },
      error: err,
    })
    return
  }

  const insights = Array.isArray(parsed.insights) ? parsed.insights : []

  for (const item of insights) {
    if (!item || typeof item.key !== 'string' || item.value == null) continue

    const spec = findKeySpec(active, item.key)
    if (!spec) {
      logWarn({
        layer: 'orchestrator',
        category: 'extractor_drift',
        message: 'Extractor emitted key not in active vocabulary',
        context: { customerId, conversationId, key: item.key, productId },
      })
      continue
    }

    const stringValue = String(item.value)
    const confidence =
      typeof item.confidence === 'number' && item.confidence >= 0 && item.confidence <= 1
        ? item.confidence
        : DEFAULT_CONFIDENCE
    const stampProductId = PER_PRODUCT_CATEGORIES.has(spec.category) ? productId : null

    try {
      await prisma.customerInsight.upsert({
        where: { customerId_key: { customerId, key: spec.key } },
        update: {
          value: stringValue,
          confidence,
          source: conversationId,
          lastConfirmedAt: new Date(),
        },
        create: {
          customerId,
          productId: stampProductId,
          category: spec.category,
          key: spec.key,
          value: stringValue,
          confidence,
          source: conversationId,
        },
      })
    } catch (err) {
      logError({
        layer: 'orchestrator',
        category: 'extractor_upsert',
        message: 'Failed to upsert insight',
        context: { customerId, key: spec.key },
        error: err,
      })
    }
  }
}

function buildExtractorPrompt(active: InsightKeySpec[]): string {
  const lines: string[] = []
  lines.push('Extract customer information from the message. Output JSON ONLY.')
  lines.push('')
  lines.push('Allowed keys (output ONLY keys from this list, never invent new ones):')
  for (const spec of active) {
    const opt = spec.options ? ` options=[${spec.options.join('|')}]` : ''
    lines.push(`  - ${spec.key} (${spec.type}, ${spec.category})${opt}`)
  }
  lines.push('')
  lines.push('Output format:')
  lines.push('{ "insights": [ { "key": "<one from list>", "value": <typed value>, "confidence": 0.0-1.0 } ] }')
  lines.push('')
  lines.push('Rules:')
  lines.push('- Only emit insights the customer explicitly stated. Never infer or guess.')
  lines.push('- If the message contains no extractable facts, return { "insights": [] }.')
  lines.push('- For enum keys, value MUST match one of the listed options exactly.')
  lines.push('- confidence reflects how clearly the customer stated this fact.')
  return lines.join('\n')
}
