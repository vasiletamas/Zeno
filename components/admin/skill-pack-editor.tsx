'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export interface SkillPackDetail {
  id: string
  slug: string
  name: string
  category: string
  description: string
  promptSections: Record<string, string>
  allowedTools: string[]
  constraints: string | null
  priority: number
  isActive: boolean
}

interface SkillPackEditorProps {
  skillPack: SkillPackDetail
  allToolNames: string[]
}

export default function SkillPackEditor({ skillPack, allToolNames }: SkillPackEditorProps) {
  const router = useRouter()

  const [name, setName] = useState(skillPack.name)
  const [priority, setPriority] = useState(skillPack.priority)
  const [description, setDescription] = useState(skillPack.description)
  const [promptSections, setPromptSections] = useState<Array<{ key: string; content: string }>>(
    Object.entries(skillPack.promptSections).map(([key, content]) => ({ key, content })),
  )
  const [constraints, setConstraints] = useState(skillPack.constraints ?? '')
  const [allowedTools, setAllowedTools] = useState<Set<string>>(new Set(skillPack.allowedTools))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addSection() {
    setPromptSections((prev) => [...prev, { key: '', content: '' }])
  }

  function removeSection(index: number) {
    setPromptSections((prev) => prev.filter((_, i) => i !== index))
  }

  function updateSectionKey(index: number, key: string) {
    setPromptSections((prev) => prev.map((s, i) => (i === index ? { ...s, key } : s)))
  }

  function updateSectionContent(index: number, content: string) {
    setPromptSections((prev) => prev.map((s, i) => (i === index ? { ...s, content } : s)))
  }

  function toggleTool(toolName: string) {
    setAllowedTools((prev) => {
      const next = new Set(prev)
      if (next.has(toolName)) next.delete(toolName)
      else next.add(toolName)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const sectionsObj = Object.fromEntries(
        promptSections.filter((s) => s.key.trim()).map((s) => [s.key.trim(), s.content]),
      )

      const res = await fetch(`/api/admin/skill-packs/${skillPack.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          priority,
          description,
          promptSections: sectionsObj,
          allowedTools: Array.from(allowedTools),
          constraints: constraints || null,
        }),
      })

      if (!res.ok) {
        const body = await res.json()
        setError(body.error ?? 'Save failed')
        return
      }

      setSaved(true)
      router.refresh()
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl">
      {/* Back link */}
      <Link
        href="/admin/skill-packs"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-night transition-colors"
      >
        &larr; Back to list
      </Link>

      {/* Header */}
      <div className="mb-6 rounded-lg border border-warm-border bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-medium text-night">{skillPack.name}</h3>
            <code className="mt-1 block rounded bg-cloud-100 px-1.5 py-0.5 font-mono text-xs text-night w-fit">
              {skillPack.slug}
            </code>
          </div>
          <span className="inline-block rounded-full bg-cloud-100 px-2 py-0.5 text-xs font-medium text-night">
            {skillPack.category.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Main edit form */}
      <div className="flex flex-col gap-6">
        {/* Basic fields */}
        <div className="rounded-lg border border-warm-border bg-white p-5">
          <h4 className="mb-4 text-sm font-medium text-night">Basic Info</h4>
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Priority</label>
              <input
                type="number"
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
                className="w-40 rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage"
              />
            </div>
          </div>
        </div>

        {/* Prompt Sections */}
        <div className="rounded-lg border border-warm-border bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-sm font-medium text-night">Prompt Sections</h4>
            <button
              onClick={addSection}
              className="rounded-md bg-forest px-3 py-1.5 text-xs font-medium text-linen hover:bg-sage transition-colors"
            >
              + Add Section
            </button>
          </div>

          <div className="flex flex-col gap-4">
            {promptSections.map((section, index) => (
              <div key={index} className="rounded-md border border-warm-border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Section key"
                    value={section.key}
                    onChange={(e) => updateSectionKey(index, e.target.value)}
                    className="flex-1 rounded-md border border-warm-border bg-soft-white px-2 py-1.5 font-mono text-xs text-night outline-none focus:border-sage"
                  />
                  <button
                    onClick={() => removeSection(index)}
                    className="rounded-md border border-warm-border px-2 py-1.5 text-xs text-muted hover:bg-linen hover:text-night transition-colors"
                  >
                    Remove
                  </button>
                </div>
                <textarea
                  rows={4}
                  placeholder="Section content..."
                  value={section.content}
                  onChange={(e) => updateSectionContent(index, e.target.value)}
                  className="w-full rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage resize-y"
                />
              </div>
            ))}

            {promptSections.length === 0 && (
              <p className="text-center text-xs text-muted py-4">No sections yet. Add one above.</p>
            )}
          </div>
        </div>

        {/* Constraints */}
        <div className="rounded-lg border border-warm-border bg-white p-5">
          <h4 className="mb-4 text-sm font-medium text-night">Constraints</h4>
          <textarea
            rows={5}
            placeholder="Enter constraints (optional)..."
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
            className="w-full rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage resize-y"
          />
        </div>

        {/* Allowed Tools */}
        <div className="rounded-lg border border-warm-border bg-white p-5">
          <h4 className="mb-4 text-sm font-medium text-night">
            Allowed Tools{' '}
            <span className="font-normal text-muted">({allowedTools.size} selected)</span>
          </h4>
          {allToolNames.length === 0 ? (
            <p className="text-xs text-muted">No tools registered.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {allToolNames.map((toolName) => (
                <label
                  key={toolName}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-warm-border px-3 py-2 hover:bg-cloud-50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={allowedTools.has(toolName)}
                    onChange={() => toggleTool(toolName)}
                    className="accent-sage h-3.5 w-3.5"
                  />
                  <span className="font-mono text-xs text-night">{toolName}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-forest px-5 py-2 text-sm font-medium text-linen hover:bg-sage transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
          </button>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}
