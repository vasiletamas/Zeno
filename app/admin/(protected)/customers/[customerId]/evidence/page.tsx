/**
 * Admin compliance evidence timeline (F2.6, T14.D4/D5)
 *
 * Server component, direct prisma reads. One chronological view per customer
 * answering "what changed, when, under which content version, with what
 * evidence" — commits (CommitLedger), consents (ConsentEvent), disclosures
 * (DisclosureAck) and verifications (CustomerProfileField provenance=verified
 * + consumed VerificationChallenge rows, erratum 1 reconciliation). Labels
 * are reference-only: field names, states and record ids — never values.
 */

import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import {
  buildEvidenceTimeline,
  type EvidenceTimelineEntry,
} from '@/lib/compliance/evidence-timeline'

const KIND_STYLES: Record<EvidenceTimelineEntry['kind'], string> = {
  commit: 'bg-blue-100 text-blue-800',
  consent: 'bg-green-100 text-green-800',
  disclosure: 'bg-amber-100 text-amber-800',
  verification: 'bg-purple-100 text-purple-800',
}

export default async function CustomerEvidencePage({
  params,
}: {
  params: Promise<{ customerId: string }>
}) {
  const { customerId } = await params

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, erasedAt: true },
  })
  if (!customer) notFound()

  const [ledgerRows, consentRows, disclosureRows, verifiedFields, challenges] =
    await Promise.all([
      prisma.commitLedger.findMany({
        where: { customerId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, tool: true, actor: true, outcome: true, effects: true, reasonCode: true,
          phaseFrom: true, phaseTo: true, idempotencyDisposition: true, targetRef: true, createdAt: true,
        },
      }),
      prisma.consentEvent.findMany({
        where: { customerId },
        orderBy: { createdAt: 'asc' },
        select: { kind: true, action: true, scope: true, sourceCommitId: true, createdAt: true },
      }),
      prisma.disclosureAck.findMany({
        where: { customerId },
        orderBy: { acknowledgedAt: 'asc' },
        select: { kind: true, version: true, language: true, acknowledgedAt: true },
      }),
      prisma.customerProfileField.findMany({
        where: { customerId, provenance: 'verified' },
        orderBy: { recordedAt: 'asc' },
        select: { field: true, evidenceRef: true, recordedAt: true },
      }),
      prisma.verificationChallenge.findMany({
        where: { customerId, consumedAt: { not: null } },
        orderBy: { consumedAt: 'asc' },
        select: { id: true, channel: true, consumedAt: true },
      }),
    ])

  const timeline = buildEvidenceTimeline({
    ledger: ledgerRows.map((r) => ({
      id: r.id,
      tool: r.tool,
      actor: r.actor,
      outcome: r.outcome,
      effects: r.effects,
      reasonCode: r.reasonCode,
      phaseFrom: r.phaseFrom,
      phaseTo: r.phaseTo,
      idempotencyDisposition: r.idempotencyDisposition,
      targetRef: r.targetRef,
      createdAt: r.createdAt.toISOString(),
    })),
    consents: consentRows.map((c) => ({
      kind: String(c.kind),
      action: String(c.action),
      scope: c.scope,
      sourceCommitId: c.sourceCommitId,
      createdAt: c.createdAt.toISOString(),
    })),
    disclosures: disclosureRows.map((d) => ({
      kind: String(d.kind),
      contentVersion: `v${d.version}`,
      language: d.language,
      createdAt: d.acknowledgedAt.toISOString(),
    })),
    verifications: [
      ...verifiedFields.map((f) => ({
        field: f.field,
        state: 'verified',
        evidenceRecordId: f.evidenceRef ?? 'profile_field',
        createdAt: f.recordedAt.toISOString(),
      })),
      ...challenges.map((ch) => ({
        field: String(ch.channel),
        state: 'channel_verified',
        evidenceRecordId: ch.id,
        createdAt: ch.consumedAt!.toISOString(),
      })),
    ],
  })

  const byDay = new Map<string, EvidenceTimelineEntry[]>()
  for (const entry of timeline) {
    const day = entry.at.slice(0, 10)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day)!.push(entry)
  }

  return (
    <div>
      <h2 className="mb-2 text-xl font-medium text-night">
        Evidence timeline
        <span className="ml-2 font-mono text-sm text-muted">{customerId}</span>
        {customer.erasedAt && (
          <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">
            erased {customer.erasedAt.toISOString().slice(0, 10)}
          </span>
        )}
      </h2>
      <p className="mb-6 text-sm text-muted">
        Commits, consents, disclosures and verifications in one chronological
        view. References only — field names, states, versions and record ids;
        never customer values.
      </p>
      {timeline.length === 0 && (
        <p className="text-sm text-muted">No evidence recorded for this customer.</p>
      )}
      {[...byDay.entries()].map(([day, entries]) => (
        <section key={day} className="mb-6">
          <h3 className="mb-2 border-b border-linen pb-1 text-sm font-semibold text-night">
            {day}
          </h3>
          <ul className="space-y-1">
            {entries.map((entry, i) => (
              <li key={`${day}-${i}`} className="flex items-baseline gap-2 text-sm">
                <span className="font-mono text-xs text-muted">{entry.at.slice(11, 19)}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] ${KIND_STYLES[entry.kind]}`}>
                  {entry.kind}
                </span>
                <span className="font-mono text-xs">{entry.label}</span>
                {Object.entries(entry.refs).map(([k, v]) => (
                  <span key={k} className="text-[11px] text-muted">
                    {k}={v}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
