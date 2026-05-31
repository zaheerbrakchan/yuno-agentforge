import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Send, Loader2, RefreshCw, Plus, ChevronDown, ChevronUp, Database, Trash2, ArrowRightLeft, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
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
  const [runStatus, setRunStatus] = useState('')
  const [handoffBanner, setHandoffBanner] = useState(null)
  const [sessions, setSessions] = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [messages, setMessages] = useState([])
  const [error, setError] = useState('')
  const [kbOpen, setKbOpen] = useState(false)
  const [deletingSession, setDeletingSession] = useState(null)
  const [monitorFocus, setMonitorFocus] = useState(false)
  const inputRef = useRef(null)
  const handoffTimerRef = useRef(null)
  const [searchParams] = useSearchParams()

  const pickDefault = (list) => list.find((w) => w.name === DEFAULT_WF_NAME) || list[0]

  const loadSessions = async () => {
    try {
      const res = await workflowsApi.listSessions()
      setSessions(res.data)
    } catch {
      if (workflowId) {
        const res = await workflowsApi.getMessages(workflowId)
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
    }
  }

  const loadSessionMessages = async (sessionId, wfId = workflowId) => {
    if (!sessionId || !wfId) return
    const res = await workflowsApi.getMessages(wfId, sessionId)
    setMessages(res.data)
  }

  useEffect(() => {
    const wfParam = searchParams.get('workflow')
    const sessionParam = searchParams.get('session')
    const init = async () => {
      const list = await workflowsApi.list()
      setWorkflows(list.data)
      let id = wfParam && list.data.some((w) => w.id === wfParam) ? wfParam : pickDefault(list.data)?.id
      if (id) {
        setWorkflowId(id)
        await loadSessions()
        if (sessionParam) {
          setActiveSession(sessionParam)
          const res = await workflowsApi.getMessages(id, sessionParam)
          setMessages(res.data)
        }
      }
    }
    init().catch(() => {})
    return () => {
      if (handoffTimerRef.current) clearTimeout(handoffTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startNewChat = () => {
    setActiveSession(null)
    setMessages([])
    setError('')
    setHandoffBanner(null)
    inputRef.current?.focus()
  }

  const selectSession = async (sid) => {
    setActiveSession(sid)
    setError('')
    setHandoffBanner(null)
    await loadSessionMessages(sid)
  }

  const deleteSession = async (sid) => {
    if (!sid) return

    const wasActive = activeSession === sid
    setSessions((prev) => prev.filter((s) => s.session_id !== sid))
    if (wasActive) {
      setActiveSession(null)
      setMessages([])
      setHandoffBanner(null)
    }

    setDeletingSession(sid)
    setError('')
    try {
      await workflowsApi.deleteSession(sid)
    } catch (e) {
      await loadSessions()
      if (wasActive) {
        setActiveSession(sid)
        await loadSessionMessages(sid)
      }
      const detail = e?.response?.data?.detail
      setError(
        detail === 'Not Found'
          ? 'Delete failed — restart the backend to load the latest API.'
          : detail || 'Could not delete chat.',
      )
    } finally {
      setDeletingSession(null)
    }
  }

  const send = async () => {
    const text = input.trim()
    if (!text || !workflowId) return
    setRunning(true)
    setRunStatus('Checking which team should handle this…')
    setError('')
    setHandoffBanner(null)

    const optimistic = {
      id: `opt-${Date.now()}`,
      message_type: 'human_input',
      from_agent: 'human',
      content: text,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])
    setInput('')

    const statusTimer = setTimeout(() => {
      setRunStatus('Routing to the right specialist…')
    }, 1500)

    try {
      const res = await workflowsApi.run(workflowId, {
        input_message: text,
        session_id: activeSession || undefined,
        staged_handoff: true,
      })
      clearTimeout(statusTimer)

      const sid = res.data.session_id
      setActiveSession(sid)

      if (res.data.status === 'handoff_pending') {
        await loadSessionMessages(sid, workflowId)
        setHandoffBanner({
          from: res.data.handoff_from,
          to: res.data.handoff_to,
        })
        setWorkflowId(res.data.handoff_to_workflow_id)
        setRunStatus(`Invoking ${res.data.handoff_to}…`)
        if (handoffTimerRef.current) clearTimeout(handoffTimerRef.current)
        handoffTimerRef.current = setTimeout(() => setHandoffBanner(null), 12000)

        await new Promise((r) => setTimeout(r, 1400))

        const res2 = await workflowsApi.run(res.data.handoff_to_workflow_id, {
          input_message: text,
          session_id: sid,
          skip_handoff: true,
        })
        await loadSessions()
        await loadSessionMessages(sid, res.data.handoff_to_workflow_id)
        void res2
      } else {
        const targetWfId = res.data.handoff_to_workflow_id || workflowId
        if (res.data.handoff_to_workflow_id) {
          setWorkflowId(res.data.handoff_to_workflow_id)
          setHandoffBanner({
            from: res.data.handoff_from,
            to: res.data.handoff_to,
          })
          if (handoffTimerRef.current) clearTimeout(handoffTimerRef.current)
          handoffTimerRef.current = setTimeout(() => setHandoffBanner(null), 12000)
        }
        await loadSessions()
        await loadSessionMessages(sid, targetWfId)
      }
    } catch (e) {
      clearTimeout(statusTimer)
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setInput(text)
      setError(e?.response?.data?.detail || 'Run failed. Check your API key on the backend.')
    } finally {
      setRunning(false)
      setRunStatus('')
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

  const activeWorkflowName = workflows.find((w) => w.id === workflowId)?.name || 'Workflow'

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
              onClick={() => loadSessions()}
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
            <div
              key={s.session_id}
              className={`group flex items-stretch border-b border-slate-800/40 ${
                activeSession === s.session_id ? 'bg-slate-800' : 'hover:bg-slate-800/60'
              }`}
            >
              <button
                type="button"
                onClick={() => selectSession(s.session_id)}
                className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5 text-left"
              >
                <span className="truncate text-xs text-slate-200">
                  {s.preview || s.session_id.slice(0, 20)}
                </span>
                <span className="text-[10px] text-slate-500">
                  {s.count} msgs ·{' '}
                  {s.last
                    ? new Date(s.last).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                    : ''}
                </span>
              </button>
              <button
                type="button"
                onClick={() => deleteSession(s.session_id)}
                disabled={deletingSession === s.session_id}
                className="flex shrink-0 items-center px-2 text-slate-500 opacity-60 transition-opacity hover:text-rose-400 group-hover:opacity-100 disabled:opacity-40"
                title="Delete chat"
              >
                {deletingSession === s.session_id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="p-4 text-xs text-slate-600">No conversations yet.</p>
          )}
        </div>
      </div>

      {/* Chat panel — primary (hidden in monitor focus mode) */}
      {!monitorFocus && (
      <div className="flex min-w-0 flex-1 flex-col border-r border-slate-800">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-4 py-2.5">
          <select
            className={`input max-w-xs py-1.5 text-xs transition-colors ${
              handoffBanner ? 'border-sky-600 ring-1 ring-sky-600/40' : ''
            }`}
            value={workflowId || ''}
            onChange={(e) => {
              setWorkflowId(e.target.value)
              setActiveSession(null)
              setMessages([])
              setHandoffBanner(null)
              loadSessions()
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
          {running && (
            <span className="flex items-center gap-1.5 text-xs text-sky-300">
              <Loader2 className="h-3 w-3 animate-spin" />
              Active: {activeWorkflowName}
            </span>
          )}
          <button
            onClick={() => setKbOpen((o) => !o)}
            className="ml-auto flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-600 hover:text-white"
          >
            <Database className="h-3.5 w-3.5" />
            Knowledge base
            {kbOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={() => setMonitorFocus(true)}
            className="hidden items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-indigo-600 hover:text-indigo-300 xl:flex"
            title="Hide chat and expand agent activity — useful while testing on Telegram"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
            Focus monitor
          </button>
        </div>

        {handoffBanner && (
          <div className="flex items-center gap-2 border-b border-sky-800/50 bg-sky-950/40 px-4 py-2 text-xs text-sky-200">
            <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 text-sky-400" />
            <span>
              Transferred from <span className="font-medium text-white">{handoffBanner.from}</span> →{' '}
              <span className="font-medium text-white">{handoffBanner.to}</span>
              {' '}(workflow updated above)
            </span>
          </div>
        )}

        {kbOpen && (
          <div className="max-h-[min(50vh,420px)] overflow-y-auto border-b border-slate-800 bg-slate-900/50 px-4 py-3">
            <KnowledgeBase onPick={usePrompt} />
          </div>
        )}

        <div className="flex-1 overflow-y-auto bg-slate-950/20">
          <MessageHistory messages={messages} mode="chat" running={running} runStatus={runStatus} />
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
            Wrong workflow selected? Agents auto-transfer to the right team and update the workflow above.
          </p>
        </div>
      </div>
      )}

      {/* Live logs — expands when monitor focus is on */}
      <div
        className={`flex min-w-0 flex-col ${
          monitorFocus ? 'flex-1' : 'hidden w-[380px] shrink-0 xl:flex'
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Agent activity
          </span>
          <button
            type="button"
            onClick={() => setMonitorFocus((f) => !f)}
            className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:border-slate-600 hover:text-white"
            title={monitorFocus ? 'Show chat panel' : 'Expand agent activity'}
          >
            {monitorFocus ? (
              <>
                <PanelLeftOpen className="h-3.5 w-3.5" />
                Show chat
              </>
            ) : (
              <>
                <PanelLeftClose className="h-3.5 w-3.5" />
                Expand
              </>
            )}
          </button>
        </div>
        {monitorFocus && (
          <p className="border-b border-slate-800/60 bg-slate-900/40 px-3 py-1.5 text-[10px] text-slate-500">
            Monitor focus — chat hidden. Select a session on the left while you text on Telegram.
          </p>
        )}
        <div className="flex-1 overflow-hidden">
          <LogStream />
        </div>
      </div>
    </div>
  )
}
