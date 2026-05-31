import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Workflow, MessageSquare, Coins, Play, Loader2 } from 'lucide-react'
import { statsApi, workflowsApi } from '../api/client.js'

const DEMO_MESSAGE = 'Why did my payment fail for order ORD-10234?'

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

  const load = async () => {
    const res = await statsApi.get()
    setStats({ ...emptyStats, ...res.data })
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
      setDemoResult(res.data)
      await load()
    } catch (e) {
      setDemoResult({ error: e?.response?.data?.detail || 'Demo run failed (check your API key).' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-slate-400">Overview of your agent orchestration platform</p>
        </div>
        <button onClick={runDemo} disabled={running} className="btn btn-primary">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run demo workflow
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Bot} label="Total agents" value={stats.total_agents} accent="bg-indigo-500/20 text-indigo-300" />
        <StatCard icon={Workflow} label="Total workflows" value={stats.total_workflows} accent="bg-violet-500/20 text-violet-300" />
        <StatCard icon={MessageSquare} label="Messages today" value={stats.messages_today} accent="bg-teal-500/20 text-teal-300" />
        <StatCard icon={Coins} label="Tokens used" value={stats.total_tokens} accent="bg-amber-500/20 text-amber-300" />
      </div>

      {demoResult && (
        <div className="card mt-6">
          <h3 className="mb-2 text-sm font-semibold text-slate-300">Demo result</h3>
          {demoResult.error ? (
            <p className="text-sm text-rose-300">{demoResult.error}</p>
          ) : (
            <>
              <p className="text-sm text-slate-200">{demoResult.final_response}</p>
              <p className="mt-2 text-xs text-slate-500">
                {demoResult.total_tokens} tokens · ${Number(demoResult.total_cost || 0).toFixed(6)} ·{' '}
                <button onClick={() => navigate('/monitor')} className="text-indigo-400 underline">
                  view in monitor
                </button>
              </p>
            </>
          )}
        </div>
      )}

      <div className="card mt-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-300">Recent workflow runs</h3>
        {stats.recent_runs.length === 0 ? (
          <p className="text-sm text-slate-500">No runs yet. Click “Run demo workflow” to start.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">Session</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Started</th>
                  <th className="px-2 py-2 text-right">Tokens</th>
                  <th className="px-2 py-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {stats.recent_runs.map((r) => (
                  <tr key={r.id}>
                    <td className="px-2 py-2 font-mono text-xs text-slate-400">{(r.session_id || '').slice(0, 8)}</td>
                    <td className="px-2 py-2">
                      <span className={`badge ${statusStyles[r.status] || statusStyles.running}`}>{r.status}</span>
                    </td>
                    <td className="px-2 py-2 text-slate-400">
                      {r.started_at ? new Date(r.started_at).toLocaleTimeString() : '—'}
                    </td>
                    <td className="px-2 py-2 text-right text-slate-300">{r.total_tokens}</td>
                    <td className="px-2 py-2 text-right text-emerald-300">
                      ${Number(r.total_cost_usd || 0).toFixed(6)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
