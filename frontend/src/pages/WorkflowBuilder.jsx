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
import { Save, Trash2, LayoutTemplate, Bot, Check } from 'lucide-react'
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

function Builder() {
  const wrapperRef = useRef(null)
  const { screenToFlowPosition } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [agents, setAgents] = useState([])
  const [templates, setTemplates] = useState([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('')
  const [savedId, setSavedId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  const [searchParams] = useSearchParams()

  useEffect(() => {
    const editId = searchParams.get('id')
    const init = async () => {
      const [agentsRes, templatesRes] = await Promise.all([
        agentsApi.list().catch(() => ({ data: [] })),
        workflowsApi.getTemplates().catch(() => ({ data: [] })),
      ])
      setAgents(agentsRes.data)
      setTemplates(templatesRes.data)

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

  const loadTemplate = (templateId) => {
    const tpl = templates.find((t) => t.id === templateId)
    if (!tpl) return
    const tplNodes = tpl.graph_json.nodes.map((n) => {
      const role = n.agent_id
      return {
        id: n.id,
        position: n.position || { x: 0, y: 0 },
        data: { label: n.agent_id, role, agent_id: n.agent_id },
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
    setNodes(tplNodes)
    setEdges(tplEdges)
    setName(tpl.name)
    setDescription(tpl.description)
    setSavedId(null)
    setStatus(`Loaded template: ${tpl.name}`)
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
          <button onClick={save} className="btn btn-primary px-3 py-1.5 text-sm">
            <Save className="h-4 w-4" /> Save workflow
          </button>
          <div className="relative">
            <select
              onChange={(e) => {
                if (e.target.value) loadTemplate(e.target.value)
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
