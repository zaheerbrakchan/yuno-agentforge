import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Position,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Save, Trash2, LayoutTemplate, Bot, Check, X, HelpCircle } from 'lucide-react'
import { agentsApi, workflowsApi } from '../api/client.js'

const roleColors = {
  orchestrator: { bg: '#2e1065', border: '#8b5cf6' },
  analyst: { bg: '#042f2e', border: '#14b8a6' },
  responder: { bg: '#4c0519', border: '#f87171' },
  custom: { bg: '#1e293b', border: '#64748b' },
}

function nodeStyle(role) {
  const c = roleColors[role] || roleColors.custom
  return {
    background: c.bg,
    color: '#e2e8f0',
    border: `2px solid ${c.border}`,
    borderRadius: 12,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 600,
    width: 170,
  }
}

let idCounter = 1
const nextId = () => `node_${idCounter++}_${Date.now()}`

const TEMPLATE_ROLE_KEYS = {
  orchestrator: (agents) =>
    agents.find((a) => a.name === 'Orchestrator') || agents.find((a) => a.role === 'orchestrator'),
  analyst: (agents) =>
    agents.find((a) => a.name === 'Payment Analyst') || agents.find((a) => a.role === 'analyst'),
  responder: (agents) =>
    agents.find((a) => a.name === 'Response Writer') || agents.find((a) => a.role === 'responder'),
  router: (agents) => agents.find((a) => a.name === 'Support Router'),
  specialist: (agents) => agents.find((a) => a.name === 'General Support Agent'),
}

function resolveTemplateAgent(agentKey, agents) {
  if (agents.some((a) => a.id === agentKey)) {
    return agents.find((a) => a.id === agentKey)
  }
  const resolver = TEMPLATE_ROLE_KEYS[agentKey]
  return resolver ? resolver(agents) : null
}

function buildGraphFromTemplate(tpl, agents) {
  const tplNodes = tpl.graph_json.nodes.map((n) => {
    const agent = resolveTemplateAgent(n.agent_id, agents)
    const role = agent?.role || n.agent_id
    const label = agent?.name || n.agent_id
    return {
      id: n.id,
      position: n.position || { x: 0, y: 0 },
      data: {
        label,
        role,
        agent_id: agent?.id || n.agent_id,
        name: label,
      },
      style: nodeStyle(role),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }
  })
  const tplEdges = tpl.graph_json.edges.map((e, i) => ({
    id: `e_${i}`,
    source: e.source,
    target: e.target,
    animated: true,
  }))
  return { nodes: tplNodes, edges: tplEdges }
}

function Builder() {
  const wrapperRef = useRef(null)
  const { screenToFlowPosition } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [agents, setAgents] = useState([])
  const [savedWorkflows, setSavedWorkflows] = useState([])
  const [templates, setTemplates] = useState([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('')
  const [savedId, setSavedId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState(null)
  const [templateMode, setTemplateMode] = useState('create')
  const [newWorkflowName, setNewWorkflowName] = useState('')
  const [editWorkflowId, setEditWorkflowId] = useState('')
  const [templateError, setTemplateError] = useState('')

  const [searchParams] = useSearchParams()

  useEffect(() => {
    const editId = searchParams.get('id')
    const init = async () => {
      const [agentsRes, templatesRes, workflowsRes] = await Promise.all([
        agentsApi.list().catch(() => ({ data: [] })),
        workflowsApi.getTemplates().catch(() => ({ data: [] })),
        workflowsApi.list().catch(() => ({ data: [] })),
      ])
      setAgents(agentsRes.data)
      setTemplates(templatesRes.data)
      setSavedWorkflows(workflowsRes.data || [])

      if (editId) {
        const list = await workflowsApi.list().catch(() => ({ data: [] }))
        const wf = list.data.find((w) => w.id === editId)
        if (wf) {
          const agentName = (id) => agentsRes.data.find((a) => a.id === id)?.name || id
          const wfNodes = (wf.graph_json?.nodes || []).map((n) => ({
            id: n.id,
            position: n.position || { x: 0, y: 0 },
            data: { label: agentName(n.agent_id), agent_id: n.agent_id, role: n.role, name: agentName(n.agent_id) },
            style: nodeStyle(n.role),
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
          }))
          const wfEdges = (wf.graph_json?.edges || []).map((e, i) => ({
            id: `e_${i}`,
            source: e.source,
            target: e.target,
            animated: true,
          }))
          setNodes(wfNodes)
          setEdges(wfEdges)
          setName(wf.name)
          setDescription(wf.description || '')
          setSavedId(wf.id)
          setStatus(`Editing "${wf.name}"`)
        }
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  )

  const onDragStart = (event, agent) => {
    event.dataTransfer.setData('application/agentforge', JSON.stringify(agent))
    event.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = useCallback((event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event) => {
      event.preventDefault()
      const raw = event.dataTransfer.getData('application/agentforge')
      if (!raw) return
      const agent = JSON.parse(raw)
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const newNode = {
        id: nextId(),
        position,
        data: { label: agent.name, agent_id: agent.id, role: agent.role, name: agent.name },
        style: nodeStyle(agent.role),
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      }
      setNodes((nds) => nds.concat(newNode))
    },
    [screenToFlowPosition, setNodes]
  )

  useEffect(() => {
    if (!templateModalOpen) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [templateModalOpen])

  const openTemplateModal = (templateId) => {
    const tpl = templates.find((t) => t.id === templateId)
    if (!tpl) return
    const match = savedWorkflows.find((w) => w.name === tpl.name)
    setPendingTemplate(tpl)
    setTemplateMode(match ? 'edit' : 'create')
    setNewWorkflowName(`${tpl.name} (copy)`)
    setEditWorkflowId(match?.id || savedWorkflows[0]?.id || '')
    setTemplateError('')
    setTemplateModalOpen(true)
  }

  const applyTemplate = (tpl, { mode, workflowId, workflowName, workflowDescription }) => {
    const { nodes: tplNodes, edges: tplEdges } = buildGraphFromTemplate(tpl, agents)
    setNodes(tplNodes)
    setEdges(tplEdges)
    setName(workflowName)
    setDescription(workflowDescription)
    if (mode === 'edit') {
      setSavedId(workflowId)
      setStatus(`Editing "${workflowName}" — template applied (Save to update)`)
    } else {
      setSavedId(null)
      setStatus(`New workflow "${workflowName}" — add agents, then Save`)
    }
  }

  const confirmTemplateLoad = () => {
    if (!pendingTemplate) return
    setTemplateError('')

    const unresolved = (pendingTemplate.graph_json?.nodes || []).filter((n) => {
      const agent = resolveTemplateAgent(n.agent_id, agents)
      return !agent?.id
    })
    if (unresolved.length) {
      setTemplateError(
        'Missing agents for this template. Restart the backend, then refresh — Support Router and General Support Agent are created on startup.',
      )
      return
    }

    if (templateMode === 'create') {
      const workflowName = newWorkflowName.trim()
      if (!workflowName) {
        setTemplateError('Enter a name for the new workflow.')
        return
      }
      applyTemplate(pendingTemplate, {
        mode: 'create',
        workflowName,
        workflowDescription: pendingTemplate.description,
      })
    } else {
      const wf = savedWorkflows.find((w) => w.id === editWorkflowId)
      if (!wf) {
        setTemplateError('Select a workflow to update.')
        return
      }
      applyTemplate(pendingTemplate, {
        mode: 'edit',
        workflowId: wf.id,
        workflowName: wf.name,
        workflowDescription: wf.description || pendingTemplate.description,
      })
    }

    setTemplateModalOpen(false)
    setPendingTemplate(null)
  }

  const clearCanvas = () => {
    setNodes([])
    setEdges([])
    setSavedId(null)
    setStatus('Canvas cleared')
  }

  const save = async () => {
    if (!name.trim()) {
      setStatus('Please enter a workflow name')
      return
    }
    if (saving) return
    setSaving(true)
    const graph_json = {
      nodes: nodes.map((n) => ({
        id: n.id,
        agent_id: n.data.agent_id,
        role: n.data.role,
        position: n.position,
      })),
      edges: edges.map((e) => ({ source: e.source, target: e.target })),
    }
    try {
      // Update the same workflow on subsequent saves instead of duplicating it.
      if (savedId) {
        await workflowsApi.update(savedId, { name, description, graph_json })
      } else {
        const res = await workflowsApi.create({ name, description, graph_json })
        setSavedId(res.data.id)
      }
      setStatus(`Saved workflow "${name}"`)
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2500)
    } catch (e) {
      setStatus('Failed to save workflow')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-64 flex-col border-r border-slate-800 bg-slate-900/60 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Agents</h2>
        <p className="mb-3 text-xs text-slate-500">Drag an agent onto the canvas</p>
        <div className="flex-1 space-y-2 overflow-y-auto">
          {agents.length === 0 && (
            <p className="text-xs text-slate-500">No agents. Create some on the Agents page.</p>
          )}
          {agents.map((agent) => (
            <div
              key={agent.id}
              draggable
              onDragStart={(e) => onDragStart(e, agent)}
              className="cursor-grab rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:border-indigo-500 active:cursor-grabbing"
              style={{ borderLeft: `4px solid ${(roleColors[agent.role] || roleColors.custom).border}` }}
            >
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-slate-400" />
                <span className="truncate font-semibold">{agent.name}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span
                  className="badge"
                  style={{
                    background: `${(roleColors[agent.role] || roleColors.custom).border}22`,
                    color: (roleColors[agent.role] || roleColors.custom).border,
                  }}
                >
                  {agent.role}
                </span>
                <span className="text-[10px] text-slate-500">Drag to canvas</span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/40 px-4 py-2">
          <div className="relative">
            <select
              onChange={(e) => {
                if (e.target.value) openTemplateModal(e.target.value)
                e.target.value = ''
              }}
              defaultValue=""
              className="input cursor-pointer py-1.5 pr-8 text-sm"
            >
              <option value="" disabled>
                Load template…
              </option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <button onClick={clearCanvas} className="btn btn-secondary px-3 py-1.5 text-sm">
            <Trash2 className="h-4 w-4" /> Clear canvas
          </button>
          {status && (
            <span className="ml-auto flex items-center gap-1 text-xs text-slate-400">
              <LayoutTemplate className="h-3 w-3" />
              {status}
            </span>
          )}
        </div>

        <div ref={wrapperRef} className="flex-1" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#334155" gap={18} />
            <Controls />
            <MiniMap
              maskColor="rgba(2,6,23,0.6)"
              nodeColor={(n) => (roleColors[n.data?.role] || roleColors.custom).border}
            />
          </ReactFlow>
        </div>

        <div className="border-t border-slate-800 bg-slate-900/60 px-4 py-3">
          <div className="flex items-end gap-3">
            <div className="w-64">
              <label className="label">Workflow name</label>
              <input
                className="input"
                placeholder="e.g. Fraud investigation flow"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className="label">Description</label>
              <input
                className="input"
                placeholder="e.g. Routes payment queries through a fraud check, then writes the reply"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <button
              onClick={save}
              disabled={saving}
              className={`btn whitespace-nowrap ${justSaved ? 'btn-secondary' : 'btn-primary'}`}
            >
              {justSaved ? (
                <>
                  <Check className="h-4 w-4 text-emerald-400" /> Saved!
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" /> {saving ? 'Saving…' : savedId ? 'Update workflow' : 'Save workflow'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {templateModalOpen && pendingTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="card w-full max-w-md p-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-5 w-5 text-indigo-400" />
                <h3 className="text-base font-semibold text-white">Use template</h3>
              </div>
              <button
                type="button"
                onClick={() => setTemplateModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-5 py-4">
              <p className="mb-4 text-xs text-slate-400">
                Template: <span className="text-slate-200">{pendingTemplate.name}</span> —{' '}
                {pendingTemplate.description}
              </p>

              <div className="space-y-2">
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 hover:border-slate-700">
                  <input
                    type="radio"
                    name="templateMode"
                    checked={templateMode === 'create'}
                    onChange={() => setTemplateMode('create')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium text-white">Create new workflow</div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Start from this template with a new name. Drag more agents onto the canvas,
                      then Save.
                    </p>
                  </div>
                </label>

                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:border-slate-700 ${
                    savedWorkflows.length === 0
                      ? 'cursor-not-allowed border-slate-800/50 opacity-50'
                      : 'border-slate-800 bg-slate-950/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="templateMode"
                    checked={templateMode === 'edit'}
                    onChange={() => setTemplateMode('edit')}
                    disabled={savedWorkflows.length === 0}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium text-white">Update existing workflow</div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Apply template to a saved workflow and overwrite its graph when you Save.
                    </p>
                  </div>
                </label>
              </div>

              {templateMode === 'create' ? (
                <div className="mt-4">
                  <label className="label">New workflow name</label>
                  <input
                    className="input"
                    value={newWorkflowName}
                    onChange={(e) => setNewWorkflowName(e.target.value)}
                    placeholder="e.g. My payment support flow"
                  />
                </div>
              ) : (
                <div className="mt-4">
                  <label className="label">Workflow to update</label>
                  <select
                    className="input"
                    value={editWorkflowId}
                    onChange={(e) => setEditWorkflowId(e.target.value)}
                  >
                    {savedWorkflows.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {templateError && (
                <p className="mt-3 text-xs text-rose-300">{templateError}</p>
              )}
            </div>

            <div className="flex gap-2 border-t border-slate-800 px-5 py-4">
              <button
                type="button"
                onClick={() => setTemplateModalOpen(false)}
                className="btn btn-secondary flex-1"
              >
                Cancel
              </button>
              <button type="button" onClick={confirmTemplateLoad} className="btn btn-primary flex-1">
                Load template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function WorkflowBuilder() {
  return (
    <ReactFlowProvider>
      <Builder />
    </ReactFlowProvider>
  )
}
