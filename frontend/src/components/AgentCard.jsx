import { Pencil, Trash2, Wrench } from 'lucide-react'

const roleStyles = {
  orchestrator: 'bg-violet-500/20 text-violet-300 border border-violet-500/40',
  analyst: 'bg-teal-500/20 text-teal-300 border border-teal-500/40',
  responder: 'bg-rose-500/20 text-rose-300 border border-rose-500/40',
  custom: 'bg-slate-500/20 text-slate-300 border border-slate-500/40',
}

export default function AgentCard({ agent, onEdit, onDelete }) {
  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">{agent.name}</h3>
          <span className={`badge mt-1 ${roleStyles[agent.role] || roleStyles.custom}`}>
            {agent.role}
          </span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onEdit(agent)}
            className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            title="Edit agent"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(agent)}
            className="rounded-md p-2 text-slate-400 hover:bg-rose-900/50 hover:text-rose-300"
            title="Delete agent"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <p className="line-clamp-3 text-sm text-slate-400">{agent.system_prompt}</p>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 text-xs text-slate-400">
        <span className="rounded bg-slate-800 px-2 py-1 font-mono">{agent.model}</span>
        <span className="rounded bg-slate-800 px-2 py-1">max {agent.max_tokens} tok</span>
        {agent.memory_enabled && (
          <span className="rounded bg-emerald-900/40 px-2 py-1 text-emerald-300">memory</span>
        )}
      </div>

      {agent.tools?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {agent.tools.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300"
            >
              <Wrench className="h-3 w-3" />
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
