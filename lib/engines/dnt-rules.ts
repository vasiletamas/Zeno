/**
 * DNT rules — PURE (T12.D3); consumed by deriveAndExpose (A1) and the DNT
 * handlers. Validity fails closed on status, expiry, and coverage (T3.D3);
 * the ENGINE decides new-vs-update from DNT state (#7); exposure follows the
 * #12 full-snapshot predicates including application-free renewal.
 */

export const DNT_VALIDITY_DAYS = 365
export const DNT_RENEWAL_WINDOW_DAYS = 30

export type ProductTypeStr = 'LIFE'

export interface DntFact {
  status: string
  signedAt: Date
  validUntil: Date
  productTypesCovered: ProductTypeStr[]
}

export function isDntValidFor(d: DntFact | null, productType: ProductTypeStr, now: Date): boolean {
  return !!d && d.status === 'ACTIVE' && d.validUntil > now && d.productTypesCovered.includes(productType)
}

export function isExpiringOrExpired(d: DntFact, now: Date): boolean {
  return d.validUntil.getTime() - now.getTime() < DNT_RENEWAL_WINDOW_DAYS * 86400e3
}

// #7: only a customer with NO Dnt history gets NEW; any prior Dnt means the
// session pre-fills from it (UPDATE) — regardless of its expiry state.
export function decideSessionType(latest: DntFact | null, _now: Date): 'NEW' | 'UPDATE' {
  return latest ? 'UPDATE' : 'NEW'
}

export function computeCoverage(sessionProductType: ProductTypeStr): ProductTypeStr[] {
  return [sessionProductType]
}

export interface DntExposureInput {
  productTypeInFocus: ProductTypeStr | null
  latestDnt: DntFact | null
  activeSession: { id: string } | null
  sessionHasPendingQuestion: boolean
  sessionFinished: boolean
  openApplicationProductType: ProductTypeStr | null
  now: Date
}

export function dntExposure(i: DntExposureInput): { available: string[]; blocked: { action: string; reason: string; params?: Record<string, unknown> }[] } {
  const available: string[] = []
  const blocked: { action: string; reason: string; params?: Record<string, unknown> }[] = []
  if (i.productTypeInFocus || i.latestDnt) available.push('get_dnt_state')
  if (i.productTypeInFocus || i.activeSession) available.push('get_dnt_questions')
  if (i.activeSession) available.push('get_dnt_next_question')
  const needsForApp = i.openApplicationProductType && !isDntValidFor(i.latestDnt, i.openApplicationProductType, i.now)
  const needsForFocus = i.productTypeInFocus && !isDntValidFor(i.latestDnt, i.productTypeInFocus, i.now)
  const renewal = i.latestDnt && isExpiringOrExpired(i.latestDnt, i.now) // application-free renewal (#12)
  if (i.activeSession) blocked.push({ action: 'open_dnt_session', reason: 'dnt_session_already_active', params: { activeSessionId: i.activeSession.id } })
  else if (needsForApp || needsForFocus || renewal) available.push('open_dnt_session')
  if (i.activeSession && i.sessionHasPendingQuestion) available.push('write_dnt_answer')
  if (i.activeSession && i.sessionFinished) available.push('sign_dnt')
  else if (i.activeSession) blocked.push({ action: 'sign_dnt', reason: 'dnt_session_incomplete' })
  return { available, blocked }
}
