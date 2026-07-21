'use client'

import { useRouter } from 'next/navigation'
import { SessionReauth, freshSessionRequest, type SessionInitResponse } from '@/components/chat/session-reauth'

/**
 * The challenge screen for a conversation whose owner holds an account but
 * whose browser has not proven itself (spec 2026-07-21 §3.1, AC-2/AC-3).
 *
 * This component renders INSTEAD OF the conversation, never over it: the
 * server component returns this without ever loading the messages, so nothing
 * of the conversation reaches the client until a proof exists. A client-side
 * curtain would ship the transcript to the roommate's browser and merely hide
 * it.
 *
 * On success the browser now holds `zeno_proof`, so a plain refresh re-runs
 * the server gate and admits them — no state to thread, no second decision
 * path that could disagree with the first.
 */
export function ConversationReauth({ maskedEmail }: { maskedEmail: string }) {
  const router = useRouter()

  return (
    <div className="h-dvh flex items-center justify-center bg-soft-white">
      <SessionReauth
        maskedEmail={maskedEmail}
        onAuthenticated={() => router.refresh()}
        onContinueFresh={() => {
          // AC-3 step 4: the person who cannot pass the challenge is not
          // stranded — they get their own anonymous session. /chat mints the
          // conversation, so we deliberately do NOT return to this id.
          const r = freshSessionRequest()
          void fetch(r.url, r.init)
            .then((res) => res.json())
            .then((_s: SessionInitResponse) => router.replace('/chat'))
            .catch(() => router.replace('/'))
        }}
      />
    </div>
  )
}
