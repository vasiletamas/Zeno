/**
 * Proposer Agent — generates improvement proposals by analyzing
 * top/bottom conversation transcripts via the LLM.
 */

import { prisma } from '@/lib/db'
import { gateway } from '@/lib/llm/gateway'
import { logError, logInfo } from '@/lib/errors/logger'
import type { AnalysisResult, ProposalDiff } from './types'

const PROPOSER_AGENT_SLUG = 'main-chat' // Uses the same LLM provider as sales agent

interface LLMProposal {
  type: string
  title: string
  description: string
  diff: ProposalDiff
  confidence: number
}

interface LLMProposalResponse {
  proposals: LLMProposal[]
}

const VALID_TYPES = new Set(['KNOWLEDGE_CREATE', 'KNOWLEDGE_UPDATE', 'SKILLPACK_UPDATE', 'INSIGHT'])

function isValidProposal(p: unknown): p is LLMProposal {
  if (typeof p !== 'object' || p === null) return false
  const obj = p as Record<string, unknown>
  return (
    typeof obj.type === 'string' &&
    VALID_TYPES.has(obj.type) &&
    typeof obj.title === 'string' &&
    obj.title.length > 0 &&
    typeof obj.description === 'string' &&
    typeof obj.diff === 'object' &&
    obj.diff !== null &&
    typeof obj.confidence === 'number'
  )
}

export async function generateProposals(analysis: AnalysisResult): Promise<number> {
  const allConvIds = [...analysis.topConversationIds, ...analysis.bottomConversationIds]
  if (allConvIds.length === 0) return 0

  // Load conversation transcripts
  const messages = await prisma.message.findMany({
    where: { conversationId: { in: allConvIds } },
    orderBy: { createdAt: 'asc' },
    select: { conversationId: true, role: true, content: true },
  })

  // Group messages by conversation
  const transcripts: Record<string, { role: string; content: string }[]> = {}
  for (const m of messages) {
    ;(transcripts[m.conversationId] ??= []).push({ role: m.role, content: m.content })
  }

  // Load current knowledge and skill packs for context
  const currentKnowledge = await prisma.agentKnowledge.findMany({
    where: { isActive: true },
    select: { category: true, trigger: true, content: true, successRate: true, sampleSize: true },
  })

  const currentSkillPacks = await prisma.skillPack.findMany({
    where: { isActive: true },
    select: { slug: true, name: true, promptSections: true, constraints: true },
  })

  // Build prompt
  const topTranscripts = analysis.topConversationIds
    .map((id) => `### Conversation ${id} (HIGH SCORE)\n${formatTranscript(transcripts[id] ?? [])}`)
    .join('\n\n')

  const bottomTranscripts = analysis.bottomConversationIds
    .map((id) => `### Conversation ${id} (LOW SCORE)\n${formatTranscript(transcripts[id] ?? [])}`)
    .join('\n\n')

  const prompt = `You are an AI sales coach analyzing conversation performance for a life insurance sales agent (Zeno).

## Analysis Summary
- Skill pack performance: ${JSON.stringify(analysis.skillPackPerformance)}
- Patterns detected: ${analysis.patterns.join('; ') || 'None'}

## Top Performing Conversations
${topTranscripts}

## Bottom Performing Conversations
${bottomTranscripts}

## Current Agent Knowledge (${currentKnowledge.length} entries)
${JSON.stringify(currentKnowledge.slice(0, 20), null, 2)}

## Current Skill Packs (${currentSkillPacks.length} active)
${currentSkillPacks.map((sp) => `- ${sp.slug}: ${sp.name}`).join('\n')}

## Your Task
Analyze the differences between high and low performing conversations. Generate specific, actionable improvement proposals.

Respond with ONLY valid JSON in this exact format:
{
  "proposals": [
    {
      "type": "KNOWLEDGE_CREATE | KNOWLEDGE_UPDATE | SKILLPACK_UPDATE | INSIGHT",
      "title": "Short description",
      "description": "Detailed explanation with evidence from the conversations",
      "diff": {
        "create": { "category": "OBJECTION_RESPONSE", "trigger": "pattern", "content": "response text" }
      },
      "confidence": 0.0-1.0
    }
  ]
}

For KNOWLEDGE_CREATE: diff.create = { category, trigger, content, productId?, workflowStepCode? }
For KNOWLEDGE_UPDATE: diff.update = { knowledgeId, before: {}, after: {} }
For SKILLPACK_UPDATE: diff.skillPackUpdate = { skillPackSlug, sectionKey, before, after }
For INSIGHT: diff.insight = { observation }

Generate 1-5 proposals. Only propose changes you are confident about (>0.6).`

  // Call LLM
  let response
  try {
    response = await gateway.call(PROPOSER_AGENT_SLUG, {
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      maxTokens: 4000,
    })
  } catch (err) {
    logError({
      layer: 'self-improvement',
      category: 'proposer',
      message: 'LLM call failed',
      error: err,
    })
    return 0
  }

  // Parse response
  const content = typeof response.content === 'string' ? response.content : ''
  let parsed: LLMProposalResponse
  try {
    // Handle potential markdown code blocks
    const jsonStr = content.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim()
    parsed = JSON.parse(jsonStr) as LLMProposalResponse
  } catch {
    logError({
      layer: 'self-improvement',
      category: 'proposer',
      message: 'Failed to parse LLM response as JSON',
      context: { responseLength: content.length },
    })
    return 0
  }

  if (!Array.isArray(parsed.proposals)) return 0

  // Create valid proposals
  let created = 0
  for (const proposal of parsed.proposals) {
    if (!isValidProposal(proposal)) continue

    await prisma.improvementProposal.create({
      data: {
        type: proposal.type as 'KNOWLEDGE_CREATE' | 'KNOWLEDGE_UPDATE' | 'SKILLPACK_UPDATE' | 'INSIGHT',
        title: proposal.title,
        description: proposal.description,
        diff: proposal.diff as Record<string, unknown>,
        evidence: {
          conversationIds: allConvIds,
          sampleSize: allConvIds.length,
          confidence: proposal.confidence,
        },
        status: 'PENDING',
      },
    })
    created++
  }

  logInfo({
    layer: 'self-improvement',
    category: 'proposer',
    message: `Generated ${created} proposals from ${allConvIds.length} conversations`,
  })

  return created
}

function formatTranscript(messages: { role: string; content: string }[]): string {
  return messages
    .map((m) => `**${m.role}:** ${m.content.slice(0, 500)}`)
    .join('\n')
}
