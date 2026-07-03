/**
 * Runtime invariant monitors (F2.4, T14.D3 — the mechanical @contract
 * subset). PURE over per-turn facts the orchestrator already holds; findings
 * become turn anomalies (drawer badges + TurnDebug/TurnTrace rows), never
 * exceptions — monitors observe, they don't gate.
 */
export interface InvariantInput {
  /** Tool names the briefing recommended (parsed from nextBestAction). */
  briefingRecommendedActions: string[]
  /** The turn-start exposure the briefing was built from. */
  availableActions: string[]
  executorRejections: { tool: string; reason: string }[]
  writingToolResults: { tool: string; hasEnvelope: boolean }[]
  ledgerDispositions: ('fresh' | 'replay')[]
  confirmTokenReissues: number
}
export interface InvariantFinding {
  code: 'briefing_action_not_exposed' | 'executor_rejected_tool' | 'envelope_missing' | 'idempotent_replay' | 'confirm_token_reissued'
  severity: 'info' | 'warning' | 'critical'
  detail: Record<string, unknown>
}

export function evaluateTurnInvariants(i: InvariantInput): InvariantFinding[] {
  const out: InvariantFinding[] = []
  // briefing-integrity (the live 10-tool regression class): the prompt must
  // never recommend an action the executor wall would reject
  const missing = i.briefingRecommendedActions.filter((a) => !i.availableActions.includes(a))
  if (missing.length) out.push({ code: 'briefing_action_not_exposed', severity: 'critical', detail: { actions: missing } })
  if (i.executorRejections.length) out.push({ code: 'executor_rejected_tool', severity: 'warning', detail: { rejections: i.executorRejections } })
  const bare = i.writingToolResults.filter((r) => !r.hasEnvelope).map((r) => r.tool)
  if (bare.length) out.push({ code: 'envelope_missing', severity: 'critical', detail: { tools: bare } })
  const replays = i.ledgerDispositions.filter((d) => d === 'replay').length
  if (replays) out.push({ code: 'idempotent_replay', severity: 'info', detail: { count: replays } })
  if (i.confirmTokenReissues > 0) out.push({ code: 'confirm_token_reissued', severity: 'info', detail: { count: i.confirmTokenReissues } })
  return out
}

/** 'call open_dnt_session' → ['open_dnt_session']; prose fallbacks → []. */
export function recommendedActionsFromBriefing(nextBestAction: string | undefined): string[] {
  const m = nextBestAction?.match(/^call ([a-z0-9_]+)$/)
  return m ? [m[1]] : []
}
