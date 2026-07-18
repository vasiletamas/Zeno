'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SessionReauth, isReauthRequired, freshSessionRequest, type SessionInitResponse } from '@/components/chat/session-reauth'

/**
 * /chat — New conversation entry point.
 *
 * Client component that:
 * 1. Resolves or creates an anonymous session via POST /api/session
 * 2. Creates a new conversation via POST /api/chat/create
 * 3. Redirects to /chat/[conversationId]
 *
 * This is a client component because Next.js App Router server components
 * cannot set cookies and redirect in the same render pass.
 */
export default function ChatEntry() {
  const router = useRouter()
  // T26: an account-holder cookie is challenged before the session resumes —
  // the entry renders the OTP prompt instead of silently continuing.
  const [reauthEmail, setReauthEmail] = useState<string | null>(null)

  const openConversation = useCallback(
    async (customerId: string) => {
      const convRes = await fetch('/api/chat/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId }),
      })
      if (!convRes.ok) {
        throw new Error(`Create conversation failed: ${convRes.status}`)
      }
      const { conversationId } = await convRes.json()
      router.replace(`/chat/${conversationId}`)
    },
    [router],
  )

  useEffect(() => {
    let cancelled = false

    async function initChat() {
      try {
        // 1. Get or create session (sets zeno_session cookie)
        const sessionRes = await fetch('/api/session', { method: 'POST' })
        if (!sessionRes.ok) {
          throw new Error(`Session API failed: ${sessionRes.status}`)
        }
        const session: SessionInitResponse = await sessionRes.json()

        if (cancelled) return

        if (isReauthRequired(session)) {
          setReauthEmail(session.maskedEmail)
          return
        }
        if (!session.customerId) throw new Error('Session API returned no customerId')

        // 2-3. Create a new conversation and redirect
        await openConversation(session.customerId)
      } catch (error) {
        console.error('[ChatEntry] Failed to initialize chat:', error)
        // On error, redirect to home rather than showing a broken state
        if (!cancelled) {
          router.replace('/')
        }
      }
    }

    initChat()

    return () => {
      cancelled = true
    }
  }, [router, openConversation])

  if (reauthEmail) {
    return (
      <div className="h-dvh flex items-center justify-center bg-soft-white">
        <SessionReauth
          maskedEmail={reauthEmail}
          onAuthenticated={(customerId) => { void openConversation(customerId).catch(() => router.replace('/')) }}
          onContinueFresh={() => {
            const r = freshSessionRequest()
            void fetch(r.url, r.init)
              .then((res) => res.json())
              .then((s: SessionInitResponse) => {
                if (!s.customerId) throw new Error('fresh session returned no customerId')
                return openConversation(s.customerId)
              })
              .catch(() => router.replace('/'))
          }}
        />
      </div>
    )
  }

  return (
    <div className="h-dvh flex items-center justify-center bg-soft-white">
      <div className="flex flex-col items-center gap-3">
        <div className="flex gap-1.5">
          <span className="w-2 h-2 rounded-full bg-forest animate-[typing-pulse_1.4s_ease-in-out_infinite]" />
          <span className="w-2 h-2 rounded-full bg-forest animate-[typing-pulse_1.4s_ease-in-out_0.15s_infinite]" />
          <span className="w-2 h-2 rounded-full bg-forest animate-[typing-pulse_1.4s_ease-in-out_0.3s_infinite]" />
        </div>
        <p className="text-muted text-sm font-sans">Se incarca...</p>
      </div>
    </div>
  )
}
