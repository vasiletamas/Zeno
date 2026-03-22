'use client'

import { useState } from 'react'
import { Copy, Check, X } from 'lucide-react'

interface CustomerData {
  name: string | null
  email: string | null
  phone: string | null
  cnp: string | null
  dateOfBirth: string | null
  address: unknown
}

interface AllianzEmailGeneratorProps {
  customer: CustomerData
  productName: string
  tierName: string
  levelName: string
  includesAddon: boolean
  premiumAnnual: number | null
  paymentFrequency: string | null
  onClose: () => void
}

function formatAddress(address: unknown): string {
  if (!address) return '-'
  if (typeof address === 'string') return address
  if (typeof address === 'object' && address !== null) {
    const a = address as Record<string, string>
    const parts = [a.street, a.city, a.county, a.postalCode].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : JSON.stringify(address)
  }
  return '-'
}

export default function AllianzEmailGenerator({
  customer,
  productName,
  tierName,
  levelName,
  includesAddon,
  premiumAnnual,
  paymentFrequency,
  onClose,
}: AllianzEmailGeneratorProps) {
  const [copied, setCopied] = useState(false)

  const dob = customer.dateOfBirth
    ? new Date(customer.dateOfBirth).toLocaleDateString('ro-RO')
    : '-'

  const emailText = `Subject: Cerere de emitere polita Protect - ${customer.name ?? '-'}
To: [Allianz contact email]

Stimate partener,

Va rugam sa emiteti polita de asigurare cu urmatoarele date:

Asigurat: ${customer.name ?? '-'}
CNP: ${customer.cnp ?? '-'}
Data nasterii: ${dob}
Adresa: ${formatAddress(customer.address)}
Email: ${customer.email ?? '-'}
Telefon: ${customer.phone ?? '-'}

Produs: Protect ${tierName} ${levelName}
Addon BD: ${includesAddon ? 'Da' : 'Nu'}
Prima anuala: ${premiumAnnual != null ? `${premiumAnnual} RON` : '-'}
Frecventa plata: ${paymentFrequency ?? 'Annual'}

Plata primei prime a fost efectuata.

Cu stima,
Echipa Zeno`

  async function handleCopy() {
    await navigator.clipboard.writeText(emailText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/40">
      <div className="relative mx-4 w-full max-w-[600px] rounded-lg border border-warm-border bg-white p-6">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-muted hover:text-night"
          aria-label="Inchide"
        >
          <X size={20} />
        </button>

        <h3 className="mb-4 text-lg font-medium text-night">
          Email Allianz — Cerere emitere polita
        </h3>

        <pre className="mb-4 max-h-[400px] overflow-y-auto rounded-md bg-linen p-4 text-sm text-night whitespace-pre-wrap font-sans">
          {emailText}
        </pre>

        <button
          onClick={handleCopy}
          className="flex items-center gap-2 rounded-md bg-forest px-4 py-2 text-sm font-medium text-linen transition-colors hover:bg-sage"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copiat!' : 'Copiaza in clipboard'}
        </button>
      </div>
    </div>
  )
}
