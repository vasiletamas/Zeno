'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

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

  useEffect(() => {
    let cancelled = false

    async function initChat() {
      try {
        // 1. Get or create session (sets zeno_session cookie)
        const sessionRes = await fetch('/api/session', { method: 'POST' })
        if (!sessionRes.ok) {
          throw new Error(`Session API failed: ${sessionRes.status}`)
        }
        const { customerId } = await sessionRes.json()

        if (cancelled) return

        // 2. Create a new conversation
        const convRes = await fetch('/api/chat/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId }),
        })
        if (!convRes.ok) {
          throw new Error(`Create conversation failed: ${convRes.status}`)
        }
        const { conversationId } = await convRes.json()

        if (cancelled) return

        // 3. Redirect to conversation (replace to avoid back-button loop)
        router.replace(`/chat/${conversationId}`)
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
  }, [router])

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
