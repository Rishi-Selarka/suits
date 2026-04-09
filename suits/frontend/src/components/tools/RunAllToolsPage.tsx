import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Layers,
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  ArrowUp,
  Download,
  MessageSquare,
  Paperclip,
  X,
  Maximize2,
  Minimize2,
  Shield,
  Eye,
  AlertTriangle,
  Timer,
  Calendar,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { easeOutExpo } from '@/lib/motion'
import { useUser } from '@/context/UserContext'
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

import { RiskScoreContent } from './RiskScorePage'
import { TrapDetectorContent, findTraps } from './TrapDetectorPage'
import { WhatCouldGoWrongContent } from './WhatCouldGoWrongPage'
import { TimebombContent, findTimebombs } from './TimebombPage'
import { DeadlineTrackerContent, extractDeadlines } from './DeadlineTrackerPage'

// ── Types ──

type Phase = 'empty' | 'uploading' | 'analyzing' | 'done' | 'error'

interface AgentProgress {
  name: string
  status: 'idle' | 'running' | 'complete' | 'error'
  timing_ms?: number
}

interface ChatMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
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

const TABS = [
  { id: 'risk-score', label: 'Risk Score', icon: Shield },
  { id: 'traps', label: 'Trap Clauses', icon: Eye },
  { id: 'issues', label: 'What Could Go Wrong', icon: AlertTriangle },
  { id: 'timebombs', label: 'Timebombs', icon: Timer },
  { id: 'deadlines', label: 'Deadlines', icon: Calendar },
] as const

// ── Component ──

interface RunAllToolsPageProps {
  preloadResult?: AnalysisResult | null
  preloadDocumentId?: string
  preloadFilename?: string
}

export default function RunAllToolsPage({ preloadResult, preloadDocumentId, preloadFilename }: RunAllToolsPageProps) {
  const [phase, setPhase] = useState<Phase>('empty')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [filename, setFilename] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [agents, setAgents] = useState<Record<string, AgentProgress>>({})
  const [currentAgent, setCurrentAgent] = useState('')
  const [activeTab, setActiveTab] = useState<string>('risk-score')
  const [downloading, setDownloading] = useState(false)
  const { addDownload } = useUser()

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
  const lastPreloadIdRef = useRef<string | null>(null)

  // ── Preload result when navigating from ResultsDashboard ──
  useEffect(() => {
    if (preloadResult && preloadResult.document_id !== lastPreloadIdRef.current) {
      lastPreloadIdRef.current = preloadResult.document_id
      setResult(preloadResult)
      setDocumentId(preloadResult.document_id)
      setFilename(preloadFilename || '')
      setPhase('done')
      setActiveTab('risk-score')
      setChatMessages([])
      setChatOpen(false)
      setChatFullscreen(false)
    }
  }, [preloadResult, preloadFilename])

  // Auto-scroll
  useEffect(() => {
    if (phase === 'done' && scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [phase])

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [chatMessages])

  useEffect(() => {
    const ta = chatTextareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 100)}px`
    }
  }, [chatInput])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // ── Upload & Analyze ──
  const handleUpload = useCallback(async (file: File) => {
    setPhase('uploading')
    setFilename(file.name)
    setErrorMsg(null)
    setResult(null)
    setChatMessages([])
    setChatOpen(false)
    setActiveTab('risk-score')

    try {
      const uploadRes = await uploadDocument(file)
      const docId = uploadRes.document_id
      setDocumentId(docId)

      if (uploadRes.status === 'cached') {
        try {
          const fullResult = await getResults(docId)
          setResult(fullResult)
          lastPreloadIdRef.current = fullResult.document_id
          setPhase('done')
          return
        } catch { /* fall through to analysis */ }
      }

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
            if (event.status === 'error') {
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
            lastPreloadIdRef.current = fullResult.document_id
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
    setActiveTab('risk-score')
    setChatMessages([])
    setChatOpen(false)
    setChatFullscreen(false)
    lastPreloadIdRef.current = null
  }

  // ── Download ──
  const handleDownloadPDF = useCallback(async () => {
    if (!documentId || downloading) return
    setDownloading(true)
    try {
      const blob = await downloadReport(documentId, 'full_bundle')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `suits-full-analysis-${documentId.slice(0, 8)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      addDownload({
        id: crypto.randomUUID(),
        documentId,
        filename: filename || 'document',
        exportType: 'full_bundle',
        exportLabel: 'Full Analysis Bundle',
        downloadedAt: Date.now(),
      })
    } catch { /* silent */ } finally {
      setDownloading(false)
    }
  }, [documentId, downloading, filename, addDownload])

  // ── Chat ──
  const flushChatTokens = useCallback(() => {
    const msgId = streamIdRef.current
    if (!msgId || !tokenBufRef.current) return
    const chunk = tokenBufRef.current
    tokenBufRef.current = ''
    setChatMessages(prev =>
      prev.map(m => m.id === msgId ? { ...m, content: m.content + chunk } : m),
    )
  }, [])

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

  // ── Computed stats ──
  const stats = result ? {
    riskScore: result.advisory?.overall_risk_assessment?.score ?? 0,
    riskLevel: result.advisory?.overall_risk_assessment?.level || 'N/A',
    verdict: result.advisory?.overall_risk_assessment?.verdict || 'N/A',
    verdictReasoning: result.advisory?.overall_risk_assessment?.verdict_reasoning || '',
    traps: findTraps(result).length,
    criticalIssues: result.advisory?.critical_issues?.length || 0,
    missingClauses: result.advisory?.missing_clauses?.length || 0,
    redFlags: result.risks?.filter(r => r.risk_level === 'RED').length || 0,
    timebombs: findTimebombs(result).length,
    deadlines: extractDeadlines(result).length,
  } : null

  const completedAgents = Object.values(agents).filter(a => a.status === 'complete').length
  const totalAgents = AGENT_ORDER.length

  const scoreColor = stats
    ? stats.riskScore <= 3 ? 'text-green-600' : stats.riskScore <= 6 ? 'text-amber-600' : 'text-red-600'
    : ''
  const strokeColor = stats
    ? stats.riskScore <= 3 ? '#22c55e' : stats.riskScore <= 6 ? '#f59e0b' : '#ef4444'
    : '#ccc'
  const ringCircumference = 2 * Math.PI * 20
  const ringOffset = stats ? ringCircumference - (stats.riskScore / 10) * ringCircumference : ringCircumference

  return (
    <div className="flex flex-col h-screen bg-cream overflow-hidden relative">
      {/* ── Header ── */}
      <div className="shrink-0 px-6 pt-4 pb-3 border-b border-cream-200 bg-white/50">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            {phase !== 'empty' && (
              <button
                onClick={handleReset}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-cream-100 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-suits-500/20 to-suits-600/10 flex items-center justify-center">
              <Layers className="w-[18px] h-[18px] text-suits-600" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-surface-200">Full Analysis</h1>
              <p className="text-xs text-cream-400">All 5 tools — one document</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {phase === 'done' && filename && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 border border-green-200">
                <FileText className="w-3 h-3 text-green-600" />
                <span className="text-xs text-green-700 max-w-[140px] truncate font-medium">{filename}</span>
              </div>
            )}
            {phase === 'done' && (
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
        {/* ── Upload UI ── */}
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
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                className="group cursor-pointer border-2 border-dashed border-cream-300 hover:border-suits-400 rounded-2xl p-10 text-center transition-all duration-300 hover:bg-suits-500/[0.02] hover:shadow-sm"
              >
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-cream-100 group-hover:bg-suits-500/10 flex items-center justify-center transition-colors duration-300">
                  <Layers className="w-6 h-6 text-cream-400 group-hover:text-suits-500 transition-colors duration-300" />
                </div>
                <p className="text-sm font-medium text-surface-300 mb-1">
                  Drop a document here or click to upload
                </p>
                <p className="text-xs text-cream-400">
                  PDF, PNG, JPG, or TXT — up to 20 MB
                </p>
              </div>

              {/* Tool icons row */}
              <div className="mt-6 flex items-center gap-3 justify-center">
                {TABS.map(tab => (
                  <div key={tab.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-cream-200">
                    <tab.icon className="w-3.5 h-3.5 text-suits-500" />
                    <span className="text-[10px] font-medium text-surface-400">{tab.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-center text-xs text-cream-400 mt-4">
                All 5 analysis tools will run simultaneously on your document.
              </p>
            </motion.div>
          </div>
        )}

        {/* ── Uploading ── */}
        {phase === 'uploading' && (
          <div className="flex items-center justify-center min-h-[calc(100vh-140px)] px-6">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-suits-500/10 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-suits-500 animate-spin" />
              </div>
              <p className="text-sm font-medium text-surface-300">Uploading {filename}...</p>
              <p className="text-xs text-cream-400 mt-1">Preparing for full analysis</p>
            </motion.div>
          </div>
        )}

        {/* ── Analyzing (pipeline progress) ── */}
        {phase === 'analyzing' && (
          <div className="flex items-center justify-center min-h-[calc(100vh-140px)] px-6">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
              <div className="text-center mb-6">
                <p className="text-sm font-medium text-surface-300 mb-1">Analyzing {filename}</p>
                <p className="text-xs text-cream-400">{completedAgents}/{totalAgents} stages complete</p>
              </div>
              <div className="h-1.5 rounded-full bg-cream-200 overflow-hidden mb-6">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-suits-500 to-suits-600"
                  animate={{ width: `${(completedAgents / totalAgents) * 100}%` }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                />
              </div>
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
                      <span className={cn('text-xs flex-1', isActive ? 'text-surface-200 font-medium' : 'text-surface-400')}>
                        {AGENT_LABELS[name] || name}
                      </span>
                      {isDone && agent.timing_ms && (
                        <span className="text-[10px] text-cream-400">{(agent.timing_ms / 1000).toFixed(1)}s</span>
                      )}
                    </motion.div>
                  )
                })}
              </div>
              {currentAgent && (
                <motion.p key={currentAgent} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-xs text-suits-500 mt-4 font-medium">
                  {AGENT_LABELS[currentAgent] || currentAgent}...
                </motion.p>
              )}
            </motion.div>
          </div>
        )}

        {/* ── Error ── */}
        {phase === 'error' && (
          <div className="flex items-center justify-center min-h-[calc(100vh-140px)] px-6">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center max-w-sm">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-red-50 flex items-center justify-center">
                <XCircle className="w-6 h-6 text-red-500" />
              </div>
              <p className="text-sm font-medium text-surface-300 mb-1">Analysis Failed</p>
              <p className="text-xs text-cream-400 mb-4">{errorMsg || 'Something went wrong'}</p>
              <button onClick={handleReset} className="px-4 py-2 rounded-xl bg-surface-200 text-white text-sm hover:bg-surface-300 transition-colors">
                Try Again
              </button>
            </motion.div>
          </div>
        )}

        {/* ── Results Dashboard ── */}
        {phase === 'done' && result && stats && (
          <div className="max-w-7xl mx-auto px-6 py-6">
            {/* ── Summary Cards Row ── */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: easeOutExpo }}
              className="grid grid-cols-5 gap-3 mb-6"
            >
              {/* Risk Score */}
              <button
                onClick={() => setActiveTab('risk-score')}
                className={cn(
                  'text-left p-4 rounded-2xl border transition-all duration-200',
                  activeTab === 'risk-score'
                    ? 'border-suits-400 bg-white shadow-md ring-1 ring-suits-200'
                    : 'border-cream-200 bg-white hover:border-cream-300 hover:shadow-sm',
                )}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-4 h-4 text-suits-500" />
                  <span className="text-[10px] font-medium text-cream-400 uppercase tracking-wider">Risk Score</span>
                </div>
                <div className="flex items-center gap-3">
                  {/* Mini ring */}
                  <div className="relative w-12 h-12 shrink-0">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 48 48">
                      <circle cx="24" cy="24" r="20" fill="none" stroke="#ECEAE4" strokeWidth="3" />
                      <motion.circle
                        cx="24" cy="24" r="20" fill="none" stroke={strokeColor} strokeWidth="3"
                        strokeLinecap="round" strokeDasharray={ringCircumference}
                        initial={{ strokeDashoffset: ringCircumference }}
                        animate={{ strokeDashoffset: ringOffset }}
                        transition={{ duration: 1.2, ease: 'easeOut' }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={cn('text-sm font-bold', scoreColor)}>{stats.riskScore.toFixed(1)}</span>
                    </div>
                  </div>
                  <div>
                    <span className={cn(
                      'text-[10px] font-semibold px-2 py-0.5 rounded-full inline-block',
                      stats.verdict === 'SIGN' ? 'bg-green-50 text-green-700' :
                      stats.verdict === 'NEGOTIATE' ? 'bg-amber-50 text-amber-700' :
                      'bg-red-50 text-red-700',
                    )}>
                      {stats.verdict}
                    </span>
                  </div>
                </div>
              </button>

              {/* Trap Clauses */}
              <button
                onClick={() => setActiveTab('traps')}
                className={cn(
                  'text-left p-4 rounded-2xl border transition-all duration-200',
                  activeTab === 'traps'
                    ? 'border-red-400 bg-white shadow-md ring-1 ring-red-200'
                    : 'border-cream-200 bg-white hover:border-cream-300 hover:shadow-sm',
                )}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Eye className="w-4 h-4 text-red-500" />
                  <span className="text-[10px] font-medium text-cream-400 uppercase tracking-wider">Traps</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className={cn('text-2xl font-bold', stats.traps > 0 ? 'text-red-600' : 'text-green-600')}>{stats.traps}</span>
                  <span className="text-xs text-cream-400">found</span>
                </div>
                <p className={cn('text-[10px] mt-1', stats.traps > 0 ? 'text-red-500' : 'text-green-500')}>
                  {stats.traps > 0 ? 'Attention needed' : 'All clear'}
                </p>
              </button>

              {/* Critical Issues */}
              <button
                onClick={() => setActiveTab('issues')}
                className={cn(
                  'text-left p-4 rounded-2xl border transition-all duration-200',
                  activeTab === 'issues'
                    ? 'border-amber-400 bg-white shadow-md ring-1 ring-amber-200'
                    : 'border-cream-200 bg-white hover:border-cream-300 hover:shadow-sm',
                )}
              >
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <span className="text-[10px] font-medium text-cream-400 uppercase tracking-wider">Issues</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className={cn('text-2xl font-bold', stats.criticalIssues > 0 ? 'text-amber-600' : 'text-green-600')}>{stats.criticalIssues}</span>
                  <span className="text-xs text-cream-400">critical</span>
                </div>
                {stats.missingClauses > 0 && (
                  <p className="text-[10px] text-amber-500 mt-1">+ {stats.missingClauses} missing</p>
                )}
              </button>

              {/* Timebombs */}
              <button
                onClick={() => setActiveTab('timebombs')}
                className={cn(
                  'text-left p-4 rounded-2xl border transition-all duration-200',
                  activeTab === 'timebombs'
                    ? 'border-orange-400 bg-white shadow-md ring-1 ring-orange-200'
                    : 'border-cream-200 bg-white hover:border-cream-300 hover:shadow-sm',
                )}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Timer className="w-4 h-4 text-orange-500" />
                  <span className="text-[10px] font-medium text-cream-400 uppercase tracking-wider">Timebombs</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className={cn('text-2xl font-bold', stats.timebombs > 0 ? 'text-orange-600' : 'text-green-600')}>{stats.timebombs}</span>
                  <span className="text-xs text-cream-400">found</span>
                </div>
                <p className={cn('text-[10px] mt-1', stats.timebombs > 0 ? 'text-orange-500' : 'text-green-500')}>
                  {stats.timebombs > 0 ? 'Time triggers' : 'None detected'}
                </p>
              </button>

              {/* Deadlines */}
              <button
                onClick={() => setActiveTab('deadlines')}
                className={cn(
                  'text-left p-4 rounded-2xl border transition-all duration-200',
                  activeTab === 'deadlines'
                    ? 'border-purple-400 bg-white shadow-md ring-1 ring-purple-200'
                    : 'border-cream-200 bg-white hover:border-cream-300 hover:shadow-sm',
                )}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="w-4 h-4 text-purple-500" />
                  <span className="text-[10px] font-medium text-cream-400 uppercase tracking-wider">Deadlines</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-purple-600">{stats.deadlines}</span>
                  <span className="text-xs text-cream-400">dates</span>
                </div>
                <p className="text-[10px] text-purple-500 mt-1">
                  {stats.deadlines > 0 ? 'Time references' : 'No dates found'}
                </p>
              </button>
            </motion.div>

            {/* ── Tab Content Card ── */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.4 }}
              className="bg-white rounded-2xl border border-cream-200 overflow-hidden"
            >
              {/* Tab bar */}
              <div className="flex items-center gap-1 px-4 pt-4 pb-3 border-b border-cream-200 overflow-x-auto">
                {TABS.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap',
                      activeTab === tab.id
                        ? 'bg-suits-500/10 text-suits-700'
                        : 'text-cream-400 hover:text-surface-300 hover:bg-cream-100',
                    )}
                  >
                    <tab.icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Active tool content */}
              <div className="p-6">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                  >
                    {activeTab === 'risk-score' && <RiskScoreContent result={result} />}
                    {activeTab === 'traps' && <TrapDetectorContent result={result} />}
                    {activeTab === 'issues' && <WhatCouldGoWrongContent result={result} />}
                    {activeTab === 'timebombs' && <TimebombContent result={result} />}
                    {activeTab === 'deadlines' && <DeadlineTrackerContent result={result} />}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>

            {/* Ask a question prompt */}
            {!chatOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.4 }}
                className="mt-6 mb-4"
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
                    <p className="text-xs text-cream-400">Chat with AI about the full analysis</p>
                  </div>
                </button>
              </motion.div>
            )}
          </div>
        )}
      </div>

      {/* ── Chat Panel ── */}
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
                <button
                  onClick={() => setChatFullscreen(f => !f)}
                  className="p-1 rounded-lg text-cream-400 hover:text-surface-300 hover:bg-cream-100 transition-colors"
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

            <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
              {chatMessages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <p className="text-xs text-cream-400">Ask any question about the full analysis results...</p>
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
