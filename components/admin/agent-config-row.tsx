'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface AgentData {
  id: string
  slug: string
  name: string
  type: string
  provider: string
  model: string
  fallbackProvider: string | null
  fallbackModel: string | null
  temperature: number
  maxTokens: number
  isActive: boolean
}

interface ModelCatalogEntry {
  provider: string
  modelId: string
  displayName: string
}

interface AgentConfigRowProps {
  agent: AgentData
  models: ModelCatalogEntry[]
}

const PROVIDERS = ['OPENAI', 'ANTHROPIC']

export default function AgentConfigRow({ agent, models }: AgentConfigRowProps) {
  const router = useRouter()
  const [provider, setProvider] = useState(agent.provider)
  const [model, setModel] = useState(agent.model)
  const [fallbackProvider, setFallbackProvider] = useState(agent.fallbackProvider ?? '')
  const [fallbackModel, setFallbackModel] = useState(agent.fallbackModel ?? '')
  const [temperature, setTemperature] = useState(agent.temperature)
  const [maxTokens, setMaxTokens] = useState(agent.maxTokens)
  const [isActive, setIsActive] = useState(agent.isActive)
  const [saving, setSaving] = useState(false)
  const [flushing, setFlushing] = useState(false)
  const [saved, setSaved] = useState(false)

  const filteredModels = models.filter((m) => m.provider === provider)
  const filteredFallbackModels = models.filter(
    (m) => m.provider === (fallbackProvider || provider),
  )

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await fetch(`/api/admin/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          fallbackProvider: fallbackProvider || null,
          fallbackModel: fallbackModel || null,
          temperature,
          maxTokens,
          isActive,
        }),
      })
      setSaved(true)
      router.refresh()
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  async function handleFlushCache() {
    setFlushing(true)
    try {
      await fetch('/api/admin/agents/flush-cache', { method: 'POST' })
    } finally {
      setFlushing(false)
    }
  }

  return (
    <div className="rounded-lg border border-warm-border bg-white p-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-medium text-night">{agent.name}</h3>
          <p className="text-xs text-muted">
            {agent.slug} — {agent.type}
          </p>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-xs text-muted">Active</span>
          <button
            onClick={() => setIsActive(!isActive)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              isActive ? 'bg-sage' : 'bg-warm-border'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform shadow-sm ${
                isActive ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </label>
      </div>

      {/* Config fields */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Provider */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Provider</label>
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value)
              // Reset model when provider changes
              const firstModel = models.find((m) => m.provider === e.target.value)
              setModel(firstModel?.modelId ?? '')
            }}
            className="w-full rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* Model */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage"
          >
            {filteredModels.map((m) => (
              <option key={m.modelId} value={m.modelId}>{m.displayName}</option>
            ))}
            {filteredModels.length === 0 && (
              <option value={model}>{model}</option>
            )}
          </select>
        </div>

        {/* Fallback Provider */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Fallback Provider</label>
          <select
            value={fallbackProvider}
            onChange={(e) => {
              setFallbackProvider(e.target.value)
              const firstModel = models.find((m) => m.provider === e.target.value)
              setFallbackModel(firstModel?.modelId ?? '')
            }}
            className="w-full rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage"
          >
            <option value="">None</option>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* Fallback Model */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Fallback Model</label>
          <select
            value={fallbackModel}
            onChange={(e) => setFallbackModel(e.target.value)}
            className="w-full rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage"
          >
            <option value="">None</option>
            {filteredFallbackModels.map((m) => (
              <option key={m.modelId} value={m.modelId}>{m.displayName}</option>
            ))}
          </select>
        </div>

        {/* Temperature */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            Temperature: {temperature.toFixed(1)}
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full accent-sage"
          />
        </div>

        {/* Max Tokens */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Max Tokens</label>
          <input
            type="number"
            value={maxTokens}
            onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 0)}
            className="w-full rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-forest px-4 py-2 text-sm font-medium text-linen hover:bg-sage transition-colors disabled:opacity-50"
        >
          {saving ? 'Se salveaza...' : saved ? 'Salvat!' : 'Save'}
        </button>
        <button
          onClick={handleFlushCache}
          disabled={flushing}
          className="rounded-md border border-warm-border px-4 py-2 text-sm text-muted hover:bg-linen transition-colors disabled:opacity-50"
        >
          {flushing ? 'Flushing...' : 'Flush Cache'}
        </button>
      </div>
    </div>
  )
}
