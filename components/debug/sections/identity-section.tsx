import type { DebugTurn } from '@/lib/debug/reducer'
import { diffIdentity, type IdentityDiffResult } from './identity-diff'

interface Props {
  identity: DebugTurn['identity']
  previousIdentity: DebugTurn['identity'] | null
}

export function IdentitySection({ identity, previousIdentity }: Props) {
  if (!identity) {
    return <p className="text-xs text-gray-500">No identity data yet.</p>
  }
  const diff = diffIdentity(identity, previousIdentity ?? null)

  return (
    <div className="space-y-2 text-xs font-mono">
      {diff.changes > 0 && (
        <p className="text-[10px] text-amber-700">
          [{diff.changes} change{diff.changes === 1 ? '' : 's'} this turn]
        </p>
      )}

      <Group title="Identity">
        <Row label="cookieId" path="identity.cookieId" diff={diff}>
          <CookieIdValue value={identity.identity.cookieId} />
        </Row>
        <Row label="anonymous" path="identity.isAnonymous" diff={diff}>
          {identity.identity.isAnonymous ? '🔵 yes' : '⚪ no'}
        </Row>
      </Group>

      <Group title="Profile">
        <Row label="name" path="customer.name" diff={diff}>
          {identity.customer.name ?? '—'}
        </Row>
        <Row label="age" path="customer.age" diff={diff}>
          {identity.customer.age ?? '—'}
        </Row>
        <Row label="language" path="customer.language" diff={diff}>
          {identity.customer.language}
        </Row>
      </Group>

      <Group title="Consent">
        <Row label="GDPR" path="consent.gdprConsentAt" diff={diff}>
          {identity.consent.gdprConsentAt
            ? `✓ ${formatTimestamp(identity.consent.gdprConsentAt)}${
                identity.consent.gdprConsentScope
                  ? ` (${identity.consent.gdprConsentScope})`
                  : ''
              }`
            : '✗ not granted'}
        </Row>
        <Row
          label="AI disclosure"
          path="consent.aiDisclosureAcknowledgedAt"
          diff={diff}
        >
          {identity.consent.aiDisclosureAcknowledgedAt
            ? `✓ ${formatTimestamp(identity.consent.aiDisclosureAcknowledgedAt)}`
            : '✗ not acknowledged'}
        </Row>
      </Group>

      <Group title="Conversation State">
        <Row label="product" path="conversation.productId" diff={diff}>
          {identity.conversation.productId
            ? `✓ ${identity.conversation.productName ?? identity.conversation.productCode ?? identity.conversation.productId}`
            : '✗ not set (no application yet)'}
        </Row>
        <Row label="candidate" path="conversation.candidateProductId" diff={diff}>
          {identity.conversation.candidateProductId
            ? `${identity.conversation.candidateProductId.slice(0, 8)}… (conf ${identity.conversation.candidateConfidence ?? '?'})`
            : '—'}
        </Row>
        {identity.conversation.candidateSetAt && (
          <Row label="candidate set" path="conversation.candidateSetAt" diff={diff}>
            {formatTimestamp(identity.conversation.candidateSetAt)}
          </Row>
        )}
      </Group>

      <Group title={`Memory (${identity.memory.length} insight${identity.memory.length === 1 ? '' : 's'})`}>
        {identity.memory.length === 0 ? (
          <div className="text-gray-400">— no cross-conversation insights yet —</div>
        ) : (
          <ul className="space-y-1">
            {identity.memory.map((m) => {
              const isNew = diff.newMemoryIds.has(m.id)
              return (
                <li
                  key={m.id}
                  className={`pl-2 ${isNew ? 'border-l-2 border-emerald-400' : 'border-l border-gray-200'}`}
                >
                  <div>
                    <span className="text-gray-500">{m.kind}</span> — {m.text}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    {formatTimestamp(m.createdAt)}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Group>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-semibold text-gray-700 mb-0.5">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function Row({
  label,
  path,
  diff,
  children,
}: {
  label: string
  path: string
  diff: IdentityDiffResult
  children: React.ReactNode
}) {
  const change = diff.scalarDiffs.get(path)
  const highlight = change ? 'bg-amber-100' : ''
  return (
    <div className={`grid grid-cols-[8rem_1fr] gap-x-2 px-1 rounded ${highlight}`}>
      <span className="text-gray-500">{label}</span>
      <span>
        {children}
        {change && (
          <span className="text-amber-700 ml-2">
            (was: {formatValue(change.was)})
          </span>
        )}
      </span>
    </div>
  )
}

function CookieIdValue({ value }: { value: string }) {
  const truncated = value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value
  return (
    <button
      type="button"
      title={`Click to copy: ${value}`}
      onClick={() => {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          void navigator.clipboard.writeText(value)
        }
      }}
      className="text-left underline decoration-dotted hover:text-blue-700"
    >
      {truncated}
    </button>
  )
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z')
  } catch {
    return iso
  }
}
