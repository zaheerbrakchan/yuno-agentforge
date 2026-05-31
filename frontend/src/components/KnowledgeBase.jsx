import { useCallback, useEffect, useState } from 'react'
import { Database, Plus, Copy, Check, Trash2, X, Lightbulb } from 'lucide-react'
import { paymentsApi } from '../api/client.js'

const reasonLabels = {
  insufficient_funds: 'insufficient funds',
  card_expired: 'card expired',
  gateway_timeout: 'gateway timeout',
  fraud_detected: 'fraud flagged',
}

const FAILURE_REASONS = [
  { value: 'insufficient_funds', label: 'Insufficient funds' },
  { value: 'card_expired', label: 'Card expired' },
  { value: 'gateway_timeout', label: 'Gateway timeout' },
  { value: 'fraud_detected', label: 'Fraud flagged' },
  { value: 'custom', label: 'Other (custom)' },
]

const emptyForm = {
  order_id: '',
  status: 'failed',
  reason: 'insufficient_funds',
  custom_reason: '',
  recommendation: '',
  amount: '99.00',
  currency: 'USD',
  gateway: 'Yuno',
  customer: '',
}

const BUILTIN_DEFAULTS = {
  insufficient_funds: 'Please ensure your account has sufficient balance and retry.',
  card_expired: 'Your card has expired. Please update your payment method and retry.',
  gateway_timeout: 'This was a temporary network issue. Please retry your payment.',
  fraud_detected: 'This transaction was flagged for security review. Please contact your bank.',
}

export default function KnowledgeBase({ onPick }) {
  const [data, setData] = useState({
    records: [],
    scenarios: [],
    example_questions: [],
    playbook: [],
    default_playbook: BUILTIN_DEFAULTS,
  })
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await paymentsApi.list()
      setData(res.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load().catch(() => setLoading(false))
  }, [load])

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // ignore
    }
  }

  const remove = async (orderId) => {
    if (!window.confirm(`Delete record ${orderId}?`)) return
    await paymentsApi.delete(orderId)
    await load()
  }

  const resolveReason = () => {
    if (form.status !== 'failed') return null
    if (form.reason === 'custom') return form.custom_reason.trim() || null
    return form.reason
  }

  const recommendationForReason = (reasonKey, playbookRows = [], defaultPlaybook = {}) => {
    if (!reasonKey || reasonKey === 'custom') return ''
    const saved = (playbookRows || []).find((p) => p.reason === reasonKey)
    if (saved) return saved.recommendation
    return defaultPlaybook[reasonKey] || BUILTIN_DEFAULTS[reasonKey] || ''
  }

  const setReason = (reason) => {
    const next = { ...form, reason }
    if (reason !== 'custom') {
      next.recommendation = recommendationForReason(
        reason,
        data.playbook,
        data.default_playbook,
      )
    } else {
      next.recommendation = ''
    }
    setForm(next)
  }

  const submit = async () => {
    setSaving(true)
    setFormError('')
    try {
      const reason = resolveReason()
      if (form.status === 'failed' && !reason) {
        setFormError('Failure reason is required for failed payments.')
        return
      }
      if (form.status === 'failed' && form.reason === 'custom' && !form.recommendation.trim()) {
        setFormError('Add a retry recommendation for custom failure reasons.')
        return
      }
      await paymentsApi.create({
        order_id: form.order_id.trim(),
        status: form.status,
        reason,
        recommendation: form.status === 'failed' ? form.recommendation.trim() || null : null,
        amount: parseFloat(form.amount) || 0,
        currency: form.currency,
        gateway: form.gateway,
        customer: form.customer || null,
      })
      setModalOpen(false)
      setForm(emptyForm)
      await load()
    } catch (e) {
      setFormError(e?.response?.data?.detail || 'Could not save record')
    } finally {
      setSaving(false)
    }
  }

  const records = data.records || []

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Database className="h-4 w-4 text-indigo-400" />
          Knowledge base
        </div>
        <button
          onClick={() => {
            setForm({
              ...emptyForm,
              recommendation: recommendationForReason(
                emptyForm.reason,
                data.playbook,
                data.default_playbook,
              ),
            })
            setModalOpen(true)
          }}
          className="btn btn-secondary px-2 py-1 text-xs"
        >
          <Plus className="h-3.5 w-3.5" /> Add record
        </button>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-slate-400">
        Payment records your agents look up via{' '}
        <span className="text-slate-300">lookup_payment</span>. For failed orders, add a{' '}
        <span className="text-slate-300">retry recommendation</span> playbook entry so{' '}
        <span className="text-slate-300">get_retry_recommendation</span> knows what to tell
        customers — especially for custom failure reasons.
      </p>

      <div className="mb-3 rounded-md border border-slate-800 bg-slate-950/40 p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-300">
          <Lightbulb className="h-3.5 w-3.5" /> Try asking
        </div>
        <ul className="space-y-1 text-xs text-slate-400">
          {(data.example_questions || []).slice(0, 4).map((q) => (
            <li key={q} className="flex items-start gap-2">
              <span className="text-slate-600">•</span>
              <button
                type="button"
                onClick={() => onPick?.(q)}
                className="text-left hover:text-indigo-300"
              >
                “{q}”
              </button>
            </li>
          ))}
        </ul>
      </div>

      {loading ? (
        <p className="text-xs text-slate-500">Loading records…</p>
      ) : records.length === 0 ? (
        <p className="text-xs text-slate-500">No records yet. Add one to start testing.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Payment records ({records.length})
          </div>
          {records.map((o) => {
            const ok = o.status === 'success'
            return (
              <div
                key={o.order_id}
                className="flex items-center justify-between rounded-md bg-slate-950/40 px-2.5 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-200">
                      {o.order_id}
                    </span>
                    <span
                      className={`badge ${
                        ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                      }`}
                    >
                      {ok ? 'paid' : reasonLabels[o.reason] || o.reason || 'failed'}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {o.amount} {o.currency} · {o.gateway}
                      {o.customer ? ` · ${o.customer}` : ''}
                    </span>
                  </div>
                </div>
                <div className="ml-2 flex shrink-0 items-center gap-1">
                  {onPick && (
                    <button
                      onClick={() => onPick(`Why did my payment fail for order ${o.order_id}?`)}
                      className="rounded px-1.5 py-0.5 text-xs text-indigo-300 hover:bg-slate-800"
                    >
                      Use
                    </button>
                  )}
                  <button
                    onClick={() => copy(o.order_id)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                    title="Copy order ID"
                  >
                    {copied === o.order_id ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => remove(o.order_id)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-300"
                    title="Delete record"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="card w-full max-w-md">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">Add test record</h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-4 text-xs text-slate-400">
              Agents will find this instantly via lookup_payment. Great for testing fraud, custom
              failures, or your own order IDs.
            </p>
            <div className="space-y-3">
              <div>
                <label className="label">Order ID</label>
                <input
                  className="input"
                  placeholder="ORD-2001"
                  value={form.order_id}
                  onChange={(e) => setForm({ ...form, order_id: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Status</label>
                  <select
                    className="input"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    <option value="failed">Failed</option>
                    <option value="success">Success (paid)</option>
                  </select>
                </div>
                <div>
                  <label className="label">Amount</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </div>
              </div>
              {form.status === 'failed' && (
                <div>
                  <label className="label">Failure reason</label>
                  <select
                    className="input"
                    value={form.reason}
                    onChange={(e) => setReason(e.target.value)}
                  >
                    {FAILURE_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  {form.reason === 'custom' && (
                    <input
                      className="input mt-2"
                      placeholder="e.g. billing_address_mismatch"
                      value={form.custom_reason}
                      onChange={(e) => setForm({ ...form, custom_reason: e.target.value })}
                    />
                  )}
                </div>
              )}
              {form.status === 'failed' && (
                <div>
                  <label className="label">
                    Retry recommendation
                    {form.reason === 'custom' ? ' (required)' : ' (optional override)'}
                  </label>
                  <textarea
                    className="input min-h-[72px] resize-y"
                    placeholder="What should the agent tell the customer to do next?"
                    value={form.recommendation}
                    onChange={(e) => setForm({ ...form, recommendation: e.target.value })}
                  />
                  <p className="mt-1 text-[10px] text-slate-500">
                    Saved to the playbook for this failure reason. Custom reasons need their own
                    guidance; built-in reasons use defaults unless you override them here.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Currency</label>
                  <input
                    className="input"
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Gateway</label>
                  <input
                    className="input"
                    value={form.gateway}
                    onChange={(e) => setForm({ ...form, gateway: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="label">Customer / notes (optional)</label>
                <input
                  className="input"
                  placeholder="Jane Doe — test fraud case"
                  value={form.customer}
                  onChange={(e) => setForm({ ...form, customer: e.target.value })}
                />
              </div>
            </div>
            {formError && (
              <p className="mt-3 text-xs text-rose-300">{formError}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setModalOpen(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={saving || !form.order_id.trim()}
                className="btn btn-primary flex-1"
              >
                {saving ? 'Saving…' : 'Save record'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
