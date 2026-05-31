import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bot,
  Workflow,
  MessageSquare,
  Coins,
  Play,
  Loader2,
  ExternalLink,
  Monitor as MonitorIcon,
  Send,
  Trash2,
} from 'lucide-react'
import { statsApi, workflowsApi } from '../api/client.js'

const DEMO_MESSAGE = 'Why did my payment fail for order ORD-1002?'

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="card flex items-center gap-4">
      <div className={`rounded-lg p-3 ${accent}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <div className="text-2xl font-bold text-white">{value}</div>
        <div className="text-sm text-slate-400">{label}</div>
      </div>
    </div>
  )
}

const statusStyles = {
  completed: 'bg-emerald-500/20 text-emerald-300',
  running: 'bg-blue-500/20 text-blue-300',
  failed: 'bg-rose-500/20 text-rose-300',
}

const channelStyles = {
  Monitor: 'bg-indigo-500/15 text-indigo-300',
  Telegram: 'bg-sky-500/15 text-sky-300',
}

function formatWhen(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now - d
  if (diffMs < 60_000) return 'Just now'
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`
  if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`
  return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

const emptyStats = {
  total_agents: 0,
  total_workflows: 0,
  messages_today: 0,
  total_tokens: 0,
  recent_runs: [],
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(emptyStats)
  const [running, setRunning] = useState(false)
  const [demoResult, setDemoResult] = useState(null)
  const [deletingRunId, setDeletingRunId] = useState(null)

  const load = async () => {
    const [statsRes, wfRes] = await Promise.all([statsApi.get(), workflowsApi.list()])
    const wfMap = Object.fromEntries((wfRes.data || []).map((w) => [w.id, w.name]))

    const runs = await Promise.all(
      (statsRes.data.recent_runs || []).map(async (r) => {
        let run = {
          ...r,
          workflow_name: r.workflow_name || wfMap[r.workflow_id] || 'Workflow',
          channel: r.channel || 'Monitor',
        }
        if (run.user_query || !run.workflow_id || !run.session_id) return run
        try {
          const msgs = await workflowsApi.getMessages(run.workflow_id, run.session_id)
          const human = msgs.data.find((m) => m.message_type === 'human_input')
          const reversed = [...msgs.data].reverse()
          const writer = reversed.find(
            (m) => m.message_type === 'agent_response' && m.from_agent === 'Response Writer',
          )
          const lastAgent = reversed.find((m) => m.message_type === 'agent_response')
          return {
            ...run,
            user_query: human?.content,
            agent_reply: run.agent_reply || writer?.content || lastAgent?.content,
            channel: human?.from_agent === 'telegram' ? 'Telegram' : run.channel,
          }
        } catch {
          return run
        }
      }),
    )

    setStats({ ...emptyStats, ...statsRes.data, recent_runs: runs })
  }

  useEffect(() => {
    load().catch(() => {})
  }, [])

  const runDemo = async () => {
    setRunning(true)
    setDemoResult(null)
    try {
      const list = await workflowsApi.list()
      const workflow =
        list.data.find((w) => w.name === 'Payment failure investigator') || list.data[0]
      if (!workflow) {
        setDemoResult({ error: 'No workflow available to run.' })
        return
      }
      const res = await workflowsApi.run(workflow.id, { input_message: DEMO_MESSAGE })
      setDemoResult({ ...res.data, workflow_id: workflow.id })
      await load()
    } catch (e) {
      setDemoResult({ error: e?.response?.data?.detail || 'Demo run failed (check your API key).' })
    } finally {
      setRunning(false)
    }
  }

  const openRun = (run) => {
    const params = new URLSearchParams({ workflow: run.workflow_id })
    if (run.session_id) params.set('session', run.session_id)
    navigate(`/monitor?${params.toString()}`)
  }

  const deleteRun = async (run) => {
    if (!run?.id) return
    setStats((prev) => ({
      ...prev,
      recent_runs: prev.recent_runs.filter((x) => x.id !== run.id),
    }))
    setDeletingRunId(run.id)
    try {
      await workflowsApi.deleteRun(run.id)
    } catch {
      await load()
    } finally {
      setDeletingRunId(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-slate-400">Overview of your agent orchestration platform</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Bot} label="Total agents" value={stats.total_agents} accent="bg-indigo-500/20 text-indigo-300" />
        <StatCard icon={Workflow} label="Total workflows" value={stats.total_workflows} accent="bg-violet-500/20 text-violet-300" />
        <StatCard icon={MessageSquare} label="Messages today" value={stats.messages_today} accent="bg-teal-500/20 text-teal-300" />
        <StatCard icon={Coins} label="Tokens used" value={stats.total_tokens} accent="bg-amber-500/20 text-amber-300" />
      </div>

      <div className="card mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-200">Quick demo</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Runs{' '}
              <span className="text-slate-300">Payment failure investigator</span> — sends “
              {DEMO_MESSAGE}” and the 3-agent flow looks up{' '}
              <span className="font-mono text-slate-300">ORD-1002</span>, then replies with why
              payment failed and what to do next.
            </p>
          </div>
          <button onClick={runDemo} disabled={running} className="btn btn-primary shrink-0">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run demo
          </button>
        </div>

        {demoResult && (
          <div className="mt-3 border-t border-slate-800 pt-3">
            {demoResult.error ? (
              <p className="text-xs text-rose-300">{demoResult.error}</p>
            ) : (
              <>
                <p className="line-clamp-3 text-sm text-slate-200">{demoResult.final_response}</p>
                <p className="mt-1.5 text-xs text-slate-500">
                  {demoResult.total_tokens} tokens · ${Number(demoResult.total_cost || 0).toFixed(6)} ·{' '}
                  <button
                    onClick={() =>
                      navigate(
                        `/monitor?workflow=${demoResult.workflow_id || ''}&session=${demoResult.session_id || ''}`,
                      )
                    }
                    className="text-indigo-400 underline"
                  >
                    open in Monitor
                  </button>
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="card mt-6">
        <h3 className="mb-1 text-sm font-semibold text-slate-300">Recent workflow runs</h3>
        <p className="mb-4 text-xs text-slate-500">
          What users asked, what the agents answered, and where it ran — click a row to open in Monitor.
        </p>
        {stats.recent_runs.length === 0 ? (
          <p className="text-sm text-slate-500">No runs yet. Use the payment failure demo above to start.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {stats.recent_runs.map((r) => (
              <div
                key={r.id}
                className="group flex items-stretch rounded-lg border border-slate-800 bg-slate-950/30 transition-colors hover:border-slate-700 hover:bg-slate-900/50"
              >
                <button
                  type="button"
                  onClick={() => openRun(r)}
                  className="min-w-0 flex-1 p-4 text-left"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`badge ${channelStyles[r.channel] || 'bg-slate-700 text-slate-300'}`}
                    >
                      {r.channel === 'Telegram' ? (
                        <Send className="mr-1 inline h-3 w-3" />
                      ) : (
                        <MonitorIcon className="mr-1 inline h-3 w-3" />
                      )}
                      {r.channel}
                    </span>
                    <span className="text-xs font-medium text-slate-300">{r.workflow_name}</span>
                    <span className={`badge ${statusStyles[r.status] || statusStyles.running}`}>
                      {r.status}
                    </span>
                    <span className="ml-auto text-[10px] text-slate-500">{formatWhen(r.started_at)}</span>
                  </div>

                  <div className="mb-1.5 text-sm text-slate-200">
                    <span className="text-slate-500">User: </span>
                    “{r.user_query || 'No message recorded'}”
                  </div>

                  {r.agent_reply && (
                    <div className="mb-2 line-clamp-2 text-xs leading-relaxed text-slate-400">
                      <span className="text-slate-500">Agent: </span>
                      {r.agent_reply}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                    <span>{r.total_tokens} tokens</span>
                    <span className="text-emerald-400/90">
                      ${Number(r.total_cost_usd || 0).toFixed(6)}
                    </span>
                    {r.duration_sec != null && <span>{r.duration_sec}s run</span>}
                    <span className="ml-auto flex items-center gap-1 text-indigo-400 opacity-0 transition-opacity group-hover:opacity-100">
                      Open in Monitor
                      <ExternalLink className="h-3 w-3" />
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => deleteRun(r)}
                  disabled={deletingRunId === r.id}
                  className="flex shrink-0 items-center border-l border-slate-800 px-3 text-slate-500 opacity-60 transition-opacity hover:text-rose-400 group-hover:opacity-100 disabled:opacity-40"
                  title="Remove from history"
                >
                  {deletingRunId === r.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
