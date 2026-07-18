'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'

export function ChatHeader() {
  const router = useRouter()

  return (
    <header className="flex-shrink-0 h-12 flex items-center justify-between px-4 bg-soft-white border-b border-warm-border">
      {/* Left: Zeno mark + name */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-forest flex items-center justify-center">
          <span className="text-linen text-xs font-sans font-medium leading-none">Z</span>
        </div>
        <span className="text-[16px] font-medium text-night font-sans">Zeno</span>
      </div>

      {/* Right: new-conversation link (T21 — /chat resumes by default) + Close button */}
      <div className="flex items-center gap-2">
      <Link
        href="/chat?new=1"
        className="text-sm text-muted hover:text-night underline underline-offset-2 transition-colors duration-150"
      >
        Conversație nouă
      </Link>
      <button
        type="button"
        onClick={() => router.push('/')}
        className="
          w-10 h-10 flex items-center justify-center rounded-full
          text-muted hover:text-night transition-colors duration-150
          focus:outline-none focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
        "
        aria-label="Close chat"
      >
        <X className="w-5 h-5" />
      </button>
      </div>
    </header>
  )
}
