import { useEffect, useRef } from 'react'
import { Bot, User, ArrowRightLeft, Loader2 } from 'lucide-react'

const HANDOFF_AGENTS = new Set(['Support Router', 'Orchestrator'])

/** Customer-facing chat bubbles — supports handoff turns (two assistant replies). */
export function chatMessages(messages = []) {
  const visible = []
  let i = 0

  while (i < messages.length) {
    const m = messages[i]
    if (m.message_type === 'human_input' || m.from_agent === 'telegram') {
      visible.push({ ...m, role: 'user' })
      i += 1

      const turn = []
      while (i < messages.length && messages[i].message_type !== 'human_input') {
        turn.push(messages[i])
        i += 1
      }

      const hasHandoff = turn.some((t) => t.message_type === 'inter_agent')
      if (hasHandoff) {
        const handoffAgent = turn.find(
          (t) => t.message_type === 'agent_response' && HANDOFF_AGENTS.has(t.from_agent),
        )
        const finalAgent =
          turn.find((t) => t.message_type === 'agent_response' && t.from_agent === 'Response Writer') ||
          turn.find((t) => t.message_type === 'agent_response' && t.from_agent === 'General Support Agent') ||
          turn.filter((t) => t.message_type === 'agent_response').at(-1)

        if (handoffAgent) {
          visible.push({ ...handoffAgent, role: 'assistant', variant: 'handoff' })
        }
        if (finalAgent && finalAgent.id !== handoffAgent?.id) {
          visible.push({ ...finalAgent, role: 'assistant', variant: 'final' })
        }
      } else {
        const finalAgent =
          turn.find((t) => t.message_type === 'agent_response' && t.from_agent === 'Response Writer') ||
          turn.find((t) => t.message_type === 'agent_response' && t.from_agent === 'General Support Agent') ||
          turn.filter((t) => t.message_type === 'agent_response').at(-1)
        if (finalAgent) {
          visible.push({ ...finalAgent, role: 'assistant' })
        }
      }
      continue
    }
    i += 1
  }

  return visible
}

export default function MessageHistory({ messages = [], mode = 'full', running = false, runStatus = '' }) {
  const bottomRef = useRef(null)
  const rows = mode === 'chat' ? chatMessages(messages) : messages

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [rows.length, running])

  if (rows.length === 0 && !running) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-slate-500">
        <Bot className="h-8 w-8 text-slate-600" />
        <p>Send a message to start the conversation.</p>
        <p className="text-xs text-slate-600">Try “hi” or ask about a sample order like ORD-1002.</p>
      </div>
    )
  }

  if (mode === 'chat') {
    return (
      <div className="space-y-4 px-4 py-3">
        {rows.map((m) => {
          const isUser = m.role === 'user'
          const isHandoff = m.variant === 'handoff'
          return (
            <div key={m.id} className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
              {!isUser && (
                <div
                  className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    isHandoff ? 'bg-sky-500/20' : 'bg-indigo-500/20'
                  }`}
                >
                  {isHandoff ? (
                    <ArrowRightLeft className="h-3.5 w-3.5 text-sky-300" />
                  ) : (
                    <Bot className="h-3.5 w-3.5 text-indigo-300" />
                  )}
                </div>
              )}
              <div className={`max-w-[78%] ${isUser ? 'order-first' : ''}`}>
                {!isUser && (
                  <div className={`mb-1 text-[11px] ${isHandoff ? 'text-sky-400' : 'text-slate-500'}`}>
                    {isHandoff ? `${m.from_agent} · redirecting` : m.from_agent || 'Assistant'}
                  </div>
                )}
                <div
                  className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    isUser
                      ? 'rounded-br-md bg-indigo-600 text-white'
                      : isHandoff
                        ? 'rounded-bl-md border border-sky-700/50 bg-sky-950/40 text-sky-50'
                        : 'rounded-bl-md bg-slate-800 text-slate-100'
                  }`}
                >
                  {m.content}
                </div>
                {m.created_at && (
                  <div className={`mt-1 text-[10px] text-slate-600 ${isUser ? 'text-right' : ''}`}>
                    {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
              {isUser && (
                <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-700">
                  <User className="h-3.5 w-3.5 text-slate-300" />
                </div>
              )}
            </div>
          )
        })}

        {running && (
          <div className="flex justify-start gap-2">
            <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/20">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-300" />
            </div>
            <div className="max-w-[78%] rounded-2xl rounded-bl-md border border-sky-800/40 bg-sky-950/30 px-3.5 py-2.5 text-sm text-sky-200">
              {runStatus || 'Agents are working…'}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    )
  }

  // Full mode (legacy / debug)
  return (
    <div className="space-y-3">
      {rows.map((m) => {
        const isHuman = m.message_type === 'human_input'
        return (
          <div key={m.id} className={`flex ${isHuman ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                isHuman ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-200'
              }`}
            >
              {!isHuman && <div className="mb-0.5 text-[11px] text-slate-500">{m.from_agent}</div>}
              {m.content}
            </div>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
