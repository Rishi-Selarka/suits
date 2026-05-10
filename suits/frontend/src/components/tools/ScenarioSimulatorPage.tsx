import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Clock,
  Coins,
  Compass,
  Download,
  FileText,
  FlaskConical,
  Gavel,
  History,
  Loader2,
  Sparkles,
  Upload,
  XCircle,
} from 'lucide-react'
import { cn, validateUploadFile } from '@/lib/utils'
import { easeOutExpo, staggerContainer, staggerItem } from '@/lib/motion'
import {
  analyzeDocumentSSE,
  downloadScenarioReport,
  getResults,
  listScenarioRuns,
  listScenarioTemplates,
  recordDownload,
  simulateScenarioStream,
  uploadDocument,
  type AnalysisResult,
  type DisputeProbability,
  type ScenarioReport,
  type ScenarioSeverity,
  type ScenarioStreamEvent,
  type ScenarioTemplate,
  type SSEEvent,
} from '@/api/client'

// ── Phases ─────────────────────────────────────────────────────────────────

type Phase =
  | 'empty'
  | 'uploading'
  | 'analyzing'
  | 'ready'        // analysis done, awaiting scenario choice
  | 'simulating'   // scenario streaming
  | 'result'       // showing a completed scenario
  | 'error'

interface AgentProgress {
  status: 'idle' | 'running' | 'complete' | 'error'
  timing_ms?: number
}

const ANALYSIS_AGENTS = ['ingestor', 'classifier', 'simplifier', 'risk_analyzer', 'benchmark', 'advisor', 'verifier']
const ANALYSIS_LABELS: Record<string, string> = {
  ingestor: 'Ingesting document',
  classifier: 'Classifying clauses',
  simplifier: 'Simplifying language',
  risk_analyzer: 'Analyzing risks',
  benchmark: 'Benchmarking terms',
  advisor: 'Synthesizing report',
  verifier: 'Verifying results',
}

// ── Severity / dispute styling ─────────────────────────────────────────────

const SEVERITY_STYLES: Record<ScenarioSeverity, { label: string; bg: string; text: string; ring: string }> = {
  FAVORABLE: { label: 'Favorable', bg: 'bg-green-50', text: 'text-green-700', ring: 'ring-green-200' },
  NEUTRAL: { label: 'Neutral', bg: 'bg-slate-50', text: 'text-slate-700', ring: 'ring-slate-200' },
  UNFAVORABLE: { label: 'Unfavorable', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200' },
  CRITICAL: { label: 'Critical', bg: 'bg-red-50', text: 'text-red-700', ring: 'ring-red-200' },
}

const DISPUTE_STYLES: Record<DisputeProbability, { label: string; bg: string; text: string }> = {
  LOW: { label: 'Low dispute risk', bg: 'bg-green-50', text: 'text-green-700' },
  MEDIUM: { label: 'Medium dispute risk', bg: 'bg-amber-50', text: 'text-amber-700' },
  HIGH: { label: 'High dispute risk', bg: 'bg-red-50', text: 'text-red-700' },
}

const URGENCY_STYLES = {
  LOW: 'bg-slate-100 text-slate-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  HIGH: 'bg-red-100 text-red-700',
}

const PHASE_LABELS = {
  loading: 'Loading clauses...',
  reasoning: 'Tracing scenario through the contract...',
  finalizing: 'Composing the outcome timeline...',
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ScenarioSimulatorPage() {

  const [phase, setPhase] = useState<Phase>('empty')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [filename, setFilename] = useState('')
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [agents, setAgents] = useState<Record<string, AgentProgress>>({})

  const [templates, setTemplates] = useState<ScenarioTemplate[]>([])
  const [detectedType, setDetectedType] = useState('')

  const [customQuery, setCustomQuery] = useState('')
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  const [simulationStage, setSimulationStage] = useState<'loading' | 'reasoning' | 'finalizing'>('loading')

  const [report, setReport] = useState<ScenarioReport | null>(null)
  const [history, setHistory] = useState<ScenarioReport[]>([])
  const [downloadingScenario, setDownloadingScenario] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // ── Upload + analyze flow ────────────────────────────────────────────────

  const runAnalysis = useCallback(async (docId: string) => {
    const initial: Record<string, AgentProgress> = {}
    for (const name of ANALYSIS_AGENTS) initial[name] = { status: 'idle' }
    setAgents(initial)
    setPhase('analyzing')

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
        setAgents(prev => ({
          ...prev,
          [event.agent]: { status: event.status as AgentProgress['status'], timing_ms: event.timing_ms },
        }))
      },
      async () => {
        try {
          const result = await getResults(docId)
          setAnalysisResult(result)
          // Fetch curated templates and any prior scenario runs in parallel.
          const [tplRes, hist] = await Promise.all([
            listScenarioTemplates(docId).catch(() => null),
            listScenarioRuns(docId).catch(() => null),
          ])
          if (tplRes) {
            setTemplates(tplRes.templates)
            setDetectedType(tplRes.detected_document_type)
          }
          if (hist) setHistory(hist.scenarios)
          setPhase('ready')
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
  }, [])

  const handleUpload = useCallback(async (file: File) => {
    setPhase('uploading')
    setFilename(file.name)
    setErrorMsg(null)
    setAnalysisResult(null)
    setReport(null)
    setHistory([])
    setTemplates([])

    try {
      const uploadRes = await uploadDocument(file)
      const docId = uploadRes.document_id
      setDocumentId(docId)

      if (uploadRes.status === 'cached') {
        try {
          const result = await getResults(docId)
          setAnalysisResult(result)
          const [tplRes, hist] = await Promise.all([
            listScenarioTemplates(docId).catch(() => null),
            listScenarioRuns(docId).catch(() => null),
          ])
          if (tplRes) {
            setTemplates(tplRes.templates)
            setDetectedType(tplRes.detected_document_type)
          }
          if (hist) setHistory(hist.scenarios)
          setPhase('ready')
          return
        } catch {
          // duplicate file, not yet analyzed — fall through.
        }
      }

      await runAnalysis(docId)
    } catch (err) {
      setPhase('error')
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed')
    }
  }, [runAnalysis])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const validationErr = validateUploadFile(file)
    if (validationErr) { setErrorMsg(validationErr); return }
    handleUpload(file)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    const validationErr = validateUploadFile(file)
    if (validationErr) { setErrorMsg(validationErr); return }
    handleUpload(file)
  }, [handleUpload])

  // ── Run a scenario ───────────────────────────────────────────────────────

  const runScenario = useCallback((query: string, templateId: string | null) => {
    if (!documentId || !query.trim()) return
    setReport(null)
    setActiveTemplateId(templateId)
    setSimulationStage('loading')
    setPhase('simulating')

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    void simulateScenarioStream(
      documentId,
      query.trim(),
      templateId,
      (evt: ScenarioStreamEvent) => {
        if (evt.type === 'status') {
          setSimulationStage(evt.stage)
        } else if (evt.type === 'report') {
          setReport(evt.report)
          setHistory(prev => [evt.report, ...prev.filter(s => s.scenario_id !== evt.report.scenario_id)])
          setPhase('result')
        }
      },
      (err) => {
        setErrorMsg(err)
        setPhase('error')
      },
      ctrl.signal,
    )
  }, [documentId])

  const handleTemplateClick = useCallback((tpl: ScenarioTemplate) => {
    runScenario(tpl.prompt, tpl.id)
  }, [runScenario])

  const handleCustomSubmit = useCallback(() => {
    if (!customQuery.trim()) return
    runScenario(customQuery, null)
    setCustomQuery('')
  }, [customQuery, runScenario])

  const handleNewScenario = useCallback(() => {
    setReport(null)
    setActiveTemplateId(null)
    setPhase('ready')
  }, [])

  const handleViewHistoryItem = useCallback((scenarioId: string) => {
    const found = history.find(s => s.scenario_id === scenarioId)
    if (!found) return
    setReport(found)
    setActiveTemplateId(found.template_id)
    setPhase('result')
  }, [history])

  const handleReset = useCallback(() => {
    abortRef.current?.abort()
    setPhase('empty')
    setReport(null)
    setHistory([])
    setTemplates([])
    setAnalysisResult(null)
    setDocumentId(null)
    setFilename('')
    setErrorMsg(null)
    setAgents({})
    setActiveTemplateId(null)
    setCustomQuery('')
  }, [])

  // Cleanup on unmount
  useEffect(() => () => abortRef.current?.abort(), [])

  // ── Download scenario PDF ────────────────────────────────────────────────

  const handleDownloadScenario = useCallback(async () => {
    if (!documentId || !report || downloadingScenario) return
    setDownloadingScenario(true)
    try {
      const blob = await downloadScenarioReport(documentId, report.scenario_id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `suits-scenario-${report.scenario_id.slice(0, 8)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      try {
        await recordDownload({
          document_id: documentId,
          filename: filename || 'document',
          export_type: 'scenario_report',
          export_label: 'Scenario Simulation',
        })
      } catch { /* download already succeeded for the user */ }
    } catch {
      // silently ignore
    } finally {
      setDownloadingScenario(false)
    }
  }, [documentId, report, downloadingScenario, filename])

  // ── Computed: clause lookup for triggered cards ──────────────────────────

  const clauseTextById = useMemo(() => {
    const map: Record<number, string> = {}
    for (const c of analysisResult?.clauses || []) map[c.clause_id] = c.text
    return map
  }, [analysisResult])

  const completedAgents = Object.values(agents).filter(a => a.status === 'complete').length

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-cream overflow-hidden relative">
      {/* Header */}
      <div className="shrink-0 px-6 pt-4 pb-3 border-b border-cream-200 bg-white/50">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            {phase !== 'empty' && (
              <button
                onClick={handleReset}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-cream-100 transition-colors"
                title="Start over with a new document"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-9 h-9 rounded-xl bg-suits-500/10 flex items-center justify-center">
              <FlaskConical className="w-[18px] h-[18px] text-suits-600" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-surface-200">Scenario Simulator</h1>
              <p className="text-xs text-cream-400">
                What-if engine — predict outcomes grounded in your actual clauses
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {phase === 'ready' && filename && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 border border-green-200">
                <FileText className="w-3 h-3 text-green-600" />
                <span className="text-xs text-green-700 max-w-[140px] truncate font-medium">{filename}</span>
              </div>
            )}
            {phase === 'result' && report && (
              <button
                onClick={handleDownloadScenario}
                disabled={downloadingScenario}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-200 text-xs text-surface-400 hover:text-surface-200 hover:border-cream-300 transition-colors disabled:opacity-50"
              >
                <Download className={cn('w-3 h-3', downloadingScenario && 'animate-pulse')} />
                <span>{downloadingScenario ? 'Downloading...' : 'Download PDF'}</span>
              </button>
            )}
            {(phase === 'ready' || phase === 'result') && (
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

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {phase === 'empty' && (
          <EmptyDropzone
            fileInputRef={fileInputRef}
            onChange={handleFileChange}
            onDrop={handleDrop}
            errorMsg={errorMsg}
          />
        )}

        {phase === 'uploading' && (
          <div className="flex items-center justify-center min-h-[calc(100vh-140px)] px-6">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-suits-500/10 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-suits-500 animate-spin" />
              </div>
              <p className="text-sm font-medium text-surface-300">Uploading {filename}...</p>
            </motion.div>
          </div>
        )}

        {phase === 'analyzing' && (
          <AnalyzingPanel
            filename={filename}
            agents={agents}
            completed={completedAgents}
            total={ANALYSIS_AGENTS.length}
          />
        )}

        {phase === 'error' && (
          <div className="flex items-center justify-center min-h-[calc(100vh-140px)] px-6">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center max-w-sm">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-red-50 flex items-center justify-center">
                <XCircle className="w-6 h-6 text-red-500" />
              </div>
              <p className="text-sm font-medium text-surface-300 mb-1">Something went wrong</p>
              <p className="text-xs text-cream-400 mb-4">{errorMsg || 'Unknown error'}</p>
              <button
                onClick={handleReset}
                className="px-4 py-2 rounded-xl bg-surface-200 text-white text-sm hover:bg-surface-300 transition-colors"
              >
                Try Again
              </button>
            </motion.div>
          </div>
        )}

        {(phase === 'ready' || phase === 'simulating') && analysisResult && (
          <ChoosePanel
            templates={templates}
            detectedType={detectedType}
            customQuery={customQuery}
            setCustomQuery={setCustomQuery}
            onTemplateClick={handleTemplateClick}
            onCustomSubmit={handleCustomSubmit}
            simulating={phase === 'simulating'}
            stage={simulationStage}
            activeTemplateId={activeTemplateId}
            history={history}
            onViewHistory={handleViewHistoryItem}
          />
        )}

        {phase === 'result' && report && (
          <ResultPanel
            report={report}
            clauseTextById={clauseTextById}
            onNewScenario={handleNewScenario}
          />
        )}
      </div>
    </div>
  )
}

// ── Empty / dropzone ───────────────────────────────────────────────────────

function EmptyDropzone({
  fileInputRef,
  onChange,
  onDrop,
  errorMsg,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDrop: (e: React.DragEvent) => void
  errorMsg: string | null
}) {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-140px)] px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: easeOutExpo }}
        className="w-full max-w-lg"
      >
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-suits-500/10 flex items-center justify-center">
            <FlaskConical className="w-6 h-6 text-suits-600" />
          </div>
          <h2 className="text-xl font-semibold text-surface-200 mb-2">What if...?</h2>
          <p className="text-sm text-cream-400 max-w-md mx-auto">
            Upload a contract and ask any hypothetical — "what if I terminate
            after 6 months?", "what if rent is paid 30 days late?". The
            simulator traces it through your actual clauses and predicts
            the outcome with timeline, costs, and Indian-law citations.
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.txt"
          className="hidden"
          onChange={onChange}
        />
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
          className="group cursor-pointer border-2 border-dashed border-cream-300 hover:border-suits-400 rounded-2xl p-10 text-center transition-all duration-300 hover:bg-suits-500/[0.02] hover:shadow-sm"
        >
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-cream-100 group-hover:bg-suits-500/10 flex items-center justify-center transition-colors duration-300">
            <Upload className="w-6 h-6 text-cream-400 group-hover:text-suits-500 transition-colors duration-300" />
          </div>
          <p className="text-sm font-medium text-surface-300 mb-1">
            Drop a document or click to upload
          </p>
          <p className="text-xs text-cream-400">PDF, PNG, JPG, or TXT (up to 20 MB)</p>
        </div>

        {errorMsg && (
          <p className="text-center text-xs text-red-500 mt-4">{errorMsg}</p>
        )}
      </motion.div>
    </div>
  )
}

// ── Analyzing pipeline ─────────────────────────────────────────────────────

function AnalyzingPanel({
  filename,
  agents,
  completed,
  total,
}: {
  filename: string
  agents: Record<string, AgentProgress>
  completed: number
  total: number
}) {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-140px)] px-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
        <div className="text-center mb-6">
          <p className="text-sm font-medium text-surface-300 mb-1">Analyzing {filename}</p>
          <p className="text-xs text-cream-400">{completed}/{total} stages complete</p>
        </div>
        <div className="h-1.5 rounded-full bg-cream-200 overflow-hidden mb-6">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-suits-500 to-suits-600"
            animate={{ width: `${(completed / total) * 100}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>
        <div className="space-y-1.5">
          {ANALYSIS_AGENTS.map(name => {
            const agent = agents[name]
            if (!agent) return null
            const isActive = agent.status === 'running'
            const isDone = agent.status === 'complete'
            const isFailed = agent.status === 'error'
            return (
              <div
                key={name}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-300',
                  isActive && 'bg-suits-500/5 border border-suits-200',
                  isDone && 'opacity-60',
                  !isActive && !isDone && !isFailed && 'opacity-30',
                )}
              >
                <div className="w-5 h-5 flex items-center justify-center shrink-0">
                  {isActive && <Loader2 className="w-4 h-4 text-suits-500 animate-spin" />}
                  {isDone && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                  {isFailed && <XCircle className="w-4 h-4 text-red-500" />}
                  {agent.status === 'idle' && <div className="w-2 h-2 rounded-full bg-cream-300" />}
                </div>
                <span className={cn('text-xs flex-1', isActive ? 'text-surface-200 font-medium' : 'text-surface-400')}>
                  {ANALYSIS_LABELS[name] || name}
                </span>
                {isDone && agent.timing_ms && (
                  <span className="text-[10px] text-cream-400">{(agent.timing_ms / 1000).toFixed(1)}s</span>
                )}
              </div>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}

// ── Choose / templates panel ───────────────────────────────────────────────

function ChoosePanel({
  templates,
  detectedType,
  customQuery,
  setCustomQuery,
  onTemplateClick,
  onCustomSubmit,
  simulating,
  stage,
  activeTemplateId,
  history,
  onViewHistory,
}: {
  templates: ScenarioTemplate[]
  detectedType: string
  customQuery: string
  setCustomQuery: (v: string) => void
  onTemplateClick: (tpl: ScenarioTemplate) => void
  onCustomSubmit: () => void
  simulating: boolean
  stage: 'loading' | 'reasoning' | 'finalizing'
  activeTemplateId: string | null
  history: ScenarioReport[]
  onViewHistory: (scenarioId: string) => void
}) {
  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {detectedType && (
        <p className="text-xs text-cream-400 mb-4 flex items-center gap-1.5">
          <Compass className="w-3 h-3" />
          Detected document type: <span className="font-medium text-surface-300">{detectedType}</span>
        </p>
      )}

      <h2 className="text-xl font-semibold text-surface-200 mb-1">Run a what-if scenario</h2>
      <p className="text-sm text-cream-400 mb-6 max-w-2xl">
        Pick a template tuned to this document type, or write your own
        hypothetical. Each run traces the scenario through your actual
        clauses and predicts the realistic outcome.
      </p>

      {/* Custom query box */}
      <div className="mb-8">
        <label className="block text-xs font-medium text-cream-400 uppercase tracking-wider mb-2">
          Your scenario
        </label>
        <div className="flex items-end gap-2 bg-white border border-cream-200 rounded-2xl px-4 py-3 focus-within:border-suits-400/40 transition-colors shadow-sm">
          <textarea
            value={customQuery}
            onChange={e => setCustomQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onCustomSubmit()
              }
            }}
            placeholder='e.g. "What if I terminate after 6 months?"'
            disabled={simulating}
            rows={2}
            className="flex-1 bg-transparent text-surface-200 placeholder:text-cream-400 text-sm leading-relaxed outline-none resize-none disabled:opacity-50"
          />
          <motion.button
            onClick={onCustomSubmit}
            disabled={!customQuery.trim() || simulating}
            className={cn(
              'p-2 rounded-xl transition-all shrink-0',
              customQuery.trim() && !simulating
                ? 'bg-suits-500 text-white hover:bg-suits-600'
                : 'bg-cream-200 text-cream-400 cursor-not-allowed',
            )}
            whileHover={customQuery.trim() && !simulating ? { scale: 1.05 } : {}}
            whileTap={customQuery.trim() && !simulating ? { scale: 0.95 } : {}}
            title="Run scenario"
          >
            <ArrowUp className="w-4 h-4" />
          </motion.button>
        </div>
      </div>

      {/* Template grid */}
      <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-3">
        Suggested scenarios
      </p>
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8"
      >
        {templates.map(tpl => {
          const isActive = simulating && activeTemplateId === tpl.id
          return (
            <motion.button
              key={tpl.id}
              variants={staggerItem}
              onClick={() => !simulating && onTemplateClick(tpl)}
              disabled={simulating}
              className={cn(
                'text-left p-4 rounded-2xl border transition-all',
                isActive
                  ? 'bg-suits-500/5 border-suits-300 ring-2 ring-suits-200'
                  : 'bg-white border-cream-200 hover:border-suits-300 hover:shadow-sm',
                simulating && !isActive && 'opacity-50 cursor-not-allowed',
              )}
              whileHover={!simulating ? { y: -2 } : {}}
            >
              <div className="flex items-start gap-2 mb-1">
                <Sparkles className={cn(
                  'w-4 h-4 mt-0.5 shrink-0',
                  tpl.severity_hint === 'CRITICAL' || tpl.severity_hint === 'UNFAVORABLE'
                    ? 'text-amber-500'
                    : 'text-suits-500',
                )} />
                <p className="text-sm font-medium text-surface-200 leading-tight">{tpl.title}</p>
              </div>
              <p className="text-xs text-cream-400 line-clamp-2">{tpl.prompt}</p>
              {isActive && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-suits-600">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>{PHASE_LABELS[stage]}</span>
                </div>
              )}
            </motion.button>
          )
        })}
      </motion.div>

      {/* In-progress banner for custom queries */}
      {simulating && !activeTemplateId && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 flex items-center gap-3 p-4 rounded-2xl border border-suits-200 bg-suits-500/5"
        >
          <Loader2 className="w-4 h-4 text-suits-500 animate-spin shrink-0" />
          <div>
            <p className="text-sm font-medium text-surface-200">Simulating your scenario...</p>
            <p className="text-xs text-cream-400">{PHASE_LABELS[stage]}</p>
          </div>
        </motion.div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div>
          <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <History className="w-3 h-3" /> Recent runs
          </p>
          <div className="space-y-2">
            {history.slice(0, 6).map(h => {
              const sev = SEVERITY_STYLES[h.outcome_severity]
              return (
                <button
                  key={h.scenario_id}
                  onClick={() => onViewHistory(h.scenario_id)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-white border border-cream-200 hover:border-suits-300 transition-colors text-left"
                >
                  <span className={cn('px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide ring-1', sev.bg, sev.text, sev.ring)}>
                    {sev.label}
                  </span>
                  <span className="flex-1 min-w-0 text-sm text-surface-300 truncate">
                    {h.scenario_summary || h.user_query}
                  </span>
                  <span className="text-[10px] text-cream-400 shrink-0">
                    {new Date(h.created_at).toLocaleDateString()}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Result panel ───────────────────────────────────────────────────────────

function ResultPanel({
  report,
  clauseTextById,
  onNewScenario,
}: {
  report: ScenarioReport
  clauseTextById: Record<number, string>
  onNewScenario: () => void
}) {
  const sev = SEVERITY_STYLES[report.outcome_severity]
  const dispute = DISPUTE_STYLES[report.dispute_probability]
  const fi = report.estimated_financial_impact

  const mitigationsByPhase = useMemo(() => {
    const grouped: Record<'BEFORE' | 'DURING' | 'AFTER', ScenarioReport['mitigation_steps']> = {
      BEFORE: [], DURING: [], AFTER: [],
    }
    for (const m of report.mitigation_steps) {
      grouped[m.phase].push(m)
    }
    return grouped
  }, [report])

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-1">
        <span className={cn(
          'px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide ring-1',
          sev.bg, sev.text, sev.ring,
        )}>
          {sev.label}
        </span>
        <span className={cn('px-2.5 py-1 rounded-md text-[11px] font-medium', dispute.bg, dispute.text)}>
          {dispute.label}
        </span>
      </div>
      <h2 className="text-xl font-semibold text-surface-200 mt-2 mb-1">
        {report.scenario_summary || report.user_query}
      </h2>
      {report.user_query !== report.scenario_summary && (
        <p className="text-xs text-cream-400 italic mb-4">"{report.user_query}"</p>
      )}

      {/* Headline outcome card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="bg-white rounded-2xl border border-cream-200 p-5 mb-6"
      >
        <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-2">Predicted outcome</p>
        <p className="text-sm text-surface-200 leading-relaxed">{report.headline_outcome}</p>
        {report.dispute_probability_reasoning && (
          <div className="mt-3 pt-3 border-t border-cream-200">
            <p className="text-[10px] uppercase tracking-wider text-cream-400 mb-1">Why this dispute risk</p>
            <p className="text-xs text-surface-400 leading-relaxed">{report.dispute_probability_reasoning}</p>
          </div>
        )}
      </motion.div>

      {/* Two-up: Financial + Envelope */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-cream-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Coins className="w-4 h-4 text-suits-500" />
            <p className="text-xs font-medium text-cream-400 uppercase tracking-wider">Financial impact</p>
          </div>
          <p className="text-2xl font-semibold text-surface-200">{fi.amount_range_inr || '—'}</p>
          <p className="text-[11px] text-cream-400 mt-1">User position: {fi.user_perspective.replace('_', ' ').toLowerCase()}</p>
          {fi.calculation_basis && (
            <p className="text-xs text-surface-400 mt-3 leading-relaxed">{fi.calculation_basis}</p>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-cream-200 p-5">
          <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-3">Outcome envelope</p>
          {report.best_case && (
            <div className="mb-2">
              <p className="text-[10px] uppercase tracking-wider text-green-700 mb-0.5">Best case</p>
              <p className="text-xs text-surface-300">{report.best_case}</p>
            </div>
          )}
          {report.worst_case && (
            <div className="mb-2">
              <p className="text-[10px] uppercase tracking-wider text-red-700 mb-0.5">Worst case</p>
              <p className="text-xs text-surface-300">{report.worst_case}</p>
            </div>
          )}
          {report.user_leverage && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-suits-600 mb-0.5">Your leverage</p>
              <p className="text-xs text-surface-300">{report.user_leverage}</p>
            </div>
          )}
        </div>
      </div>

      {/* Timeline */}
      {report.timeline.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Clock className="w-3 h-3" /> Outcome timeline
          </p>
          <div className="bg-white rounded-2xl border border-cream-200 p-5">
            <div className="relative">
              <div className="absolute left-[15px] top-2 bottom-2 w-px bg-cream-200" />
              {report.timeline.map((step, i) => (
                <motion.div
                  key={step.step}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="relative flex items-start gap-4 pb-4 last:pb-0"
                >
                  <div className="w-8 h-8 rounded-full bg-suits-500/10 flex items-center justify-center shrink-0 ring-4 ring-cream relative z-10">
                    <span className="text-xs font-semibold text-suits-600">{step.step}</span>
                  </div>
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-xs font-semibold text-surface-200">{step.when}</p>
                      {step.triggered_clause_ids.map(cid => (
                        <span key={cid} className="px-1.5 py-0.5 rounded-md bg-cream-100 text-[10px] font-medium text-suits-600">
                          C{cid}
                        </span>
                      ))}
                    </div>
                    <p className="text-sm text-surface-300 leading-relaxed">{step.event}</p>
                    {step.consequence && (
                      <p className="text-xs text-amber-700 mt-1 italic">→ {step.consequence}</p>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Triggered clauses */}
      {report.triggered_clauses.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <FileText className="w-3 h-3" /> Triggered clauses
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {report.triggered_clauses.map(tc => (
              <div key={tc.clause_id} className="bg-white rounded-2xl border border-cream-200 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-suits-600 bg-suits-500/10 px-2 py-0.5 rounded-md">
                    C{tc.clause_id}
                  </span>
                  <p className="text-sm font-medium text-surface-200 truncate">{tc.title}</p>
                </div>
                {tc.why_relevant && (
                  <p className="text-xs text-cream-400 mb-2">{tc.why_relevant}</p>
                )}
                {tc.key_quote && (
                  <p className="text-xs italic text-surface-400 border-l-2 border-suits-300 pl-2 leading-relaxed">
                    "{tc.key_quote}"
                  </p>
                )}
                {!tc.key_quote && clauseTextById[tc.clause_id] && (
                  <p className="text-xs italic text-surface-400 border-l-2 border-cream-300 pl-2 leading-relaxed line-clamp-3">
                    "{clauseTextById[tc.clause_id]}"
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mitigations */}
      {report.mitigation_steps.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-3">Mitigation steps</p>
          <div className="space-y-3">
            {(['BEFORE', 'DURING', 'AFTER'] as const).map(phase => {
              const steps = mitigationsByPhase[phase]
              if (steps.length === 0) return null
              const phaseTitle = phase === 'BEFORE'
                ? 'Before the scenario unfolds'
                : phase === 'DURING'
                  ? "While it's happening"
                  : 'After the fact'
              return (
                <div key={phase} className="bg-white rounded-2xl border border-cream-200 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-suits-600 mb-2">
                    {phaseTitle}
                  </p>
                  <div className="space-y-2">
                    {steps.map((m, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <span className={cn(
                          'px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide shrink-0 mt-0.5',
                          URGENCY_STYLES[m.urgency],
                        )}>
                          {m.urgency}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-surface-200 leading-snug">{m.action}</p>
                          {m.rationale && (
                            <p className="text-xs text-cream-400 mt-0.5 leading-relaxed">{m.rationale}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Citations */}
      {report.legal_citations.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Gavel className="w-3 h-3" /> Relevant legal citations
          </p>
          <div className="space-y-2">
            {report.legal_citations.map((c, i) => (
              <div key={i} className="bg-white rounded-2xl border border-cream-200 p-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-suits-500/10 flex items-center justify-center shrink-0">
                  <Gavel className="w-4 h-4 text-suits-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-surface-200">
                    {c.law}{c.section && <span className="text-cream-400 font-normal"> · {c.section}</span>}
                  </p>
                  {c.relevance && (
                    <p className="text-xs text-surface-400 mt-0.5 leading-relaxed">{c.relevance}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-cream-200">
        <p className="text-[11px] text-cream-400">
          Run in {(report.timing_ms / 1000).toFixed(1)}s · {report.model_used.split('/').pop()}
        </p>
        <button
          onClick={onNewScenario}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-suits-500 text-white text-xs hover:bg-suits-600 transition-colors"
        >
          <FlaskConical className="w-3 h-3" />
          <span>Run another scenario</span>
        </button>
      </div>

      <AnimatePresence>{/* placeholder for future toasts */}</AnimatePresence>
    </div>
  )
}
