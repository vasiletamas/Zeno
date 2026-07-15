/**
 * Prompt-cost report (A2, plan 2026-07-06): aggregates persisted TurnDebug
 * payloads into per-phase averages. Consumed by scripts/measure-prompt-cost.ts
 * (the baseline note) and re-run after each cost-affecting workstream (D, E)
 * to prove the effect against the same numbers.
 *
 * Pure functions over already-loaded rows — no DB access here.
 */

// The slice of the persisted DebugTurn payload this report reads. Fields are
// optional because pre-A1 rows lack the telemetry (and no-LLM turns lack totals).
export interface TurnDebugPayloadSlice {
  gate?: { derivedPhase?: string }
  prompt?: {
    sectionSizes?: Record<string, number>
    totalChars?: number
    stablePrefixChars?: number
    dynamicSuffixChars?: number
  }
  totals?: {
    totalInputTokens?: number
    totalOutputTokens?: number
    totalCacheReadTokens?: number
    totalCacheWriteTokens?: number
    llmCalls?: number
    cacheHitCalls?: number
    toolDefChars?: number
  }
}

export interface TurnCostRow {
  conversationId: string
  messageIndex: number
  payload: TurnDebugPayloadSlice
}

export interface PhaseCostStats {
  turns: number
  measuredTurns: number
  avgPromptTokens: number
  avgCompletionTokens: number
  avgCacheReadTokens: number
  avgCacheWriteTokens: number
  /** Call-level hit rate: cache-hit LLM calls / total LLM calls in the phase. */
  cacheHitRate: number | null
  avgStablePrefixChars: number
  avgDynamicSuffixChars: number
  avgToolDefChars: number
  /** agentIdentity section chars / total prompt chars, averaged over turns with a prompt record. */
  avgIdentityShare: number | null
}

export interface PromptCostReport {
  turns: number
  conversations: number
  turnsWithoutUsage: number
  byPhase: Record<string, PhaseCostStats>
  overall: PhaseCostStats
}

interface Accumulator {
  turns: number
  measuredTurns: number
  promptTokens: number
  completionTokens: number
  cacheRead: number
  cacheWrite: number
  llmCalls: number
  cacheHitCalls: number
  stableChars: number
  dynamicChars: number
  toolDefChars: number
  promptRecords: number
  identityShareSum: number
  identityShareRecords: number
}

function emptyAcc(): Accumulator {
  return {
    turns: 0, measuredTurns: 0, promptTokens: 0, completionTokens: 0,
    cacheRead: 0, cacheWrite: 0, llmCalls: 0, cacheHitCalls: 0,
    stableChars: 0, dynamicChars: 0, toolDefChars: 0,
    promptRecords: 0, identityShareSum: 0, identityShareRecords: 0,
  }
}

function ingest(acc: Accumulator, row: TurnCostRow): void {
  acc.turns += 1

  const totals = row.payload.totals
  if (totals && (totals.llmCalls ?? 0) > 0) {
    acc.measuredTurns += 1
    acc.promptTokens += totals.totalInputTokens ?? 0
    acc.completionTokens += totals.totalOutputTokens ?? 0
    acc.cacheRead += totals.totalCacheReadTokens ?? 0
    acc.cacheWrite += totals.totalCacheWriteTokens ?? 0
    acc.llmCalls += totals.llmCalls ?? 0
    acc.cacheHitCalls += totals.cacheHitCalls ?? 0
    acc.toolDefChars += totals.toolDefChars ?? 0
  }

  const prompt = row.payload.prompt
  if (prompt) {
    acc.promptRecords += 1
    acc.stableChars += prompt.stablePrefixChars ?? 0
    acc.dynamicChars += prompt.dynamicSuffixChars ?? 0
    const identityChars = prompt.sectionSizes?.agentIdentity ?? 0
    const totalChars = prompt.totalChars ?? 0
    if (totalChars > 0) {
      acc.identityShareSum += identityChars / totalChars
      acc.identityShareRecords += 1
    }
  }
}

function finalize(acc: Accumulator): PhaseCostStats {
  const m = acc.measuredTurns
  return {
    turns: acc.turns,
    measuredTurns: m,
    avgPromptTokens: m > 0 ? acc.promptTokens / m : 0,
    avgCompletionTokens: m > 0 ? acc.completionTokens / m : 0,
    avgCacheReadTokens: m > 0 ? acc.cacheRead / m : 0,
    avgCacheWriteTokens: m > 0 ? acc.cacheWrite / m : 0,
    cacheHitRate: acc.llmCalls > 0 ? acc.cacheHitCalls / acc.llmCalls : null,
    avgStablePrefixChars: acc.promptRecords > 0 ? acc.stableChars / acc.promptRecords : 0,
    avgDynamicSuffixChars: acc.promptRecords > 0 ? acc.dynamicChars / acc.promptRecords : 0,
    avgToolDefChars: m > 0 ? acc.toolDefChars / m : 0,
    avgIdentityShare: acc.identityShareRecords > 0 ? acc.identityShareSum / acc.identityShareRecords : null,
  }
}

export function buildPromptCostReport(rows: TurnCostRow[]): PromptCostReport {
  const byPhase = new Map<string, Accumulator>()
  const overall = emptyAcc()
  const conversations = new Set<string>()
  let turnsWithoutUsage = 0

  for (const row of rows) {
    conversations.add(row.conversationId)
    const phase = row.payload.gate?.derivedPhase ?? 'UNKNOWN'
    const acc = byPhase.get(phase) ?? emptyAcc()
    ingest(acc, row)
    byPhase.set(phase, acc)
    ingest(overall, row)
    if (!row.payload.totals || (row.payload.totals.llmCalls ?? 0) === 0) turnsWithoutUsage += 1
  }

  return {
    turns: rows.length,
    conversations: conversations.size,
    turnsWithoutUsage,
    byPhase: Object.fromEntries([...byPhase.entries()].map(([k, v]) => [k, finalize(v)])),
    overall: finalize(overall),
  }
}

function fmt(n: number | null, digits = 0): string {
  if (n === null) return '—'
  return n.toFixed(digits)
}

export function formatPromptCostReport(report: PromptCostReport): string {
  const lines: string[] = []
  lines.push(`Turns: ${report.turns} (${report.turnsWithoutUsage} without usage) across ${report.conversations} conversations`)
  lines.push('')
  lines.push('| Phase | Turns | Avg prompt tok | Avg cache read | Hit rate | Stable chars | Dynamic chars | Tooldef chars | Identity share |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  const row = (name: string, s: PhaseCostStats) =>
    `| ${name} | ${s.turns} | ${fmt(s.avgPromptTokens)} | ${fmt(s.avgCacheReadTokens)} | ${s.cacheHitRate === null ? '—' : (s.cacheHitRate * 100).toFixed(0) + '%'} | ${fmt(s.avgStablePrefixChars)} | ${fmt(s.avgDynamicSuffixChars)} | ${fmt(s.avgToolDefChars)} | ${s.avgIdentityShare === null ? '—' : (s.avgIdentityShare * 100).toFixed(0) + '%'} |`
  for (const [phase, stats] of Object.entries(report.byPhase)) lines.push(row(phase, stats))
  lines.push(row('OVERALL', report.overall))
  return lines.join('\n')
}
