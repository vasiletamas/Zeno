'use client'

import { useRef, useState } from 'react'
import { Check, AlertCircle, Loader2, FileUp } from 'lucide-react'
import type { Language } from '@/lib/i18n/translations'
import type { UIAction } from '@/lib/chat/action-adapter'

/**
 * Consumer for show_document_upload (T29, Stripe-card pattern T14.D5): the
 * file goes from the customer's browser straight to the upload route — the
 * agent and the transcript never see it. Only the validation outcome comes
 * back into the flow, as a document_uploaded action the adapter turns into a
 * get_current_state refresh.
 */

// mirrors the route's server-side guard (app/api/documents/upload/route.ts)
const MAX_BYTES = 10 * 1024 * 1024

export interface UploadResponse {
  documentId: string
  status: string // validated | review
}

export function buildUploadResultAction(kind: string, resp: UploadResponse): UIAction {
  return { type: 'document_uploaded', payload: { kind, documentId: resp.documentId, status: resp.status } }
}

const COPY = {
  title: {
    id_card: { ro: 'Încarcă actul de identitate', en: 'Upload your ID document' },
    fallback: { ro: 'Încarcă documentul', en: 'Upload the document' },
  },
  privacy: {
    ro: 'Fișierul ajunge direct în sistemul securizat — nu apare în conversație.',
    en: 'The file goes straight to the secure system — it never appears in the chat.',
  },
  choose: { ro: 'Alege fișierul', en: 'Choose file' },
  uploading: { ro: 'Se încarcă…', en: 'Uploading…' },
  validated: { ro: 'Document verificat.', en: 'Document validated.' },
  review: { ro: 'Documentul este în verificare — un coleg îl va valida.', en: 'The document is under review — a colleague will validate it.' },
  tooLarge: { ro: 'Fișierul depășește 10MB.', en: 'The file exceeds 10MB.' },
  failed: { ro: 'Încărcarea a eșuat.', en: 'The upload failed.' },
  retry: { ro: 'Reîncearcă', en: 'Retry' },
}

interface DocumentUploadCardProps {
  kind: string
  uploadUrl: string
  onAction: (action: UIAction) => void
  language: Language
  isAnswered?: boolean
  isLoading?: boolean
}

export function DocumentUploadCard({
  kind,
  uploadUrl,
  onAction,
  language,
  isAnswered = false,
  isLoading = false,
}: DocumentUploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [status, setStatus] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<'tooLarge' | 'failed' | null>(null)
  // kept so Retry re-posts without forcing a re-pick
  const [lastFile, setLastFile] = useState<File | null>(null)

  const pick = (key: { ro: string; en: string }) => (language === 'ro' ? key.ro : key.en)
  const title = pick(kind === 'id_card' ? COPY.title.id_card : COPY.title.fallback)

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      setErrorKind('tooLarge')
      setPhase('error')
      return
    }
    setLastFile(file)
    setPhase('uploading')
    setErrorKind(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', kind)
      // auth = zeno_session cookie, sent automatically on the same origin
      const res = await fetch(uploadUrl, { method: 'POST', body: form })
      if (res.status !== 201) {
        setErrorKind('failed')
        setPhase('error')
        return
      }
      const body = (await res.json()) as UploadResponse
      setStatus(body.status)
      setPhase('done')
      onAction(buildUploadResultAction(kind, body))
    } catch {
      setErrorKind('failed')
      setPhase('error')
    }
  }

  if (phase === 'done') {
    return (
      <div className="bg-soft-white border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]">
        <div className="flex items-center gap-2">
          <Check className="w-4 h-4 text-sage flex-shrink-0" />
          <span className="text-[15px] text-night">
            {status === 'validated' ? pick(COPY.validated) : pick(COPY.review)}
          </span>
        </div>
      </div>
    )
  }

  const busy = phase === 'uploading' || isLoading

  return (
    <div className="bg-soft-white border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <FileUp className="w-5 h-5 text-sage" />
        </div>
        <div className="flex-1">
          <p className="text-[15px] font-medium text-night leading-[1.5]">{title}</p>
          <p className="text-[13px] text-muted leading-[1.5] mt-1">{pick(COPY.privacy)}</p>

          <input
            ref={inputRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            disabled={busy || isAnswered}
            onChange={(e) => {
              const file = e.target.files?.[0]
              // allow re-picking the same file after an error
              e.target.value = ''
              if (file) void upload(file)
            }}
            aria-label={title}
          />

          {phase === 'error' && errorKind ? (
            <div className="flex items-center gap-1.5 mt-2">
              <AlertCircle className="w-4 h-4 text-error flex-shrink-0" />
              <span className="text-[13px] text-error">{pick(COPY[errorKind])}</span>
            </div>
          ) : null}

          <button
            type="button"
            disabled={busy || isAnswered}
            onClick={() => {
              // a size rejection means the same bytes can never pass — force a re-pick
              if (phase === 'error' && errorKind === 'failed' && lastFile) void upload(lastFile)
              else inputRef.current?.click()
            }}
            className="mt-3 px-4 py-2 rounded-lg bg-sage text-white text-[14px] font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {phase === 'uploading' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {pick(COPY.uploading)}
              </>
            ) : phase === 'error' ? (
              pick(COPY.retry)
            ) : (
              pick(COPY.choose)
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
