'use client'

/**
 * Application Detail Client Component
 *
 * Renders application details, customer data, answers, quote, policy.
 * Includes action buttons for email generation and status updates.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AllianzEmailGenerator from '@/components/admin/allianz-email-generator'

interface ApplicationDetailData {
  application: {
    id: string
    status: string
    includesAddon: boolean
    flagsForReview: unknown
    createdAt: string
    customer: {
      name: string | null
      email: string | null
      phone: string | null
      cnpEncrypted: string | null
      cnpIv: string | null
      cnpTag: string | null
      dateOfBirth: string | null
      address: unknown
    }
    product: { name: unknown; code: string } | null
    tier: { name: unknown; code: string } | null
    level: { name: unknown; code: string } | null
    conversation: {
      answers: Array<{
        id: string
        value: string
        answeredAt: string
        question: {
          text: unknown
          group: { name: unknown; code: string }
        }
      }>
    }
    quote: {
      id: string
      premiumAnnual: number
      premiumMonthly: number
      paymentFrequency: string | null
      coverages: unknown
      status: string
    } | null
  }
  policy: {
    id: string
    status: string
    allianzPolicyNumber: string | null
    premiumAnnual: number
    paymentFrequency: string | null
  } | null
}

function getLocalizedName(name: unknown): string {
  if (!name) return '-'
  if (typeof name === 'string') return name
  if (typeof name === 'object' && name !== null) {
    const n = name as Record<string, string>
    return n.ro || n.en || Object.values(n)[0] || '-'
  }
  return '-'
}

export default function ApplicationDetailClient({
  data,
}: {
  data: ApplicationDetailData
}) {
  const { application, policy } = data
  const router = useRouter()
  const [showEmail, setShowEmail] = useState(false)
  const [activatingPolicy, setActivatingPolicy] = useState(false)
  const [allianzNumber, setAllianzNumber] = useState('')
  const [showActivateModal, setShowActivateModal] = useState(false)

  async function handleStatusUpdate(status: string, allianzPolicyNumber?: string) {
    if (!policy) return
    setActivatingPolicy(true)
    try {
      await fetch(`/api/admin/policies/${policy.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, allianzPolicyNumber }),
      })
      router.refresh()
    } finally {
      setActivatingPolicy(false)
      setShowActivateModal(false)
    }
  }

  // Group answers by question group
  const answerGroups = new Map<string, { groupName: string; answers: typeof application.conversation.answers }>()
  for (const answer of application.conversation.answers) {
    const groupCode = answer.question.group.code
    if (!answerGroups.has(groupCode)) {
      answerGroups.set(groupCode, {
        groupName: getLocalizedName(answer.question.group.name),
        answers: [],
      })
    }
    answerGroups.get(groupCode)!.answers.push(answer)
  }

  return (
    <div>
      <h2 className="mb-6 text-xl font-medium text-night">
        Aplicatie — {application.customer.name ?? 'Anonim'}
      </h2>

      {/* Customer data */}
      <section className="mb-6 rounded-lg border border-warm-border bg-white p-5">
        <h3 className="mb-3 text-base font-medium text-forest">Date client</h3>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            ['Nume', application.customer.name],
            ['Email', application.customer.email],
            ['Telefon', application.customer.phone],
            ['CNP', application.customer.cnpEncrypted ? '******* (criptat)' : null],
            ['Data nasterii', application.customer.dateOfBirth ? new Date(application.customer.dateOfBirth).toLocaleDateString('ro-RO') : null],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-xs text-muted">{label as string}</dt>
              <dd className="text-sm text-night">{(value as string) ?? '-'}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Application info */}
      <section className="mb-6 rounded-lg border border-warm-border bg-white p-5">
        <h3 className="mb-3 text-base font-medium text-forest">Detalii aplicatie</h3>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Produs</dt>
            <dd className="text-sm text-night">{getLocalizedName(application.product?.name)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Pachet</dt>
            <dd className="text-sm text-night">
              {getLocalizedName(application.tier?.name)} — {getLocalizedName(application.level?.name)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Addon BD</dt>
            <dd className="text-sm text-night">{application.includesAddon ? 'Da' : 'Nu'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Status</dt>
            <dd className="text-sm">
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                application.status === 'OPEN' ? 'bg-sage/10 text-sage' :
                application.status === 'COMPLETED' ? 'bg-forest/10 text-forest' :
                'bg-sand/10 text-sand'
              }`}>
                {application.status}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Data</dt>
            <dd className="text-sm text-night">
              {new Date(application.createdAt).toLocaleDateString('ro-RO')}
            </dd>
          </div>
        </dl>
      </section>

      {/* Answers */}
      {answerGroups.size > 0 && (
        <section className="mb-6 rounded-lg border border-warm-border bg-white p-5">
          <h3 className="mb-3 text-base font-medium text-forest">Raspunsuri chestionar</h3>
          {Array.from(answerGroups.entries()).map(([code, group]) => (
            <div key={code} className="mb-4 last:mb-0">
              <h4 className="mb-2 text-sm font-medium text-night">{group.groupName}</h4>
              <dl className="space-y-2">
                {group.answers.map((answer) => (
                  <div key={answer.id} className="flex flex-col sm:flex-row sm:gap-4">
                    <dt className="text-xs text-muted min-w-[200px]">
                      {getLocalizedName(answer.question.text)}
                    </dt>
                    <dd className="text-sm text-night">{answer.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>
      )}

      {/* Quote */}
      {application.quote && (
        <section className="mb-6 rounded-lg border border-warm-border bg-white p-5">
          <h3 className="mb-3 text-base font-medium text-forest">Oferta</h3>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">Prima anuala</dt>
              <dd className="text-sm text-night">{application.quote.premiumAnnual} RON</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Prima lunara</dt>
              <dd className="text-sm text-night">{application.quote.premiumMonthly} RON</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Frecventa plata</dt>
              <dd className="text-sm text-night">{application.quote.paymentFrequency ?? 'Annual'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Status oferta</dt>
              <dd className="text-sm text-night">{application.quote.status}</dd>
            </div>
          </dl>
        </section>
      )}

      {/* Policy */}
      {policy && (
        <section className="mb-6 rounded-lg border border-warm-border bg-white p-5">
          <h3 className="mb-3 text-base font-medium text-forest">Polita</h3>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">Status polita</dt>
              <dd className="text-sm">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                  policy.status === 'ACTIVE' ? 'bg-sage/10 text-sage' :
                  policy.status === 'SUBMITTED' ? 'bg-info/10 text-info' :
                  'bg-sand/10 text-sand'
                }`}>
                  {policy.status}
                </span>
              </dd>
            </div>
            {policy.allianzPolicyNumber && (
              <div>
                <dt className="text-xs text-muted">Numar polita Allianz</dt>
                <dd className="text-sm text-night">{policy.allianzPolicyNumber}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* Actions */}
      <section className="flex flex-wrap gap-3">
        <button
          onClick={() => setShowEmail(true)}
          className="rounded-md bg-forest px-4 py-2 text-sm font-medium text-linen hover:bg-sage transition-colors"
        >
          Generate Allianz Email
        </button>

        {policy && policy.status === 'PENDING_SUBMISSION' && (
          <button
            onClick={() => handleStatusUpdate('SUBMITTED')}
            disabled={activatingPolicy}
            className="rounded-md border border-sage px-4 py-2 text-sm font-medium text-sage hover:bg-sage/10 transition-colors disabled:opacity-50"
          >
            Mark as Submitted
          </button>
        )}

        {policy && policy.status === 'SUBMITTED' && (
          <button
            onClick={() => setShowActivateModal(true)}
            disabled={activatingPolicy}
            className="rounded-md border border-forest px-4 py-2 text-sm font-medium text-forest hover:bg-forest/10 transition-colors disabled:opacity-50"
          >
            Activate Policy
          </button>
        )}
      </section>

      {/* Activate modal */}
      {showActivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/40">
          <div className="mx-4 w-full max-w-[400px] rounded-lg border border-warm-border bg-white p-6">
            <h3 className="mb-4 text-lg font-medium text-night">Activeaza polita</h3>
            <label className="mb-1 block text-sm font-medium text-night">
              Numar polita Allianz
            </label>
            <input
              type="text"
              value={allianzNumber}
              onChange={(e) => setAllianzNumber(e.target.value)}
              className="mb-4 w-full rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage focus:ring-1 focus:ring-sage"
              placeholder="e.g. ALZ-2026-123456"
            />
            <div className="flex gap-3">
              <button
                onClick={() => handleStatusUpdate('ACTIVE', allianzNumber)}
                disabled={activatingPolicy || !allianzNumber}
                className="rounded-md bg-forest px-4 py-2 text-sm font-medium text-linen hover:bg-sage transition-colors disabled:opacity-50"
              >
                {activatingPolicy ? 'Se activeaza...' : 'Activeaza'}
              </button>
              <button
                onClick={() => setShowActivateModal(false)}
                className="rounded-md border border-warm-border px-4 py-2 text-sm text-muted hover:bg-linen transition-colors"
              >
                Anuleaza
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email generator modal */}
      {showEmail && (
        <AllianzEmailGenerator
          customer={{
            name: application.customer.name,
            email: application.customer.email,
            phone: application.customer.phone,
            cnpEncrypted: application.customer.cnpEncrypted,
            dateOfBirth: application.customer.dateOfBirth,
            address: application.customer.address,
          }}
          productName={getLocalizedName(application.product?.name)}
          tierName={getLocalizedName(application.tier?.name)}
          levelName={getLocalizedName(application.level?.name)}
          includesAddon={application.includesAddon}
          premiumAnnual={application.quote?.premiumAnnual ?? null}
          paymentFrequency={application.quote?.paymentFrequency ?? null}
          onClose={() => setShowEmail(false)}
        />
      )}
    </div>
  )
}
