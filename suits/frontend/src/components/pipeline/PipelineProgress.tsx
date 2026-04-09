import { motion } from 'framer-motion'
import {
  FileText,
  Tags,
  BookOpen,
  ShieldAlert,
  GitCompare,
  Briefcase,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
} from 'lucide-react'
import type { AgentState } from '@/hooks/useAnalysis'
import { cn } from '@/lib/utils'
import { formatMs } from '@/lib/utils'
import { easeOutExpo } from '@/lib/motion'

interface PipelineProgressProps {
  agents: Record<string, AgentState>
  agentOrder: string[]
  pipelineStatus: string
  error: string | null
  filename?: string
}

const AGENT_META: Record<string, { label: string; icon: typeof FileText; wave: number }> = {
  ingestor:      { label: 'Document Ingestion',     icon: FileText,    wave: 0 },
  classifier:    { label: 'Clause Classifier',      icon: Tags,        wave: 1 },
  simplifier:    { label: 'Plain Language',          icon: BookOpen,    wave: 1 },
  risk_analyzer: { label: 'Risk Analyzer',           icon: ShieldAlert, wave: 2 },
  benchmark:     { label: 'Benchmark Comparison',    icon: GitCompare,  wave: 2 },
  advisor:       { label: 'Advisory Synthesis',      icon: Briefcase,   wave: 3 },
  verifier:      { label: 'Verification',            icon: ShieldCheck, wave: 3 },
}

const WAVE_LABELS = ['Ingestion', 'Wave 1 — Parallel', 'Wave 2 — Parallel', 'Wave 3 — Sequential']

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'complete':
      return <CheckCircle2 className="w-4 h-4 text-risk-low" />
    case 'error':
      return <XCircle className="w-4 h-4 text-risk-high" />
    case 'running':
      return <Loader2 className="w-4 h-4 text-suits-400 animate-spin" />
    default:
      return <Clock className="w-4 h-4 text-surface-500" />
  }
}

export default function PipelineProgress({
  agents,
  agentOrder,
  pipelineStatus,
  error,
  filename,
}: PipelineProgressProps) {
  const completedCount = Object.values(agents).filter(a => a.status === 'complete').length
  const totalCount = agentOrder.length
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  // Group agents by wave
  const waves: { label: string; agents: string[] }[] = []
  const waveMap = new Map<number, string[]>()
  for (const name of agentOrder) {
    const wave = AGENT_META[name]?.wave ?? 0
    if (!waveMap.has(wave)) waveMap.set(wave, [])
    waveMap.get(wave)!.push(name)
  }
  for (const [waveIdx, agentNames] of waveMap) {
    waves.push({ label: WAVE_LABELS[waveIdx] || `Wave ${waveIdx}`, agents: agentNames })
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center h-screen bg-cream px-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: easeOutExpo }}
        className="w-full max-w-lg"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <motion.div
            className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-surface-100 border border-surface-300/50 flex items-center justify-center"
            animate={pipelineStatus === 'running' ? {
              boxShadow: [
                '0 0 0px rgba(92, 124, 250, 0)',
                '0 0 30px rgba(92, 124, 250, 0.3)',
                '0 0 0px rgba(92, 124, 250, 0)',
              ],
            } : {}}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <ShieldAlert className="w-6 h-6 text-suits-400" />
          </motion.div>
          <h2 className="text-xl font-medium text-surface-200 mb-1">
            {pipelineStatus === 'running' ? 'Analyzing your document' : pipelineStatus === 'complete' ? 'Analysis complete' : 'Analysis failed'}
          </h2>
          {filename && (
            <p className="text-sm text-cream-400 truncate max-w-xs mx-auto">{filename}</p>
          )}
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-xs text-cream-400 mb-2">
            <span>{completedCount} of {totalCount} agents</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 bg-cream-200 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-suits-600 to-suits-400"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: easeOutExpo }}
            />
          </div>
        </div>

        {/* Agent list by wave */}
        <div className="space-y-5">
          {waves.map((wave, waveIdx) => (
            <motion.div
              key={wave.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: waveIdx * 0.1, duration: 0.4 }}
            >
              <p className="text-[11px] font-medium text-cream-400 uppercase tracking-wider mb-2 px-1">
                {wave.label}
              </p>
              <div className="space-y-1.5">
                {wave.agents.map((name) => {
                  const meta = AGENT_META[name]
                  const agent = agents[name]
                  const status = agent?.status || 'idle'
                  const Icon = meta?.icon || FileText

                  return (
                    <motion.div
                      key={name}
                      className={cn(
                        'flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-300',
                        status === 'running'
                          ? 'bg-suits-500/5 border-suits-500/20'
                          : status === 'complete'
                            ? 'bg-risk-low/5 border-risk-low/15'
                            : status === 'error'
                              ? 'bg-risk-high/5 border-risk-high/15'
                              : 'bg-cream border-cream-200',
                      )}
                      layout
                    >
                      <Icon className={cn(
                        'w-4 h-4 shrink-0',
                        status === 'running' ? 'text-suits-400' :
                        status === 'complete' ? 'text-risk-low' :
                        status === 'error' ? 'text-risk-high' :
                        'text-cream-400',
                      )} />
                      <span className={cn(
                        'text-sm flex-1',
                        status === 'idle' ? 'text-cream-400' : 'text-surface-300',
                      )}>
                        {meta?.label || name}
                      </span>
                      <div className="flex items-center gap-2">
                        {agent?.timing_ms != null && status === 'complete' && (
                          <span className="text-xs text-cream-400">{formatMs(agent.timing_ms)}</span>
                        )}
                        <StatusIcon status={status} />
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Error message */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 p-4 rounded-xl bg-risk-high/10 border border-risk-high/20 text-sm text-risk-high"
          >
            {error}
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}
