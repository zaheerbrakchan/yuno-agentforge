import { useEffect, useRef, useState } from 'react'
import { Play, Square, Bot, Wrench, CheckCircle2, MessageSquare, ArrowRightLeft } from 'lucide-react'

const pill = {
  agent_start: { label: 'Agent started', cls: 'bg-blue-500/20 text-blue-300', Icon: Bot },
  tool_call: { label: 'Tool called', cls: 'bg-amber-500/20 text-amber-300', Icon: Wrench },
  tool_result: { label: 'Tool result', cls: 'bg-emerald-500/20 text-emerald-300', Icon: CheckCircle2 },
  agent_response: { label: 'Response', cls: 'bg-violet-500/20 text-violet-300', Icon: MessageSquare },
  handoff: { label: 'Handoff', cls: 'bg-sky-500/20 text-sky-300', Icon: ArrowRightLeft },
}

function LogRow({ event }) {
  const meta = pill[event.type]
  if (!meta) return null
  const { label, cls, Icon } = meta
  return (
    <div className="flex flex-col gap-1 border-b border-slate-800 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className={`badge ${cls}`}>
          <Icon className="mr-1 h-3 w-3" />
          {label}
          {event.tool ? `: ${event.tool}` : ''}
        </span>
        <span className="font-medium text-slate-200">{event.agent}</span>
        {event.timestamp && (
          <span className="ml-auto text-xs text-slate-500">
            {new Date(event.timestamp).toLocaleTimeString()}
          </span>
        )}
      </div>
      {event.type === 'tool_call' && (
        <pre className="overflow-x-auto rounded bg-slate-950/70 p-2 text-xs text-amber-200">
          {JSON.stringify(event.args, null, 2)}
        </pre>
      )}
      {event.type === 'tool_result' && (
        <pre className="overflow-x-auto rounded bg-slate-950/70 p-2 text-xs text-emerald-200">
          {event.result}
        </pre>
      )}
      {event.type === 'agent_response' && (
        <div className="rounded bg-slate-950/70 p-2 text-xs text-slate-300">
          {typeof event.content === 'string'
            ? event.content
            : JSON.stringify(event.content)}
          <div className="mt-1 text-[11px] text-slate-500">
            {event.tokens} tokens · ${Number(event.cost || 0).toFixed(6)}
          </div>
        </div>
      )}
      {event.type === 'handoff' && (
        <div className="rounded border border-sky-800/40 bg-sky-950/30 p-2 text-xs text-sky-100">
          <div className="mb-1 font-medium text-sky-300">→ {event.target_workflow}</div>
          {event.content}
        </div>
      )}
    </div>
  )
}

export default function LogStream() {
  const [events, setEvents] = useState([])
  const [connected, setConnected] = useState(false)
  const [totals, setTotals] = useState({ tokens: 0, cost: 0 })
  const wsRef = useRef(null)
  const bottomRef = useRef(null)
  const [autoScroll] = useState(true)

  const connect = () => {
    if (wsRef.current) return
    // In production VITE_API_URL points at the backend; locally it's empty and
    // we connect through the Vite dev proxy on the current host.
    const apiUrl = import.meta.env.VITE_API_URL || ''
    let wsBase
    if (apiUrl) {
      wsBase = apiUrl.replace(/^http/, 'ws')
    } else {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      wsBase = `${proto}://${window.location.host}`
    }
    const ws = new WebSocket(`${wsBase}/ws/logs`)
    wsRef.current = ws
    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
    }
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data)
      if (data.type === 'ping') return
      setEvents((prev) => [...prev, data])
      if (data.type === 'agent_response') {
        setTotals((t) => ({
          tokens: t.tokens + (data.tokens || 0),
          cost: t.cost + (data.cost || 0),
        }))
      }
    }
  }

  const disconnect = () => {
    wsRef.current?.close()
    wsRef.current = null
    setConnected(false)
  }

  const clear = () => {
    setEvents([])
    setTotals({ tokens: 0, cost: 0 })
  }

  useEffect(() => {
    connect()
    return () => disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events, autoScroll])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              connected ? 'bg-emerald-400' : 'bg-rose-500'
            }`}
          />
          <span className="text-sm font-medium text-slate-200">
            Live log stream {connected ? '(connected)' : '(disconnected)'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <button onClick={disconnect} className="btn btn-secondary px-2 py-1 text-xs">
              <Square className="h-3 w-3" /> Stop
            </button>
          ) : (
            <button onClick={connect} className="btn btn-secondary px-2 py-1 text-xs">
              <Play className="h-3 w-3" /> Connect
            </button>
          )}
          <button onClick={clear} className="btn btn-secondary px-2 py-1 text-xs">
            Clear
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 border-b border-slate-800 bg-slate-900/40 px-4 py-2 text-sm">
        <div className="text-slate-400">
          Tokens: <span className="font-semibold text-indigo-300">{totals.tokens}</span>
        </div>
        <div className="text-slate-400">
          Cost: <span className="font-semibold text-emerald-300">${totals.cost.toFixed(6)}</span>
        </div>
        <div className="ml-auto text-slate-500">{events.length} events</div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-600">
            Waiting for events… run a workflow to see live logs.
          </div>
        ) : (
          events.map((e, i) => <LogRow key={i} event={e} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
