import { useEffect, useRef } from 'react'
import { Bot, User } from 'lucide-react'

/** Customer-facing chat bubbles — one assistant reply per user turn. */
export function chatMessages(messages = []) {
  const visible = []
  let pendingAssistant = null

  for (const m of messages) {
    if (m.message_type === 'human_input' || m.from_agent === 'telegram') {
      if (pendingAssistant) {
        visible.push(pendingAssistant)
        pendingAssistant = null
      }
      visible.push({ ...m, role: 'user' })
      continue
    }
    if (m.message_type !== 'agent_response') continue
    if (m.from_agent === 'Response Writer') {
      pendingAssistant = { ...m, role: 'assistant' }
    } else if (!pendingAssistant || pendingAssistant.from_agent !== 'Response Writer') {
      pendingAssistant = { ...m, role: 'assistant' }
    }
  }
  if (pendingAssistant) visible.push(pendingAssistant)
  return visible
}

export default function MessageHistory({ messages = [], mode = 'full' }) {
  const bottomRef = useRef(null)
  const rows = mode === 'chat' ? chatMessages(messages) : messages

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [rows.length])

  if (rows.length === 0) {
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
          return (
            <div key={m.id} className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
              {!isUser && (
                <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-500/20">
                  <Bot className="h-3.5 w-3.5 text-indigo-300" />
                </div>
              )}
              <div className={`max-w-[78%] ${isUser ? 'order-first' : ''}`}>
                {!isUser && (
                  <div className="mb-1 text-[11px] text-slate-500">{m.from_agent || 'Assistant'}</div>
                )}
                <div
                  className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    isUser
                      ? 'rounded-br-md bg-indigo-600 text-white'
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
