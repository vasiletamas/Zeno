'use client'

import { useState } from 'react'
import type { DebugTurn } from '@/lib/debug/reducer'
import { GateSection } from './sections/gate-section'
import { PromptSection } from './sections/prompt-section'
import { ToolsSection } from './sections/tools-section'
import { ToolNarrationSection } from './sections/tool-narration-section'
import { IdentitySection } from './sections/identity-section'

interface TurnCardProps {
  turn: DebugTurn
  previousTurn: DebugTurn | null
  defaultOpen: boolean
}

export function TurnCard({ turn, previousTurn, defaultOpen }: TurnCardProps) {
  const [openIdentity, setOpenIdentity] = useState(defaultOpen)
  const [openGate, setOpenGate] = useState(defaultOpen)
  const [openPrompt, setOpenPrompt] = useState(defaultOpen)
  const [openTools, setOpenTools] = useState(defaultOpen)
  const [openToolNarration, setOpenToolNarration] = useState(defaultOpen)

  const latency = turn.totals?.latencyMs
  const preview =
    turn.userMessage.length > 60
      ? turn.userMessage.slice(0, 57) + '...'
      : turn.userMessage

  return (
    <div className="border border-black/10 rounded-md bg-white">
      <div className="px-3 py-2 border-b border-black/5">
        <p className="text-xs font-mono">
          <span className="text-gray-500">#{turn.messageIndex}</span> {preview}
        </p>
        {latency != null && (
          <p className="text-[10px] text-gray-500 font-mono mt-1">
            {latency}ms · in {turn.totals?.totalInputTokens ?? 0}t · out{' '}
            {turn.totals?.totalOutputTokens ?? 0}t
          </p>
        )}
      </div>
      <Subsection
        title="Identity & Stored Context"
        open={openIdentity}
        onToggle={() => setOpenIdentity(!openIdentity)}
      >
        <IdentitySection
          identity={turn.identity}
          previousIdentity={previousTurn?.identity ?? null}
        />
      </Subsection>
      <Subsection
        title="Gate"
        open={openGate}
        onToggle={() => setOpenGate(!openGate)}
      >
        <GateSection gate={turn.gate} />
      </Subsection>
      <Subsection
        title="Prompt"
        open={openPrompt}
        onToggle={() => setOpenPrompt(!openPrompt)}
      >
        <PromptSection prompt={turn.prompt} />
      </Subsection>
      <Subsection
        title="Tools"
        open={openTools}
        onToggle={() => setOpenTools(!openTools)}
      >
        <ToolsSection toolCalls={turn.toolCalls} />
      </Subsection>
      <Subsection
        title={
          turn.toolNarration && !turn.toolNarration.clean
            ? `Tool Narration ⚠ ${turn.toolNarration.violations.length}`
            : 'Tool Narration'
        }
        open={openToolNarration}
        onToggle={() => setOpenToolNarration(!openToolNarration)}
      >
        <ToolNarrationSection toolNarration={turn.toolNarration} />
      </Subsection>
    </div>
  )
}

function Subsection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-black/5 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-1.5 text-left text-xs font-mono font-semibold hover:bg-gray-50 flex justify-between items-center"
      >
        <span>{title}</span>
        <span className="text-gray-400">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  )
}
