import { useEffect, useState } from 'react'
import { Loader2, CheckCircle2, Trash2, Plus, MessageCircle, Info, Save } from 'lucide-react'
import { channelsApi, workflowsApi } from '../api/client.js'
import KnowledgeBase from '../components/KnowledgeBase.jsx'

function HowItWorks() {
  return (
    <div className="rounded-lg border border-sky-800/40 bg-sky-900/15 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-sky-200">
        <Info className="h-4 w-4" />
        How it works
      </div>
      <ul className="list-disc space-y-1.5 pl-5 text-xs text-slate-300">
        <li>
          Each connected bot runs <span className="font-semibold text-white">independently</span> and
          at the same time — yours, a teammate's, anyone's.
        </li>
        <li>
          When someone messages <span className="font-semibold text-white">their</span> bot, only
          that bot replies, using the workflow selected on its card below.
        </li>
        <li>
          Connecting a new bot never affects bots that are already running. Deleting a bot only stops
          that one.
        </li>
        <li>To try it: connect your bot, then open it in Telegram and send it a message.</li>
      </ul>
    </div>
  )
}

function Guidelines() {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
        <Info className="h-4 w-4 text-sky-400" />
        Connect your own Telegram bot
      </div>
      <ol className="list-decimal space-y-1.5 pl-5 text-xs text-slate-400">
        <li>
          Open Telegram and message <span className="text-slate-200">@BotFather</span>.
        </li>
        <li>
          Send <span className="text-slate-200">/newbot</span> and follow the prompts (give it a
          name and a username ending in <span className="text-slate-200">bot</span>).
        </li>
        <li>
          BotFather replies with a <span className="text-slate-200">token</span> like{' '}
          <span className="text-slate-200">123456:ABC-DEF...</span>. Copy it.
        </li>
        <li>Paste the token on the right, choose which workflow should answer, and click Connect.</li>
        <li>
          Open your bot in Telegram, send it a message, and your agent workflow will reply live.
        </li>
      </ol>
      <p className="mt-2 text-xs text-slate-500">
        In Telegram, send <span className="text-slate-300">/orders</span> to list knowledge base
        records. Add your own test data in the Knowledge base panel. Tokens are stored only to run
        your bot and are never shown back in full.
      </p>
    </div>
  )
}

function BotCard({ bot, workflows, onChangeWorkflow, onDelete }) {
  const initial = bot.uses_default_workflow ? '' : bot.workflow_id || ''
  const [selected, setSelected] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setSelected(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.workflow_id, bot.uses_default_workflow])

  const dirty = selected !== initial

  const save = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await onChangeWorkflow(bot.id, selected)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              bot.status === 'connected' ? 'bg-emerald-400' : 'bg-slate-500'
            }`}
            title={bot.status}
          />
          <div>
            <div className="text-sm font-semibold text-white">
              {bot.bot_username ? `@${bot.bot_username}` : bot.label || 'Telegram bot'}
            </div>
            <div className="text-xs text-slate-500">
              {bot.status === 'connected' ? 'Listening for messages' : 'Stopped'} · token{' '}
              {bot.token_preview}
              {bot.source === 'env' && ' · demo bot'}
            </div>
          </div>
        </div>
        <button
          onClick={() => onDelete(bot.id)}
          className="btn btn-danger px-2 py-1.5 text-xs"
          title="Disconnect & delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3">
        <label className="label">Answers with workflow</label>
        <div className="flex gap-2">
          <select
            className="input flex-1"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={saving}
          >
            <option value="">
              Default ({bot.workflow_name || 'Payment failure investigator'})
            </option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className={`btn ${saved ? 'btn-secondary' : 'btn-primary'}`}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {dirty ? (
            <span className="text-amber-400">Unsaved change — click Save to apply.</span>
          ) : (
            <>
              Message <span className="text-slate-300">@{bot.bot_username}</span> on Telegram to chat
              with this workflow.
            </>
          )}
        </p>
      </div>
    </div>
  )
}

export default function Channels() {
  const [telegram, setTelegram] = useState({ mode: 'polling', bots: [] })
  const [workflows, setWorkflows] = useState([])
  const [loading, setLoading] = useState(true)

  const [token, setToken] = useState('')
  const [newWf, setNewWf] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState(null)

  const load = async () => {
    const [ch, wf] = await Promise.all([channelsApi.list(), workflowsApi.list()])
    setTelegram(ch.data.telegram || { mode: 'polling', bots: [] })
    setWorkflows(wf.data || [])
  }

  useEffect(() => {
    load()
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const connect = async () => {
    setConnecting(true)
    setConnectError(null)
    try {
      await channelsApi.connectTelegram({ token: token.trim(), workflow_id: newWf || null })
      setToken('')
      setNewWf('')
      await load()
    } catch (e) {
      setConnectError(e?.response?.data?.detail || 'Could not connect bot')
    } finally {
      setConnecting(false)
    }
  }

  const changeWorkflow = async (id, wfId) => {
    await channelsApi.updateTelegram(id, { workflow_id: wfId || null })
    await load()
  }

  const remove = async (id) => {
    if (!window.confirm('Disconnect and delete this bot?')) return
    await channelsApi.deleteTelegram(id)
    await load()
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Channels</h1>
        <p className="text-sm text-slate-400">
          Connect external messaging channels and route their messages into your agent workflows.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading channels…
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* Channel header bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-sky-500/15 p-2.5">
                <MessageCircle className="h-6 w-6 text-sky-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Telegram</h3>
                <p className="text-xs text-slate-400">
                  {telegram.bots.length} connected · mode: {telegram.mode}
                </p>
              </div>
            </div>
            <span className="badge bg-sky-500/15 text-sky-300">External channel</span>
          </div>

          <div className="grid grid-cols-1 gap-0 lg:grid-cols-5">
            {/* Left — setup guide & test data */}
            <div className="flex flex-col gap-4 border-b border-slate-800 p-5 lg:col-span-2 lg:border-b-0 lg:border-r">
              <HowItWorks />
              <Guidelines />
              <KnowledgeBase />
            </div>

            {/* Right — connect & manage bots */}
            <div className="flex flex-col gap-5 p-5 lg:col-span-3">
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <div className="mb-3 text-sm font-semibold text-white">Connect a bot</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="label">Bot token (from @BotFather)</label>
                    <input
                      className="input"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="123456789:ABCdef..."
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="label">Answers with workflow</label>
                    <select className="input" value={newWf} onChange={(e) => setNewWf(e.target.value)}>
                      <option value="">Default (Payment failure investigator)</option>
                      {workflows.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={connect}
                      disabled={connecting || !token.trim()}
                      className="btn btn-primary w-full"
                    >
                      {connecting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      Connect bot
                    </button>
                  </div>
                </div>
                {connectError && (
                  <div className="mt-3 rounded-lg border border-rose-700/40 bg-rose-900/20 p-2 text-xs text-rose-200">
                    {connectError}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Connected bots
                </div>
                {telegram.bots.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/20 px-4 py-8 text-center text-sm text-slate-500">
                    No bots connected yet. Paste a token above to get started.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {telegram.bots.map((bot) => (
                      <BotCard
                        key={bot.id}
                        bot={bot}
                        workflows={workflows}
                        onChangeWorkflow={changeWorkflow}
                        onDelete={remove}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
