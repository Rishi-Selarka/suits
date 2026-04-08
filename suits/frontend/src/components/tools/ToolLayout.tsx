import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowUp,
  MessageSquare,
  ChevronUp,
  Paperclip,
  X,
  Download,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { easeOutExpo } from '@/lib/motion'
import {
  uploadDocument,
  analyzeDocumentSSE,
  getResults,
  chatWithDocumentStream,
  downloadReport,
  type AnalysisResult,
  type SSEEvent,
  type ChatResponse,
} from '@/api/client'

// ── Types ──

interface ToolLayoutProps {
  title: string
  description: string
  icon: typeof Upload
  exportType?: string
  children: (result: AnalysisResult) => React.ReactNode
}

type ToolPhase = 'empty' | 'uploading' | 'analyzing' | 'done' | 'error'

interface AgentProgress {
  name: string
  status: 'idle' | 'running' | 'complete' | 'error'
  timing_ms?: number
}

const AGENT_ORDER = ['ingestor', 'classifier', 'simplifier', 'risk_analyzer', 'benchmark', 'advisor', 'verifier']
const AGENT_LABELS: Record<string, string> = {
  ingestor: 'Ingesting document',
  classifier: 'Classifying clauses',
  simplifier: 'Simplifying language',
  risk_analyzer: 'Analyzing risks',
  benchmark: 'Benchmarking terms',
  advisor: 'Synthesizing report',
  verifier: 'Verifying results',
}

// ── Chat message type ──

interface ChatMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

// ── Main Component ──

export default function ToolLayout({ title, description, icon: Icon, exportType, children }: ToolLayoutProps) {
  const [phase, setPhase] = useState<ToolPhase>('empty')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [filename, setFilename] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [agents, setAgents] = useState<Record<string, AgentProgress>>({})
  const [currentAgent, setCurrentAgent] = useState('')
  const [downloading, setDownloading] = useState(false)

  // Chat state
  const [chatOpen, setChatOpen] = useState(false)
  const [chatFullscreen, setChatFullscreen] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null)
  const tokenBufRef = useRef('')
  const rafRef = useRef(0)
  const streamIdRef = useRef<string | null>(null)

  // Auto-scroll results
  useEffect(() => {
    if (phase === 'done' && scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [phase])

  // Auto-scroll chat
  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [chatMessages])

  // Textarea auto-resize
  useEffect(() => {
    const ta = chatTextareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 100)}px`
    }
  }, [chatInput])

  // Cleanup
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // ── Upload & analyze ──
  const handleUpload = useCallback(async (file: File) => {
    setPhase('uploading')
    setFilename(file.name)
    setErrorMsg(null)
    setResult(null)
    setChatMessages([])
    setChatOpen(false)

    try {
      const uploadRes = await uploadDocument(file)
      const docId = uploadRes.document_id
      setDocumentId(docId)

      // Check if already cached
      if (uploadRes.status === 'cached') {
        const fullResult = await getResults(docId)
        setResult(fullResult)
        setPhase('done')
        return
      }

      // Start analysis
      setPhase('analyzing')
      const initial: Record<string, AgentProgress> = {}
      for (const name of AGENT_ORDER) {
        initial[name] = { name, status: 'idle' }
      }
      setAgents(initial)

      await analyzeDocumentSSE(
        docId,
        (event: SSEEvent) => {
          if (event.agent === 'pipeline') {
            if (event.status === 'cached') {
              // cached pipeline, fetch results
            } else if (event.status === 'error') {
              setPhase('error')
              setErrorMsg(event.error || 'Analysis failed')
            }
            return
          }
          setCurrentAgent(event.agent)
          setAgents(prev => ({
            ...prev,
            [event.agent]: {
              name: event.agent,
              status: event.status as AgentProgress['status'],
              timing_ms: event.timing_ms,
            },
          }))
        },
        async () => {
          try {
            const fullResult = await getResults(docId)
            setResult(fullResult)
            setPhase('done')
          } catch {
            setPhase('error')
            setErrorMsg('Failed to fetch results')
          }
        },
        (errMsg) => {
          setPhase('error')
          setErrorMsg(errMsg)
        },
      )
    } catch (err) {
      setPhase('error')
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed')
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    handleUpload(file)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleUpload(file)
  }, [handleUpload])

  const handleReset = () => {
    setPhase('empty')
    setResult(null)
    setDocumentId(null)
    setFilename('')
    setErrorMsg(null)
    setAgents({})
    setChatMessages([])
    setChatOpen(false)
    setChatFullscreen(false)
  }

  const handleDownloadPDF = useCallback(async () => {
    if (!documentId || !exportType || downloading) return
    setDownloading(true)
    try {
      const blob = await downloadReport(documentId, exportType)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `suits-${exportType}-${documentId.slice(0, 8)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      // silently fail
    } finally {
      setDownloading(false)
    }
  }, [documentId, exportType, downloading])

  const handleExportChat = useCallback(() => {
    if (chatMessages.length === 0) return
    const lines = [
      `Suits AI — ${title} Chat Transcript`,
      `Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      filename ? `Document: ${filename}` : '',
      '═'.repeat(60),
      '',
    ].filter(Boolean)
    for (const msg of chatMessages) {
      const label = msg.role === 'user' ? 'You' : 'Suits AI'
      lines.push(`[${label}]`)
      lines.push(msg.content)
      lines.push('')
    }
    lines.push('═'.repeat(60))
    lines.push('Generated by Suits AI')

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `suits-${title.toLowerCase().replace(/\s+/g, '-')}-chat.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [chatMessages, title, filename])

  // ── Chat token flush ──
  const flushChatTokens = useCallback(() => {
    const msgId = streamIdRef.current
    if (!msgId || !tokenBufRef.current) return
    const chunk = tokenBufRef.current
    tokenBufRef.current = ''
    setChatMessages(prev =>
      prev.map(m => m.id === msgId ? { ...m, content: m.content + chunk } : m),
    )
  }, [])

  // ── Chat send ──
  const handleChatSend = useCallback(async () => {
    if (!chatInput.trim() || chatBusy || !documentId) return
    const text = chatInput.trim()
    setChatInput('')
    setChatBusy(true)

    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: 'user', content: text }
    const assistantId = crypto.randomUUID()
    streamIdRef.current = assistantId
    tokenBufRef.current = ''

    setChatMessages(prev => [...prev, userMsg])

    let firstToken = false

    const onToken = (token: string) => {
      if (!firstToken) {
        firstToken = true
        setChatMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', isStreaming: true }])
      }
      tokenBufRef.current += token
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(flushChatTokens)
    }

    const onDone = (_sources: ChatResponse['source_clauses']) => {
      cancelAnimationFrame(rafRef.current)
      const remaining = tokenBufRef.current
      tokenBufRef.current = ''
      streamIdRef.current = null
      setChatMessages(prev =>
        prev.map(m => m.id === assistantId ? { ...m, content: m.content + remaining, isStreaming: false } : m),
      )
      setChatBusy(false)
    }

    const onError = (err: string) => {
      cancelAnimationFrame(rafRef.current)
      tokenBufRef.current = ''
      streamIdRef.current = null
      setChatMessages(prev => {
        const exists = prev.find(m => m.id === assistantId)
        if (exists) return prev.map(m => m.id === assistantId ? { ...m, content: m.content || err, isStreaming: false } : m)
        return [...prev, { id: assistantId, role: 'assistant' as const, content: err }]
      })
      setChatBusy(false)
    }

    try {
      await chatWithDocumentStream(documentId, text, onToken, onDone, onError)
    } catch {
      onError('Something went wrong. Please try again.')
    }
  }, [chatInput, chatBusy, documentId, flushChatTokens])

  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleChatSend()
    }
  }

  // ── Computed ──
  const completedAgents = Object.values(agents).filter(a => a.status === 'complete').length
  const totalAgents = AGENT_ORDER.length

  return (
    <div className="flex flex-col h-screen bg-cream overflow-hidden relative">
      {/* ── Header ── */}
      <div className="shrink-0 px-6 pt-4 pb-3 border-b border-cream-200 bg-white/50">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-suits-500/10 flex items-center justify-center">
              <Icon className="w-[18px] h-[18px] text-suits-600" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-surface-200">{title}</h1>
              <p className="text-xs text-cream-400">{description}</p>
            </div>
          </div>

          {/* Right side: file badge + actions */}
          <div className="flex items-center gap-2">
            {phase === 'done' && filename && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 border border-green-200">
                <FileText className="w-3 h-3 text-green-600" />
                <span className="text-xs text-green-700 max-w-[140px] truncate font-medium">{filename}</span>
              </div>
            )}
            {phase === 'done' && exportType && (
              <button
                onClick={handleDownloadPDF}
                disabled={downloading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-200 text-xs text-surface-400 hover:text-surface-200 hover:border-cream-300 transition-colors disabled:opacity-50"
              >
                <Download className={cn('w-3 h-3', downloading && 'animate-pulse')} />
                <span>{downloading ? 'Downloading...' : 'Download PDF'}</span>
              </button>
            )}
            {phase === 'done' && (
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-200 text-xs text-surface-400 hover:text-surface-200 hover:border-cream-300 transition-colors"
              >
                <Upload className="w-3 h-3" />
                <span>New document</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* ── Empty: Upload UI ── */}
        {phase === 'empty' && (
          <div className="flex items-center justify-center min-h-[calc(100vh-140px)] px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: easeOutExpo }}
              className="w-full max-w-md"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.txt"
                className="hidden"
                onChange={handleFileChange}
              />

              {/* Drop zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                className="group cursor-pointer border-2 border-dashed border-cream-300 hover:border-suits-400 rounded-2xl p-10 text-center transition-all duration-300 hover:bg-suits-500/[0.02] hover:shadow-sm"
              >
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-cream-100 group-hover:bg-suits-500/10 flex items-center justify-center transition-colors duration-300">
                  <Upload className="w-6 h-6 text-cream-400 group-hover:text-suits-500 transition-colors duration-300" />
                </div>
                <p className="text-sm font-medium text-surface-300 mb-1">
                  Drop a document here or click to upload
                </p>
                <p className="text-xs text-cream-400">
                  PDF, PNG, JPG, or TXT — up to 20 MB
                </p>
              </div>

              <p className="text-center text-xs text-cream-400 mt-4">
                Your document will be analyzed by our AI pipeline to generate {title.toLowerCase()} insights.
              </p>
            </motion.div>
          </div>
        )}

        {/* ── Uploading ── */}
        {phase === 'uploading' && (
          <div className="flex items-center justify-center min-h-[calc(100vh-140px)] px-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-suits-500/10 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-suits-500 animate-spin" />
              </div>
              <p className="text-sm font-medium text-surface-300">Uploading {filename}...</p>
              <p className="text-xs text-cream-400 mt-1">Preparing for analysis</p>
            </motion.div>
          </div>
        )}

        {/* ── Analyzing (mini pipeline) ── */}
        {phase === 'analyzing' && (
          <div className="flex items-center justify-center min-h-[calc(100vh-140px)] px-6">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-sm"
            >
              <div className="text-center mb-6">
                <p className="text-sm font-medium text-surface-300 mb-1">Analyzing {filename}</p>
                <p className="text-xs text-cream-400">{completedAgents}/{totalAgents} stages complete</p>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 rounded-full bg-cream-200 overflow-hidden mb-6">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-suits-500 to-suits-600"
                  animate={{ width: `${(completedAgents / totalAgents) * 100}%` }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                />
              </div>

              {/* Agent list */}
              <div className="space-y-1.5">
                {AGENT_ORDER.map(name => {
                  const agent = agents[name]
                  if (!agent) return null
                  const isActive = agent.status === 'running'
                  const isDone = agent.status === 'complete'
                  const isFailed = agent.status === 'error'

                  return (
                    <motion.div
                      key={name}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-300',
                        isActive && 'bg-suits-500/5 border border-suits-200',
                        isDone && 'opacity-60',
                        !isActive && !isDone && !isFailed && 'opacity-30',
                      )}
                      animate={isActive ? { opacity: 1 } : {}}
                    >
                      <div className="w-5 h-5 flex items-center justify-center shrink-0">
                        {isActive && <Loader2 className="w-4 h-4 text-suits-500 animate-spin" />}
                        {isDone && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                        {isFailed && <XCircle className="w-4 h-4 text-red-500" />}
                        {agent.status === 'idle' && <div className="w-2 h-2 rounded-full bg-cream-300" />}
                      </div>
                      <span className={cn(
                        'text-xs flex-1',
                        isActive ? 'text-surface-200 font-medium' : 'text-surface-400',
                      )}>
                        {AGENT_LABELS[name] || name}
                      </span>
                      {isDone && agent.timing_ms && (
                        <span className="text-[10px] text-cream-400">{(agent.timing_ms / 1000).toFixed(1)}s</span>
                      )}
                    </motion.div>
                  )
                })}
              </div>

              {/* Current status */}
              {currentAgent && (
                <motion.p
                  key={currentAgent}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center text-xs text-suits-500 mt-4 font-medium"
                >
                  {AGENT_LABELS[currentAgent] || currentAgent}...
                </motion.p>
              )}
            </motion.div>
          </div>
        )}

        {/* ── Error ── */}
        {phase === 'error' && (
          <div className="flex items-center justify-center min-h-[calc(100vh-140px)] px-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center max-w-sm"
            >
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-red-50 flex items-center justify-center">
                <XCircle className="w-6 h-6 text-red-500" />
              </div>
              <p className="text-sm font-medium text-surface-300 mb-1">Analysis Failed</p>
              <p className="text-xs text-cream-400 mb-4">{errorMsg || 'Something went wrong'}</p>
              <button
                onClick={handleReset}
                className="px-4 py-2 rounded-xl bg-surface-200 text-white text-sm hover:bg-surface-300 transition-colors"
              >
                Try Again
              </button>
            </motion.div>
          </div>
        )}

        {/* ── Results ── */}
        {phase === 'done' && result && (
          <div className="max-w-7xl mx-auto px-6 py-8">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: easeOutExpo }}
            >
              {children(result)}
            </motion.div>

            {/* Ask a question prompt */}
            {!chatOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.4 }}
                className="mt-8 mb-4"
              >
                <button
                  onClick={() => setChatOpen(true)}
                  className="w-full flex items-center gap-3 p-4 rounded-2xl border border-cream-200 bg-white hover:border-suits-300 hover:shadow-sm transition-all group"
                >
                  <div className="w-9 h-9 rounded-xl bg-suits-500/10 group-hover:bg-suits-500/15 flex items-center justify-center transition-colors">
                    <MessageSquare className="w-4 h-4 text-suits-600" />
                  </div>
                  <div className="text-left flex-1">
                    <p className="text-sm font-medium text-surface-300 group-hover:text-surface-200">Ask about these results</p>
                    <p className="text-xs text-cream-400">Chat with AI about the analysis findings</p>
                  </div>
                  <ChevronUp className="w-4 h-4 text-cream-400 group-hover:text-suits-500 transition-colors rotate-180" />
                </button>
              </motion.div>
            )}
          </div>
        )}
      </div>

      {/* ── Chat panel (slides up from bottom, supports fullscreen) ── */}
      <AnimatePresence>
        {chatOpen && phase === 'done' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: chatFullscreen ? '100%' : 340, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: easeOutExpo }}
            className={cn(
              'border-t-2 border-suits-200/50 bg-white flex flex-col overflow-hidden',
              chatFullscreen ? 'absolute inset-0 z-20 border-t-0' : 'shrink-0',
            )}
          >
            {/* Chat header */}
            <div className="shrink-0 px-5 py-2.5 border-b border-cream-200 flex items-center justify-between bg-cream-100/30">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-suits-500" />
                <span className="text-sm font-medium text-surface-200">Ask about results</span>
                {filename && (
                  <span className="text-[10px] text-cream-400 flex items-center gap-1 ml-1">
                    <Paperclip className="w-2.5 h-2.5" />
                    {filename}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {chatMessages.length > 0 && !chatBusy && (
                  <button
                    onClick={handleExportChat}
                    className="p-1 rounded-lg text-cream-400 hover:text-surface-300 hover:bg-cream-100 transition-colors"
                    title="Export chat"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setChatFullscreen(f => !f)}
                  className="p-1 rounded-lg text-cream-400 hover:text-surface-300 hover:bg-cream-100 transition-colors"
                  title={chatFullscreen ? 'Minimize' : 'Fullscreen'}
                >
                  {chatFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => { setChatOpen(false); setChatFullscreen(false) }}
                  className="p-1 rounded-lg text-cream-400 hover:text-surface-300 hover:bg-cream-100 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Chat messages */}
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
              {chatMessages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <p className="text-xs text-cream-400">Ask any question about the {title.toLowerCase()} results...</p>
                </div>
              )}
              {chatMessages.map(msg => (
                <div
                  key={msg.id}
                  className={cn(
                    'flex gap-2.5',
                    chatFullscreen ? 'max-w-3xl mx-auto w-full' : '',
                    msg.role === 'user' ? 'justify-end' : '',
                  )}
                >
                  {msg.role === 'assistant' && (
                    <img src="/images/suits-logo.png" alt="Suits AI" className="w-6 h-6 object-contain shrink-0 mt-0.5" />
                  )}
                  <div className={cn(
                    'max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-surface-200 text-surface-950 rounded-tr-md'
                      : 'bg-cream border border-cream-200 text-surface-300 rounded-tl-md',
                  )}>
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                    {msg.isStreaming && (
                      <span className="inline-block w-[2px] h-[1em] bg-suits-500 ml-0.5 align-middle streaming-cursor" />
                    )}
                  </div>
                </div>
              ))}
              {chatBusy && chatMessages[chatMessages.length - 1]?.role === 'user' && (
                <div className={cn('flex gap-2.5', chatFullscreen && 'max-w-3xl mx-auto w-full')}>
                  <img src="/images/suits-logo.png" alt="Suits AI" className="w-6 h-6 object-contain shrink-0" />
                  <div className="bg-cream border border-cream-200 rounded-2xl rounded-tl-md px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-suits-500 typing-dot" />
                      <div className="w-1.5 h-1.5 rounded-full bg-suits-500 typing-dot" />
                      <div className="w-1.5 h-1.5 rounded-full bg-suits-500 typing-dot" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Chat input */}
            <div className={cn('shrink-0 px-4 py-3 border-t border-cream-200 bg-white', chatFullscreen && 'px-6 py-4')}>
              <div className={cn(
                'flex items-center gap-2 bg-cream border border-cream-200 rounded-xl px-3 py-2 focus-within:border-suits-400/40 transition-colors',
                chatFullscreen && 'max-w-3xl mx-auto',
              )}>
                <textarea
                  ref={chatTextareaRef}
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={handleChatKeyDown}
                  placeholder="Ask a question..."
                  disabled={chatBusy}
                  rows={1}
                  className="flex-1 bg-transparent text-surface-200 placeholder:text-cream-400 text-sm leading-relaxed outline-none resize-none overflow-hidden disabled:opacity-50"
                />
                <motion.button
                  onClick={handleChatSend}
                  disabled={!chatInput.trim() || chatBusy}
                  className={cn(
                    'p-1.5 rounded-lg transition-all shrink-0',
                    chatInput.trim() && !chatBusy
                      ? 'bg-surface-200 text-cream hover:bg-surface-300'
                      : 'bg-cream-200 text-cream-400 cursor-not-allowed',
                  )}
                  whileHover={chatInput.trim() && !chatBusy ? { scale: 1.05 } : {}}
                  whileTap={chatInput.trim() && !chatBusy ? { scale: 0.95 } : {}}
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
