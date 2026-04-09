import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Swords,
  ArrowUp,
  ArrowLeft,
  Paperclip,
  Download,
  RotateCcw,
  User,
  Bot,
  Scale,
  Sparkles,
  Maximize2,
  Minimize2,
  X,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { easeOutExpo } from '@/lib/motion'
import { useUser } from '@/context/UserContext'
import { negotiateStream, uploadDocument, type NegotiateEvent } from '@/api/client'

// ── Types ──

interface DebateMessage {
  id: string
  agent: 'advocate' | 'challenger' | 'conclusion'
  content: string
  round: number
  isStreaming?: boolean
}

type NegotiatorStatus = 'idle' | 'running' | 'concluding' | 'done' | 'error'

// ── Markdown renderer ──

function FormattedText({ text, isStreaming, cursorColor = 'bg-suits-500' }: { text: string; isStreaming?: boolean; cursorColor?: string }) {
  // Split into lines first, then process inline formatting
  const lines = text.split('\n')

  return (
    <div className="text-sm leading-relaxed">
      {lines.map((line, li) => {
        const trimmed = line.trim()

        // Heading: lines starting with ## or ###
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={li} className="text-sm font-bold text-surface-200 mt-3 mb-1.5">
              {renderInline(trimmed.slice(4))}
            </h4>
          )
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={li} className="text-[15px] font-bold text-surface-200 mt-4 mb-1.5">
              {renderInline(trimmed.slice(3))}
            </h3>
          )
        }

        // Bullet: lines starting with - or *
        if (/^[-*]\s/.test(trimmed)) {
          return (
            <div key={li} className="flex gap-2 py-0.5 pl-1">
              <span className="text-cream-400 mt-0.5 shrink-0">&#8226;</span>
              <span>{renderInline(trimmed.slice(2))}</span>
            </div>
          )
        }

        // Numbered list: lines starting with 1. 2. etc
        const numMatch = trimmed.match(/^(\d+)\.\s(.*)/)
        if (numMatch) {
          return (
            <div key={li} className="flex gap-2 py-0.5 pl-1">
              <span className="text-cream-400 shrink-0 font-medium text-xs mt-0.5 w-4 text-right">{numMatch[1]}.</span>
              <span>{renderInline(numMatch[2])}</span>
            </div>
          )
        }

        // Empty line = paragraph break
        if (!trimmed) {
          return <div key={li} className="h-2" />
        }

        // Normal text
        return <p key={li} className="py-0.5">{renderInline(line)}</p>
      })}
      {isStreaming && (
        <span className={cn('inline-block w-[2px] h-[1.1em] ml-0.5 align-middle streaming-cursor', cursorColor)} />
      )}
    </div>
  )
}

/** Render bold and inline code within a line */
function renderInline(text: string) {
  // Split on **bold** and `code` patterns
  return text.split(/(\*\*.*?\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-surface-200">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="px-1 py-0.5 rounded bg-cream-200/60 text-surface-300 text-xs font-mono">{part.slice(1, -1)}</code>
    }
    return <span key={i}>{part}</span>
  })
}

// ── Main Component ──

export default function NegotiatorPage() {
  const [messages, setMessages] = useState<DebateMessage[]>([])
  const [status, setStatus] = useState<NegotiatorStatus>('idle')
  const [inputValue, setInputValue] = useState('')
  const [rounds, setRounds] = useState(3)
  const [currentRound, setCurrentRound] = useState(0)
  const [totalRounds, setTotalRounds] = useState(0)
  const [topic, setTopic] = useState('')
  const [documentId, setDocumentId] = useState<string | undefined>()
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conclusionFullscreen, setConclusionFullscreen] = useState(false)
  const [activeAgent, setActiveAgent] = useState<'advocate' | 'challenger' | null>(null)

  const advocateScrollRef = useRef<HTMLDivElement>(null)
  const challengerScrollRef = useRef<HTMLDivElement>(null)
  const conclusionScrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tokenBufferRef = useRef<{ agent: string; content: string }>({ agent: '', content: '' })
  const rafRef = useRef<number>(0)
  const streamMsgIdRef = useRef<string | null>(null)
  const isSubmittingRef = useRef(false)

  const { addDownload } = useUser()
  const isBusy = status === 'running' || status === 'concluding'
  const canSend = inputValue.trim().length > 0 && !isBusy

  // ── Auto-resize textarea ──
  useEffect(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
    }
  }, [inputValue])

  // ── Auto-scroll panels ──
  useEffect(() => {
    advocateScrollRef.current?.scrollTo({ top: advocateScrollRef.current.scrollHeight, behavior: 'smooth' })
    challengerScrollRef.current?.scrollTo({ top: challengerScrollRef.current.scrollHeight, behavior: 'smooth' })
    conclusionScrollRef.current?.scrollTo({ top: conclusionScrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Cleanup rAF on unmount
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // ── Flush buffered tokens ──
  const flushTokens = useCallback(() => {
    const msgId = streamMsgIdRef.current
    const buf = tokenBufferRef.current
    if (!msgId || !buf.content) return
    const chunk = buf.content
    buf.content = ''
    setMessages(prev =>
      prev.map(m => m.id === msgId ? { ...m, content: m.content + chunk } : m),
    )
  }, [])

  // ── File upload ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    try {
      const res = await uploadDocument(file)
      setDocumentId(res.document_id)
      setUploadedFilename(file.name)
    } catch {
      setError('Failed to upload document')
    }
  }

  // ── Send / Start negotiation ──
  const handleSend = useCallback(async () => {
    if (!canSend || isSubmittingRef.current) return
    isSubmittingRef.current = true

    const userMessage = inputValue.trim()
    setInputValue('')
    setMessages([])
    setStatus('running')
    setError(null)
    setTopic(userMessage)
    setCurrentRound(0)
    setTotalRounds(rounds)
    setConclusionFullscreen(false)
    setActiveAgent(null)

    const onEvent = (evt: NegotiateEvent) => {
      switch (evt.type) {
        case 'negotiate_start':
          setTotalRounds(evt.rounds || rounds)
          break

        case 'agent_start': {
          const newId = crypto.randomUUID()
          streamMsgIdRef.current = newId
          tokenBufferRef.current = { agent: evt.agent || '', content: '' }
          setCurrentRound(evt.round || 0)
          setActiveAgent((evt.agent === 'advocate' || evt.agent === 'challenger') ? evt.agent : null)

          setMessages(prev => [
            ...prev.map(m => ({ ...m, isStreaming: false })),
            {
              id: newId,
              agent: evt.agent as DebateMessage['agent'],
              content: '',
              round: evt.round || 0,
              isStreaming: true,
            },
          ])
          break
        }

        case 'token': {
          tokenBufferRef.current.content += evt.content || ''
          cancelAnimationFrame(rafRef.current)
          rafRef.current = requestAnimationFrame(flushTokens)
          break
        }

        case 'agent_end': {
          cancelAnimationFrame(rafRef.current)
          const remaining = tokenBufferRef.current.content
          tokenBufferRef.current.content = ''
          const msgId = streamMsgIdRef.current
          streamMsgIdRef.current = null
          setActiveAgent(null)
          if (msgId) {
            setMessages(prev =>
              prev.map(m => m.id === msgId ? { ...m, content: m.content + remaining, isStreaming: false } : m),
            )
          }
          break
        }

        case 'conclusion_start': {
          setStatus('concluding')
          setActiveAgent(null)
          const newId = crypto.randomUUID()
          streamMsgIdRef.current = newId
          tokenBufferRef.current = { agent: 'conclusion', content: '' }
          setMessages(prev => [
            ...prev.map(m => ({ ...m, isStreaming: false })),
            {
              id: newId,
              agent: 'conclusion',
              content: '',
              round: 0,
              isStreaming: true,
            },
          ])
          break
        }

        case 'done': {
          cancelAnimationFrame(rafRef.current)
          const remaining = tokenBufferRef.current.content
          tokenBufferRef.current.content = ''
          const msgId = streamMsgIdRef.current
          streamMsgIdRef.current = null
          if (msgId) {
            setMessages(prev =>
              prev.map(m => m.id === msgId ? { ...m, content: m.content + remaining, isStreaming: false } : m),
            )
          }
          setStatus('done')
          setActiveAgent(null)
          break
        }
      }
    }

    const onError = (errMsg: string) => {
      cancelAnimationFrame(rafRef.current)
      // Flush any remaining tokens to the streaming message
      const remaining = tokenBufferRef.current.content
      tokenBufferRef.current.content = ''
      const msgId = streamMsgIdRef.current
      streamMsgIdRef.current = null
      if (msgId) {
        setMessages(prev =>
          prev.map(m => m.id === msgId ? { ...m, content: m.content + remaining, isStreaming: false } : m),
        )
      }
      setStatus('error')
      setError(errMsg)
      setActiveAgent(null)
    }

    try {
      await negotiateStream(userMessage, documentId, rounds, onEvent, onError)
    } catch {
      onError('Something went wrong. Please try again.')
    } finally {
      isSubmittingRef.current = false
    }
  }, [canSend, inputValue, documentId, rounds, flushTokens])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleReset = () => {
    setMessages([])
    setStatus('idle')
    setTopic('')
    setCurrentRound(0)
    setTotalRounds(0)
    setError(null)
    setConclusionFullscreen(false)
    setActiveAgent(null)
    streamMsgIdRef.current = null
    cancelAnimationFrame(rafRef.current)
  }

  const handleDownload = () => {
    const advMsgs = messages.filter(m => m.agent === 'advocate')
    const chlMsgs = messages.filter(m => m.agent === 'challenger')
    const conclusionMsg = messages.find(m => m.agent === 'conclusion')

    let transcript = `AI vs AI Negotiation Transcript\n`
    transcript += `Topic: ${topic}\n`
    transcript += `Date: ${new Date().toLocaleDateString()}\n`
    transcript += `${'='.repeat(60)}\n\n`

    for (let i = 0; i < Math.max(advMsgs.length, chlMsgs.length); i++) {
      const round = i + 1
      transcript += `--- Round ${round} ---\n\n`
      if (advMsgs[i]) {
        transcript += `ADVOCATE (Your Side):\n${advMsgs[i].content}\n\n`
      }
      if (chlMsgs[i]) {
        transcript += `CHALLENGER (Opposing Side):\n${chlMsgs[i].content}\n\n`
      }
    }

    if (conclusionMsg) {
      transcript += `${'='.repeat(60)}\n`
      transcript += `CONCLUSION:\n${conclusionMsg.content}\n`
    }

    const blob = new Blob([transcript], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `negotiation-${topic.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}.txt`
    a.click()
    URL.revokeObjectURL(url)
    addDownload({
      id: crypto.randomUUID(),
      documentId: documentId || 'negotiation',
      filename: uploadedFilename || topic.slice(0, 40),
      exportType: 'negotiation_transcript',
      exportLabel: 'Negotiation Transcript',
      downloadedAt: Date.now(),
    })
  }

  // ── Split messages by agent ──
  const advocateMessages = messages.filter(m => m.agent === 'advocate')
  const challengerMessages = messages.filter(m => m.agent === 'challenger')
  const conclusionMessage = messages.find(m => m.agent === 'conclusion')
  const isEmpty = messages.length === 0

  // ── Progress bar width ──
  const progressPct = totalRounds > 0
    ? status === 'done' ? 100 : status === 'concluding' ? 90 : (currentRound / totalRounds) * 80
    : 0

  return (
    <div className="flex flex-col h-screen bg-cream overflow-hidden relative">
      {/* ── Fullscreen conclusion overlay ── */}
      <AnimatePresence>
        {conclusionFullscreen && conclusionMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 bg-cream/95 backdrop-blur-sm flex flex-col"
          >
            {/* Fullscreen header */}
            <div className="shrink-0 px-6 py-4 border-b border-cream-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                  <Scale className="w-[18px] h-[18px] text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-surface-200">Final Verdict</h2>
                  <p className="text-xs text-cream-400">Balanced conclusion from both perspectives</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <motion.button
                  onClick={handleDownload}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-cream-200 text-surface-400 hover:text-surface-200 hover:border-cream-300 transition-colors text-sm"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Download className="w-4 h-4" />
                  <span>Download</span>
                </motion.button>
                <motion.button
                  onClick={() => setConclusionFullscreen(false)}
                  className="p-2 rounded-xl bg-white border border-cream-200 text-surface-400 hover:text-surface-200 hover:border-cream-300 transition-colors"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Minimize2 className="w-4 h-4" />
                </motion.button>
              </div>
            </div>

            {/* Fullscreen content */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-6 py-8">
                {/* Topic context */}
                <div className="mb-6 px-4 py-3 rounded-xl bg-cream-100 border border-cream-200">
                  <p className="text-xs text-cream-400 mb-1">Negotiation topic</p>
                  <p className="text-sm font-medium text-surface-200">{topic}</p>
                  {uploadedFilename && (
                    <p className="text-xs text-cream-400 mt-1 flex items-center gap-1">
                      <Paperclip className="w-3 h-3" /> {uploadedFilename}
                    </p>
                  )}
                </div>

                <div className="text-surface-300">
                  <FormattedText text={conclusionMessage.content} />
                </div>

                {/* Quick debate reference */}
                <div className="mt-8 pt-6 border-t border-cream-200">
                  <p className="text-xs text-cream-400 uppercase tracking-wider font-medium mb-3">Debate Summary</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-blue-50/50 border border-blue-100 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-5 h-5 rounded bg-blue-500 flex items-center justify-center">
                          <User className="w-3 h-3 text-white" />
                        </div>
                        <span className="text-xs font-semibold text-blue-600">Advocate</span>
                        <span className="text-[10px] text-cream-400 ml-auto">{advocateMessages.length} turns</span>
                      </div>
                      <p className="text-xs text-surface-400 line-clamp-3">
                        {advocateMessages[0]?.content ? advocateMessages[0].content.slice(0, 150) + '...' : 'No arguments recorded'}
                      </p>
                    </div>
                    <div className="rounded-xl bg-orange-50/50 border border-orange-100 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-5 h-5 rounded bg-orange-500 flex items-center justify-center">
                          <Bot className="w-3 h-3 text-white" />
                        </div>
                        <span className="text-xs font-semibold text-orange-600">Challenger</span>
                        <span className="text-[10px] text-cream-400 ml-auto">{challengerMessages.length} turns</span>
                      </div>
                      <p className="text-xs text-surface-400 line-clamp-3">
                        {challengerMessages[0]?.content ? challengerMessages[0].content.slice(0, 150) + '...' : 'No arguments recorded'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <div className="shrink-0 px-6 pt-4 pb-3 border-b border-cream-200 bg-white/50">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            {status !== 'idle' && (
              <button
                onClick={handleReset}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-cream-100 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-sm">
              <Swords className="w-[18px] h-[18px] text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-surface-200">AI vs AI Negotiator</h1>
              <p className="text-xs text-cream-400">Watch two AI agents debate and negotiate in real-time</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Progress indicator */}
            {status !== 'idle' && (
              <div className="flex items-center gap-3">
                {/* Round pills */}
                <div className="hidden sm:flex items-center gap-1">
                  {Array.from({ length: totalRounds }, (_, i) => i + 1).map(r => (
                    <div
                      key={r}
                      className={cn(
                        'w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center transition-all duration-300',
                        r < currentRound ? 'bg-green-100 text-green-600 border border-green-200' :
                        r === currentRound && status === 'running' ? 'bg-amber-100 text-amber-600 border border-amber-300 ring-2 ring-amber-200/50' :
                        'bg-cream-100 text-cream-400 border border-cream-200',
                      )}
                    >
                      {r}
                    </div>
                  ))}
                  {(status === 'concluding' || status === 'done') && (
                    <div className={cn(
                      'w-6 h-6 rounded-full text-[10px] flex items-center justify-center transition-all duration-300',
                      status === 'done' ? 'bg-green-100 text-green-600 border border-green-200' :
                      'bg-purple-100 text-purple-600 border border-purple-300 ring-2 ring-purple-200/50',
                    )}>
                      <Scale className="w-3 h-3" />
                    </div>
                  )}
                </div>

                {/* Mobile: simple counter */}
                <div className="flex sm:hidden items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cream-100 border border-cream-200">
                  <span className="text-xs text-cream-400">Round</span>
                  <span className="text-sm font-semibold text-surface-200">{currentRound}/{totalRounds}</span>
                </div>
              </div>
            )}

            {/* Status badge */}
            {status !== 'idle' && (
              <div className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                status === 'running' && 'bg-blue-50 text-blue-600 border border-blue-100',
                status === 'concluding' && 'bg-purple-50 text-purple-600 border border-purple-100',
                status === 'done' && 'bg-green-50 text-green-600 border border-green-100',
                status === 'error' && 'bg-red-50 text-red-600 border border-red-100',
              )}>
                {status === 'running' && 'Debating'}
                {status === 'concluding' && 'Concluding'}
                {status === 'done' && 'Complete'}
                {status === 'error' && 'Error'}
              </div>
            )}

            {/* Actions */}
            {status === 'done' && (
              <div className="flex items-center gap-1.5">
                <motion.button
                  onClick={handleDownload}
                  className="p-2 rounded-xl bg-white border border-cream-200 text-surface-400 hover:text-surface-200 hover:border-cream-300 hover:shadow-sm transition-all"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  title="Download transcript"
                >
                  <Download className="w-4 h-4" />
                </motion.button>
                <motion.button
                  onClick={handleReset}
                  className="p-2 rounded-xl bg-white border border-cream-200 text-surface-400 hover:text-surface-200 hover:border-cream-300 hover:shadow-sm transition-all"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  title="New negotiation"
                >
                  <RotateCcw className="w-4 h-4" />
                </motion.button>
              </div>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {status !== 'idle' && (
          <div className="max-w-7xl mx-auto mt-3">
            <div className="h-1 rounded-full bg-cream-200 overflow-hidden">
              <motion.div
                className={cn(
                  'h-full rounded-full',
                  status === 'done' ? 'bg-green-400' :
                  status === 'concluding' ? 'bg-purple-400' :
                  'bg-gradient-to-r from-blue-400 to-orange-400',
                )}
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {isEmpty && status === 'idle' ? (
          /* ── Empty state ── */
          <div className="flex-1 flex items-center justify-center px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: easeOutExpo }}
              className="text-center max-w-xl"
            >
              <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-amber-500/10 to-orange-600/10 flex items-center justify-center border border-amber-200/30">
                <Swords className="w-9 h-9 text-amber-600" />
              </div>
              <h2 className="text-2xl font-semibold text-surface-200 mb-2">Start a Negotiation</h2>
              <p className="text-surface-400 mb-10 leading-relaxed max-w-md mx-auto">
                Two AI agents will debate from opposing perspectives — one advocating for you, the other challenging your position.
              </p>

              <div className="grid grid-cols-2 gap-3 mb-8 max-w-md mx-auto">
                {[
                  { label: 'Negotiate rent terms', sub: 'Rental agreement', icon: User },
                  { label: 'Debate NDA fairness', sub: 'Confidentiality', icon: Swords },
                  { label: 'Challenge employment clause', sub: 'Work contract', icon: Bot },
                  { label: 'Discuss IP ownership', sub: 'Intellectual property', icon: Scale },
                ].map(suggestion => (
                  <motion.button
                    key={suggestion.label}
                    onClick={() => setInputValue(suggestion.label)}
                    className="flex items-center gap-3 p-3.5 rounded-2xl border border-cream-200 bg-white hover:border-amber-300 hover:shadow-md transition-all text-left group"
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div className="w-8 h-8 rounded-lg bg-cream-100 group-hover:bg-amber-50 flex items-center justify-center shrink-0 transition-colors">
                      <suggestion.icon className="w-4 h-4 text-cream-400 group-hover:text-amber-600 transition-colors" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-surface-300 group-hover:text-surface-200 truncate">{suggestion.label}</p>
                      <p className="text-[10px] text-cream-400">{suggestion.sub}</p>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-cream-300 group-hover:text-amber-400 shrink-0 ml-auto transition-colors" />
                  </motion.button>
                ))}
              </div>

              <div className="flex items-center justify-center gap-2 text-cream-400">
                <Sparkles className="w-3.5 h-3.5" />
                <span className="text-xs">Powered by two competing AI models</span>
              </div>
            </motion.div>
          </div>
        ) : (
          /* ── Debate area ── */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Topic bar */}
            {topic && (
              <div className="shrink-0 px-6 py-2 bg-cream-100/30 border-b border-cream-200/50">
                <p className="text-center text-xs text-surface-400 max-w-4xl mx-auto flex items-center justify-center gap-2">
                  <Swords className="w-3 h-3 text-cream-400" />
                  <span className="font-medium">{topic}</span>
                  {uploadedFilename && (
                    <span className="text-cream-400 flex items-center gap-1">
                      · <Paperclip className="w-2.5 h-2.5" /> {uploadedFilename}
                    </span>
                  )}
                </p>
              </div>
            )}

            {/* Split panels */}
            <div className="flex-1 flex overflow-hidden">
              {/* ── Agent 1: Advocate (Left) ── */}
              <div className={cn(
                'flex-1 flex flex-col border-r border-cream-200 transition-opacity duration-300',
                activeAgent === 'challenger' ? 'opacity-60' : 'opacity-100',
              )}>
                <div className="shrink-0 px-4 py-2.5 bg-gradient-to-r from-blue-50/80 to-blue-50/20 border-b border-cream-200">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
                      <User className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-200">Advocate</p>
                      <p className="text-[10px] text-cream-400 leading-tight">Your Side · Gemini Flash</p>
                    </div>
                    {activeAgent === 'advocate' && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-100 border border-blue-200"
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                        <span className="text-[10px] text-blue-600 font-medium">Speaking</span>
                      </motion.div>
                    )}
                    {status === 'done' && (
                      <span className="text-[10px] text-cream-400">{advocateMessages.length} turns</span>
                    )}
                  </div>
                </div>

                <div ref={advocateScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                  <AnimatePresence>
                    {advocateMessages.map(msg => (
                      <MessageBubble key={msg.id} message={msg} variant="advocate" />
                    ))}
                  </AnimatePresence>
                  {status === 'running' && advocateMessages.length === 0 && currentRound === 0 && (
                    <ThinkingDots label="Preparing opening argument..." color="blue" />
                  )}
                </div>
              </div>

              {/* ── Center divider with round indicators ── */}
              <div className="hidden lg:flex flex-col items-center py-4 w-0 relative">
                {/* The actual visual divider is the border on the left panel */}
              </div>

              {/* ── Agent 2: Challenger (Right) ── */}
              <div className={cn(
                'flex-1 flex flex-col transition-opacity duration-300',
                activeAgent === 'advocate' ? 'opacity-60' : 'opacity-100',
              )}>
                <div className="shrink-0 px-4 py-2.5 bg-gradient-to-l from-orange-50/80 to-orange-50/20 border-b border-cream-200">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-sm">
                      <Bot className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-200">Challenger</p>
                      <p className="text-[10px] text-cream-400 leading-tight">Opposing Side · GPT-4o Mini</p>
                    </div>
                    {activeAgent === 'challenger' && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-orange-100 border border-orange-200"
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                        <span className="text-[10px] text-orange-600 font-medium">Speaking</span>
                      </motion.div>
                    )}
                    {status === 'done' && (
                      <span className="text-[10px] text-cream-400">{challengerMessages.length} turns</span>
                    )}
                  </div>
                </div>

                <div ref={challengerScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                  <AnimatePresence>
                    {challengerMessages.map(msg => (
                      <MessageBubble key={msg.id} message={msg} variant="challenger" />
                    ))}
                  </AnimatePresence>
                  {status === 'running' && advocateMessages.length > 0 && challengerMessages.length < advocateMessages.length && (
                    <ThinkingDots label="Formulating counter-argument..." color="orange" />
                  )}
                </div>
              </div>
            </div>

            {/* ── Conclusion panel ── */}
            <AnimatePresence>
              {(status === 'concluding' || (status === 'done' && conclusionMessage)) && !conclusionFullscreen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.4, ease: easeOutExpo }}
                  className="shrink-0 border-t-2 border-purple-200/60"
                >
                  <div className="bg-gradient-to-r from-purple-50/40 via-indigo-50/30 to-purple-50/40">
                    <div className="px-6 py-2.5 border-b border-purple-100/50">
                      <div className="flex items-center gap-2.5 max-w-4xl mx-auto">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-sm">
                          <Scale className="w-3.5 h-3.5 text-white" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-surface-200">Final Verdict</p>
                          <p className="text-[10px] text-cream-400">Balanced conclusion from both perspectives</p>
                        </div>
                        {status === 'concluding' && (
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-purple-100 border border-purple-200">
                            <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                            <span className="text-[10px] text-purple-600 font-medium">Synthesizing</span>
                          </div>
                        )}
                        {status === 'done' && (
                          <motion.button
                            onClick={() => setConclusionFullscreen(true)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-purple-200 text-purple-600 hover:bg-purple-50 transition-colors text-xs font-medium"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                          >
                            <Maximize2 className="w-3 h-3" />
                            <span>Read Full</span>
                          </motion.button>
                        )}
                      </div>
                    </div>
                    <div ref={conclusionScrollRef} className="max-h-56 overflow-y-auto px-6 py-4">
                      <div className="max-w-4xl mx-auto text-surface-300">
                        {conclusionMessage ? (
                          <FormattedText
                            text={conclusionMessage.content}
                            isStreaming={conclusionMessage.isStreaming}
                            cursorColor="bg-purple-500"
                          />
                        ) : (
                          <ThinkingDots label="Analyzing debate..." color="purple" />
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── Error ── */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="shrink-0 px-6 py-2"
            >
              <div className="max-w-3xl mx-auto flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200">
                <X className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-sm text-red-600 flex-1">{error}</span>
                <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 p-0.5">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Input bar ── */}
      <div className="shrink-0 px-6 pb-4 pt-2 bg-gradient-to-t from-cream via-cream to-transparent">
        <div className="max-w-3xl mx-auto">
          {/* Round selector + file badge */}
          {status === 'idle' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center justify-center gap-2 mb-2.5"
            >
              <span className="text-[11px] text-cream-400 font-medium">Rounds</span>
              <div className="flex items-center gap-1 bg-white rounded-lg border border-cream-200 p-0.5">
                {[2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => setRounds(n)}
                    className={cn(
                      'w-7 h-7 rounded-md text-xs font-semibold transition-all duration-200',
                      rounds === n
                        ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm'
                        : 'text-surface-400 hover:bg-cream-100',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              {uploadedFilename && (
                <div className="ml-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-50 border border-green-200">
                  <Paperclip className="w-3 h-3 text-green-600" />
                  <span className="text-[11px] text-green-700 max-w-[100px] truncate font-medium">{uploadedFilename}</span>
                  <button
                    onClick={() => { setDocumentId(undefined); setUploadedFilename(null) }}
                    className="text-green-400 hover:text-red-500 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </motion.div>
          )}

          <div className={cn(
            'flex items-center gap-2 bg-white border rounded-2xl px-4 py-3 shadow-sm transition-all duration-300',
            isBusy ? 'border-cream-200 opacity-60' : 'border-cream-300 focus-within:border-amber-400/50 focus-within:shadow-md',
          )}>
            {/* Upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.txt"
              className="hidden"
              onChange={handleFileUpload}
            />
            {!isBusy && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded-lg text-surface-400 hover:text-surface-300 hover:bg-cream-100 transition-colors shrink-0"
                title="Upload a document for context"
              >
                <Paperclip className="w-[18px] h-[18px]" />
              </button>
            )}

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isBusy
                  ? 'Negotiation in progress...'
                  : status === 'done'
                    ? 'Start a new negotiation...'
                    : 'Describe what you want to negotiate or debate...'
              }
              disabled={isBusy}
              rows={1}
              className="flex-1 bg-transparent text-surface-200 placeholder:text-cream-400 text-[15px] leading-relaxed outline-none resize-none overflow-hidden disabled:opacity-50"
            />

            {/* Send */}
            <motion.button
              onClick={status === 'done' ? handleReset : handleSend}
              disabled={status === 'done' ? false : !canSend}
              className={cn(
                'p-2 rounded-xl transition-all duration-200 shrink-0',
                (canSend || status === 'done')
                  ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm hover:shadow-md'
                  : 'bg-cream-200 text-cream-400 cursor-not-allowed',
              )}
              whileHover={(canSend || status === 'done') ? { scale: 1.05 } : {}}
              whileTap={(canSend || status === 'done') ? { scale: 0.95 } : {}}
            >
              {status === 'done' ? (
                <RotateCcw className="w-4 h-4" />
              ) : (
                <ArrowUp className="w-4 h-4" />
              )}
            </motion.button>
          </div>

          <p className="text-center text-[11px] text-cream-400 mt-2">
            Two AI models debate from opposing sides. This is not legal advice.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ──

function MessageBubble({ message, variant }: { message: DebateMessage; variant: 'advocate' | 'challenger' }) {
  const isAdvocate = variant === 'advocate'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: easeOutExpo }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className={cn(
          'w-4 h-4 rounded flex items-center justify-center',
          isAdvocate ? 'bg-blue-100' : 'bg-orange-100',
        )}>
          {isAdvocate
            ? <User className="w-2.5 h-2.5 text-blue-500" />
            : <Bot className="w-2.5 h-2.5 text-orange-500" />
          }
        </div>
        <span className={cn(
          'text-[10px] font-semibold uppercase tracking-wider',
          isAdvocate ? 'text-blue-400' : 'text-orange-400',
        )}>
          Round {message.round}
        </span>
      </div>
      <div className={cn(
        'rounded-2xl px-4 py-3 text-surface-300',
        isAdvocate
          ? 'bg-blue-50/70 border border-blue-100/80'
          : 'bg-orange-50/70 border border-orange-100/80',
      )}>
        <FormattedText
          text={message.content}
          isStreaming={message.isStreaming}
          cursorColor={isAdvocate ? 'bg-blue-500' : 'bg-orange-500'}
        />
      </div>
    </motion.div>
  )
}

function ThinkingDots({ label, color }: { label: string; color: 'blue' | 'orange' | 'purple' }) {
  const dotColor = color === 'blue' ? 'bg-blue-500' : color === 'orange' ? 'bg-orange-500' : 'bg-purple-500'
  const textColor = color === 'blue' ? 'text-blue-400' : color === 'orange' ? 'text-orange-400' : 'text-purple-400'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-2.5 py-3"
    >
      <div className="flex items-center gap-1">
        <div className={cn('w-1.5 h-1.5 rounded-full typing-dot', dotColor)} />
        <div className={cn('w-1.5 h-1.5 rounded-full typing-dot', dotColor)} />
        <div className={cn('w-1.5 h-1.5 rounded-full typing-dot', dotColor)} />
      </div>
      <span className={cn('text-xs', textColor)}>{label}</span>
    </motion.div>
  )
}
