import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Workflow as WorkflowIcon, Pencil, Trash2, Play, Loader2, Plus } from 'lucide-react'
import { workflowsApi } from '../api/client.js'

const roleColors = {
  orchestrator: '#8b5cf6',
  analyst: '#14b8a6',
  responder: '#f87171',
  custom: '#64748b',
}

const DEFAULT_WF_NAME = 'Payment failure investigator'

export default function Workflows() {
  const navigate = useNavigate()
  const [workflows, setWorkflows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await workflowsApi.list()
      setWorkflows(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
  }, [])

  const remove = async (wf) => {
    if (!window.confirm(`Delete workflow "${wf.name}"?`)) return
    await workflowsApi.delete(wf.id)
    await load()
  }

  const nodeRoles = (wf) => {
    const nodes = wf.graph_json?.nodes || []
    return nodes.map((n) => n.role || 'custom')
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Workflows</h1>
          <p className="text-sm text-slate-400">Your saved multi-agent workflows</p>
        </div>
        <button onClick={() => navigate('/builder')} className="btn btn-primary">
          <Plus className="h-4 w-4" />
          New Workflow
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading workflows…
        </div>
      ) : workflows.length === 0 ? (
        <div className="card text-center text-slate-400">
          No workflows yet. Build one in the Workflow Builder.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workflows.map((wf) => {
            const roles = nodeRoles(wf)
            const edgeCount = wf.graph_json?.edges?.length || 0
            const isDefault = wf.name === DEFAULT_WF_NAME
            return (
              <div
                key={wf.id}
                className={`card flex flex-col gap-3 ${isDefault ? 'ring-1 ring-emerald-500/50' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <WorkflowIcon className="h-5 w-5 text-indigo-400" />
                    <h3 className="text-base font-semibold text-white">{wf.name}</h3>
                  </div>
                  <span className={`badge ${isDefault ? 'bg-emerald-500/20 text-emerald-300' : 'bg-indigo-500/20 text-indigo-300'}`}>
                    {isDefault ? 'Default' : 'Custom'}
                  </span>
                </div>

                <p className="line-clamp-2 min-h-[2.5rem] text-sm text-slate-400">
                  {wf.description || 'No description'}
                </p>

                {isDefault && (
                  <p className="-mt-1 text-xs text-emerald-400/80">
                    Runs automatically in Monitor &amp; the dashboard demo.
                  </p>
                )}

                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>{roles.length} agents</span>
                  <span>{edgeCount} connections</span>
                </div>

                {roles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {roles.map((r, i) => (
                      <span
                        key={i}
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: roleColors[r] || roleColors.custom }}
                        title={r}
                      />
                    ))}
                  </div>
                )}

                <div className="mt-auto flex gap-2 pt-2">
                  <button
                    onClick={() => navigate(`/builder?id=${wf.id}`)}
                    className="btn btn-secondary flex-1 px-2 py-1.5 text-xs"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => navigate(`/monitor?workflow=${wf.id}`)}
                    className="btn btn-secondary flex-1 px-2 py-1.5 text-xs"
                  >
                    <Play className="h-3.5 w-3.5" /> Run
                  </button>
                  <button
                    onClick={() => remove(wf)}
                    className="btn btn-danger px-2 py-1.5 text-xs"
                    title="Delete workflow"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
