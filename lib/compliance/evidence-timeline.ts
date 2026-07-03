/**
 * Compliance evidence timeline (F2.6, T14.D4/D5): a pure view-model builder
 * merging the four evidence streams — commits, consents, disclosures,
 * verifications — into one chronological list. Labels are code-built strings
 * carrying field NAMES, provenance states and reference ids only, never
 * customer values (T14.D5): what changed, when, under which content version,
 * with a pointer to the evidence record.
 */

import type { CommitLedgerExportRow } from '@/lib/debug/conversation-export'

export interface ConsentTimelineInput {
  kind: string
  action: string
  scope: string | null
  sourceCommitId: string | null
  createdAt: string
}

export interface DisclosureTimelineInput {
  kind: string
  /** The ProductContent/document version in force when acknowledged (M8 pin 1). */
  contentVersion: string
  language: string
  createdAt: string
}

export interface VerificationTimelineInput {
  /** Field or channel NAME only — never the value. */
  field: string
  state: string
  evidenceRecordId: string
  createdAt: string
}

export interface EvidenceTimelineEntry {
  at: string
  kind: 'commit' | 'consent' | 'disclosure' | 'verification'
  label: string
  refs: Record<string, string>
}

export function buildEvidenceTimeline(input: {
  ledger: CommitLedgerExportRow[]
  consents: ConsentTimelineInput[]
  disclosures: DisclosureTimelineInput[]
  verifications: VerificationTimelineInput[]
}): EvidenceTimelineEntry[] {
  const entries: EvidenceTimelineEntry[] = []

  for (const r of input.ledger) {
    entries.push({
      at: r.createdAt,
      kind: 'commit',
      label: `${r.tool} ${r.outcome} (${r.actor})`,
      refs: {
        ledgerId: r.id,
        ...(r.targetRef ? { targetRef: r.targetRef } : {}),
        ...(r.reasonCode ? { reasonCode: r.reasonCode } : {}),
      },
    })
  }
  for (const c of input.consents) {
    entries.push({
      at: c.createdAt,
      kind: 'consent',
      label: `${c.kind} ${c.action}${c.scope ? ` (${c.scope})` : ''}`,
      refs: c.sourceCommitId ? { sourceCommitId: c.sourceCommitId } : {},
    })
  }
  for (const d of input.disclosures) {
    entries.push({
      at: d.createdAt,
      kind: 'disclosure',
      label: `disclosure ${d.kind} v=${d.contentVersion} lang=${d.language}`,
      refs: {},
    })
  }
  for (const v of input.verifications) {
    entries.push({
      at: v.createdAt,
      kind: 'verification',
      label: `${v.field} -> ${v.state} (evidence ${v.evidenceRecordId})`,
      refs: { evidenceRecordId: v.evidenceRecordId },
    })
  }

  // Sort by timestamp; Array.prototype.sort is stable, so ties keep the
  // push order above (ledger, consents, disclosures, verifications).
  return entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
}
