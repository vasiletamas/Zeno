'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { GENERIC_INTERACTION_LABELS, renderKind } from '@/lib/chat/action-labels'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  language?: 'en' | 'ro'
}

// Render markdown inline in the chat bubble with brand-appropriate styling.
// User messages stay plain text — users don't write markdown.
const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 last:mb-0">{children}</p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-sage"
    >
      {children}
    </a>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-warm-border/40 px-1 py-0.5 text-[13px] font-mono">{children}</code>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-2 text-[16px] font-semibold">{children}</h3>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-2 text-[16px] font-semibold">{children}</h3>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-2 text-[15px] font-semibold">{children}</h3>
  ),
}

export function MessageBubble({ role, content, isStreaming, language = 'ro' }: MessageBubbleProps) {
  const isUser = role === 'user'

  // T22: persisted action turns render as a muted chip — what the customer
  // answered or signed — never a raw "[Action: type]" bubble. Classification
  // lives in the exported pure helper renderKind (unit-tested in node env).
  if (isUser) {
    const kind = renderKind(content)
    if (kind.kind !== 'text') {
      const label = kind.kind === 'action' ? kind.label : GENERIC_INTERACTION_LABELS[language]
      return (
        <div className="flex justify-end animate-[message-appear_200ms_ease-out]">
          <span className="inline-block rounded-full border border-warm-border bg-linen px-3 py-1 text-[13px] leading-[1.4] text-night/70">
            {label}
          </span>
        </div>
      )
    }
  }

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-[message-appear_200ms_ease-out]`}
    >
      <div
        className={`
          max-w-[85%] px-4 py-3 text-[15px] leading-[1.5] font-sans
          ${isUser
            ? 'bg-forest text-soft-white rounded-2xl rounded-br-sm'
            : 'bg-linen text-night rounded-2xl rounded-bl-sm'
          }
        `}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap break-words">{content}</span>
        ) : (
          <div className="break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content}
            </ReactMarkdown>
          </div>
        )}
        {isStreaming && (
          <span className="inline-block ml-0.5 animate-[typing-pulse_1s_ease-in-out_infinite]">
            &#9610;
          </span>
        )}
      </div>
    </div>
  )
}
