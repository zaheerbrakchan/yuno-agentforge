import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Send, Loader2, RefreshCw, Plus, ChevronDown, ChevronUp, Database } from 'lucide-react'
import { workflowsApi } from '../api/client.js'
import LogStream from '../components/LogStream.jsx'
import MessageHistory from '../components/MessageHistory.jsx'
import KnowledgeBase from '../components/KnowledgeBase.jsx'

const DEFAULT_WF_NAME = 'Payment failure investigator'

export default function Monitor() {
  const [workflowId, setWorkflowId] = useState(null)
  const [workflows, setWorkflows] = useState([])
  const [input, setInput] = useState('Why did my payment fail for order ORD-1002?')
  const [running, setRunning] = useState(false)
  const [sessions, setSessions] = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [messages, setMessages] = useState([])
  const [error, setError] = useState('')
  const [kbOpen, setKbOpen] = useState(false)
  const inputRef = useRef(null)
  const [searchParams] = useSearchParams()

  const pickDefault = (list) => list.find((w) => w.name === DEFAULT_WF_NAME) || list[0]

  const loadSessions = async (wfId) => {
    if (!wfId) return
    const res = await workflowsApi.getMessages(wfId)
    const map = {}
    for (const m of res.data) {
      if (!map[m.session_id]) {
        map[m.session_id] = { session_id: m.session_id, last: m.created_at, count: 0, preview: '' }
      }
      map[m.session_id].count += 1
      if (m.created_at > map[m.session_id].last) map[m.session_id].last = m.created_at
      if (m.message_type === 'human_input' && !map[m.session_id].preview) {
        map[m.session_id].preview = m.content.slice(0, 42)
      }
    }
    setSessions(Object.values(map).sort((a, b) => (b.last || '').localeCompare(a.last || '')))
  }

  const loadSessionMessages = async (wfId, sessionId) => {
    if (!wfId || !sessionId) return
    const res = await workflowsApi.getMessages(wfId, sessionId)
    setMessages(res.data)
  }

  useEffect(() => {
    const wfParam = searchParams.get('workflow')
    const init = async () => {
      const list = await workflowsApi.list()
      setWorkflows(list.data)
      let id = wfParam && list.data.some((w) => w.id === wfParam) ? wfParam : pickDefault(list.data)?.id
      if (id) {
        setWorkflowId(id)
        await loadSessions(id)
      }
    }
    init().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startNewChat = () => {
    setActiveSession(null)
    setMessages([])
    setError('')
    inputRef.current?.focus()
  }

  const selectSession = async (sid) => {
    setActiveSession(sid)
    setError('')
    await loadSessionMessages(workflowId, sid)
  }

  const send = async () => {
    const text = input.trim()
    if (!text || !workflowId) return
    setRunning(true)
    setError('')

    const optimistic = {
      id: `opt-${Date.now()}`,
      message_type: 'human_input',
      from_agent: 'human',
      content: text,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])
    setInput('')

    try {
      const res = await workflowsApi.run(workflowId, {
        input_message: text,
        session_id: activeSession || undefined,
      })
      const sid = res.data.session_id
      setActiveSession(sid)
      await loadSessions(workflowId)
      await loadSessionMessages(workflowId, sid)
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setInput(text)
      setError(e?.response?.data?.detail || 'Run failed. Check your API key on the backend.')
    } finally {
      setRunning(false)
      inputRef.current?.focus()
    }
  }

  const usePrompt = (text) => {
    setInput(text)
    setKbOpen(false)
    inputRef.current?.focus()
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex h-full">
      {/* Sessions sidebar */}
      <div className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-950/40">
        <div className="flex items-center justify-between border-b border-slate-800 px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Chats</span>
          <div className="flex gap-1">
            <button
              onClick={startNewChat}
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              title="New chat"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => loadSessions(workflowId)}
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {!activeSession && messages.length === 0 && (
            <div className="border-b border-slate-800/60 px-3 py-2 text-xs text-indigo-300">New chat</div>
          )}
          {sessions.map((s) => (
            <button
              key={s.session_id}
              onClick={() => selectSession(s.session_id)}
              className={`flex w-full flex-col gap-0.5 border-b border-slate-800/40 px-3 py-2.5 text-left hover:bg-slate-800/60 ${
                activeSession === s.session_id ? 'bg-slate-800' : ''
              }`}
            >
              <span className="truncate text-xs text-slate-200">
                {s.preview || s.session_id.slice(0, 20)}
              </span>
              <span className="text-[10px] text-slate-500">
                {s.count} msgs · {s.last ? new Date(s.last).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : ''}
              </span>
            </button>
          ))}
          {sessions.length === 0 && (
            <p className="p-4 text-xs text-slate-600">No conversations yet.</p>
          )}
        </div>
      </div>

      {/* Chat panel — primary */}
      <div className="flex min-w-0 flex-1 flex-col border-r border-slate-800">
        <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-2.5">
          <select
            className="input max-w-xs py-1.5 text-xs"
            value={workflowId || ''}
            onChange={(e) => {
              setWorkflowId(e.target.value)
              setActiveSession(null)
              setMessages([])
              loadSessions(e.target.value)
            }}
          >
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.name === DEFAULT_WF_NAME ? ' (default)' : ''}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">
            {activeSession ? `Session ${activeSession.slice(0, 8)}…` : 'New conversation'}
          </span>
          <button
            onClick={() => setKbOpen((o) => !o)}
            className="ml-auto flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-600 hover:text-white"
          >
            <Database className="h-3.5 w-3.5" />
            Knowledge base
            {kbOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>

        {kbOpen && (
          <div className="max-h-72 overflow-y-auto border-b border-slate-800 bg-slate-900/50 px-4 py-3">
            <KnowledgeBase onPick={usePrompt} />
          </div>
        )}

        <div className="flex-1 overflow-y-auto bg-slate-950/20">
          <MessageHistory messages={messages} mode="chat" />
        </div>

        <div className="border-t border-slate-800 bg-slate-900/80 p-4">
          {error && <p className="mb-2 text-xs text-rose-300">{error}</p>}
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              className="input min-h-[44px] flex-1 resize-none py-2.5"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message the agents… (Enter to send)"
              disabled={running}
            />
            <button
              onClick={send}
              disabled={running || !input.trim()}
              className="btn btn-primary self-end px-4"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-slate-600">
            Multi-turn chat stays in one session — say “hi”, then share an order ID in a follow-up.
          </p>
        </div>
      </div>

      {/* Live logs — secondary */}
      <div className="hidden w-[380px] shrink-0 flex-col xl:flex">
        <div className="border-b border-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Agent activity
        </div>
        <div className="flex-1 overflow-hidden">
          <LogStream />
        </div>
      </div>
    </div>
  )
}
