import { useEffect, useState } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { agentsApi, asArray } from '../api/client.js'
import AgentCard from '../components/AgentCard.jsx'
import AgentForm from '../components/AgentForm.jsx'

export default function Agents() {
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await agentsApi.list()
      setAgents(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load().catch(() => setLoading(false))
  }, [])

  const openNew = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (agent) => {
    setEditing(agent)
    setFormOpen(true)
  }

  const save = async (form) => {
    if (editing) {
      await agentsApi.update(editing.id, form)
    } else {
      await agentsApi.create(form)
    }
    setFormOpen(false)
    setEditing(null)
    await load()
  }

  const remove = async (agent) => {
    if (!window.confirm(`Delete agent "${agent.name}"?`)) return
    await agentsApi.delete(agent.id)
    await load()
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Agents</h1>
          <p className="text-sm text-slate-400">Create and manage your AI agents</p>
        </div>
        <button onClick={openNew} className="btn btn-primary">
          <Plus className="h-4 w-4" />
          New Agent
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading agents…
        </div>
      ) : agents.length === 0 ? (
        <div className="card text-center text-slate-400">
          No agents yet. Create your first agent to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onEdit={openEdit} onDelete={remove} />
          ))}
        </div>
      )}

      <AgentForm
        open={formOpen}
        initial={editing}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        onSave={save}
      />
    </div>
  )
}
