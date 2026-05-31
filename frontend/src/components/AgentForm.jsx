import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { agentsApi } from '../api/client.js'

const ROLES = ['orchestrator', 'analyst', 'responder', 'custom']
const MODELS = [
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 — Recommended' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — Fast & cheap' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 — Most capable' },
]

const empty = {
  name: '',
  role: 'custom',
  system_prompt: '',
  model: 'claude-sonnet-4-20250514',
  tools: [],
  memory_enabled: true,
  max_tokens: 1000,
}

export default function AgentForm({ open, initial, onClose, onSave }) {
  const [form, setForm] = useState(empty)
  const [availableTools, setAvailableTools] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(initial ? { ...empty, ...initial } : empty)
      agentsApi
        .getTools()
        .then((res) => setAvailableTools(res.data))
        .catch(() => setAvailableTools([]))
    }
  }, [open, initial])

  if (!open) return null

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const toggleTool = (tool) =>
    setForm((f) => ({
      ...f,
      tools: f.tools.includes(tool)
        ? f.tools.filter((t) => t !== tool)
        : [...f.tools, tool],
    }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave(form)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {initial ? 'Edit Agent' : 'New Agent'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Role</label>
              <select
                className="input"
                value={form.role}
                onChange={(e) => update('role', e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">System Prompt</label>
            <textarea
              className="input min-h-[120px] resize-y"
              value={form.system_prompt}
              onChange={(e) => update('system_prompt', e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label">Model</label>
            <select
              className="input"
              value={form.model}
              onChange={(e) => update('model', e.target.value)}
            >
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Tools</label>
            <div className="flex flex-wrap gap-2">
              {availableTools.length === 0 && (
                <span className="text-sm text-slate-500">No tools available</span>
              )}
              {availableTools.map((tool) => (
                <label
                  key={tool}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    form.tools.includes(tool)
                      ? 'border-amber-500 bg-amber-500/20 text-amber-200'
                      : 'border-slate-700 bg-slate-800 text-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={form.tools.includes(tool)}
                    onChange={() => toggleTool(tool)}
                  />
                  {tool}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Max Tokens: {form.max_tokens}</label>
              <input
                type="range"
                min="100"
                max="4000"
                step="100"
                value={form.max_tokens}
                onChange={(e) => update('max_tokens', Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
            </div>
            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={form.memory_enabled}
                  onChange={(e) => update('memory_enabled', e.target.checked)}
                  className="h-4 w-4 accent-indigo-500"
                />
                Memory enabled
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? 'Saving…' : 'Save Agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
