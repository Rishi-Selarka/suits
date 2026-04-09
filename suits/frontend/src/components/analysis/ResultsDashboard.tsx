import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Download,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  FileWarning,
  Lightbulb,
  ExternalLink,
  ArrowLeft,
} from 'lucide-react'
import type { AnalysisResult } from '@/api/client'
import { downloadReport } from '@/api/client'
import { useUser } from '@/context/UserContext'
import { cn } from '@/lib/utils'
import { formatMs, riskColor, riskBg, riskLabel } from '@/lib/utils'
import { easeOutExpo, staggerContainer, staggerItem } from '@/lib/motion'

interface ResultsDashboardProps {
  result: AnalysisResult
  filename?: string
  onOpenChat: () => void
  onBack?: () => void
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    SIGN:      { bg: 'bg-risk-low/15',    text: 'text-risk-low',    label: 'Safe to Sign' },
    NEGOTIATE: { bg: 'bg-risk-medium/15',  text: 'text-risk-medium', label: 'Negotiate First' },
    WALK_AWAY: { bg: 'bg-risk-high/15',    text: 'text-risk-high',   label: 'Walk Away' },
  }
  const c = config[verdict] || config.NEGOTIATE
  return (
    <span className={cn('px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide', c.bg, c.text)}>
      {c.label}
    </span>
  )
}

function RiskScoreRing({ score }: { score: number }) {
  const normalized = Math.min(score, 10)
  const circumference = 2 * Math.PI * 40
  const offset = circumference - (normalized / 10) * circumference
  const color = score <= 3 ? '#22c55e' : score <= 6 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative w-28 h-28">
      <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#ECEAE4" strokeWidth="6" />
        <motion.circle
          cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: easeOutExpo, delay: 0.3 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-2xl font-bold', riskColor(score))}>{score.toFixed(1)}</span>
        <span className="text-[10px] text-cream-400 uppercase">{riskLabel(score)}</span>
      </div>
    </div>
  )
}

export default function ResultsDashboard({ result, filename, onOpenChat, onBack }: ResultsDashboardProps) {
  const [expandedClause, setExpandedClause] = useState<number | null>(null)
  const [downloading, setDownloading] = useState(false)
  const { addDownload } = useUser()

  const advisory = result.advisory
  const overall = advisory?.overall_risk_assessment

  // Build clause map for joined display
  const clauseData = useMemo(() => {
    const riskMap = new Map(result.risks.map(r => [r.clause_id, r]))
    const classMap = new Map(result.classifications.map(c => [c.clause_id, c]))
    const simpMap = new Map(result.simplifications.map(s => [s.clause_id, s]))
    const benchMap = new Map(result.benchmarks.map(b => [b.clause_id, b]))

    return result.clauses.map(clause => ({
      clause,
      risk: riskMap.get(clause.clause_id),
      classification: classMap.get(clause.clause_id),
      simplification: simpMap.get(clause.clause_id),
      benchmark: benchMap.get(clause.clause_id),
    }))
  }, [result])

  // Risk distribution
  const riskCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 }
    for (const r of result.risks) {
      if (r.risk_level === 'RED') counts.high++
      else if (r.risk_level === 'YELLOW') counts.medium++
      else counts.low++
    }
    return counts
  }, [result.risks])

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const blob = await downloadReport(result.document_id, 'negotiation_brief')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${filename?.replace(/\.[^.]+$/, '') || 'report'}_negotiation_brief.pdf`
      a.click()
      URL.revokeObjectURL(url)
      addDownload({
        id: crypto.randomUUID(),
        documentId: result.document_id,
        filename: filename || 'document',
        exportType: 'negotiation_brief',
        exportLabel: 'Negotiation Brief',
        downloadedAt: Date.now(),
      })
    } catch {
      // silent fail for MVP
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex-1 h-screen bg-cream overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: easeOutExpo }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8"
        >
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-cream-100 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div>
            <h1 className="text-2xl font-semibold text-surface-200 mb-1">Analysis Complete</h1>
            {filename && <p className="text-sm text-cream-400">{filename}</p>}
            {result.total_analysis_time_ms > 0 && (
              <p className="text-xs text-cream-400 flex items-center gap-1 mt-1">
                <Clock className="w-3 h-3" />
                {formatMs(result.total_analysis_time_ms)} total
              </p>
            )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <motion.button
              onClick={onOpenChat}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-cream-300 text-sm text-surface-300 hover:border-suits-500/30 hover:text-surface-200 transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <MessageSquare className="w-4 h-4" />
              Chat
            </motion.button>
            <motion.button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-200 text-cream text-sm hover:bg-surface-300 disabled:opacity-50 transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Download className="w-4 h-4" />
              {downloading ? 'Generating...' : 'Download PDF'}
            </motion.button>
          </div>
        </motion.div>

        {/* ── Overall Risk + Verdict ── */}
        {overall && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5, ease: easeOutExpo }}
            className="flex flex-col sm:flex-row items-center gap-6 p-6 rounded-2xl border border-cream-200 bg-white/50 mb-6"
          >
            <RiskScoreRing score={overall.score} />
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-lg font-medium text-surface-200">Overall Risk</h3>
                <VerdictBadge verdict={overall.verdict} />
              </div>
              <p className="text-sm text-surface-400 leading-relaxed">{overall.verdict_reasoning}</p>
            </div>
          </motion.div>
        )}

        {/* ── Risk Distribution ── */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5 }}
          className="grid grid-cols-3 gap-3 mb-6"
        >
          {[
            { label: 'High Risk', count: riskCounts.high, color: 'text-risk-high', bg: 'bg-risk-high/10', icon: ShieldAlert },
            { label: 'Medium', count: riskCounts.medium, color: 'text-risk-medium', bg: 'bg-risk-medium/10', icon: AlertTriangle },
            { label: 'Low Risk', count: riskCounts.low, color: 'text-risk-low', bg: 'bg-risk-low/10', icon: ShieldCheck },
          ].map((item) => (
            <div key={item.label} className={cn('flex items-center gap-3 p-4 rounded-xl border border-cream-200', item.bg)}>
              <item.icon className={cn('w-5 h-5', item.color)} />
              <div>
                <p className={cn('text-xl font-bold', item.color)}>{item.count}</p>
                <p className="text-xs text-cream-400">{item.label}</p>
              </div>
            </div>
          ))}
        </motion.div>

        {/* ── Executive Summary ── */}
        {advisory?.executive_summary && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="p-5 rounded-2xl border border-cream-200 bg-white/50 mb-6"
          >
            <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wide mb-2">Executive Summary</h3>
            <p className="text-sm text-surface-400 leading-relaxed">{advisory.executive_summary}</p>
          </motion.div>
        )}

        {/* ── Critical Issues ── */}
        {advisory && advisory.critical_issues.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5 }}
            className="mb-6"
          >
            <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wide mb-3 flex items-center gap-2">
              <FileWarning className="w-4 h-4 text-risk-high" />
              Critical Issues ({advisory.critical_issues.length})
            </h3>
            <div className="space-y-2">
              {advisory.critical_issues.map((issue, i) => (
                <div key={i} className="p-4 rounded-xl border border-risk-high/15 bg-risk-high/5">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-medium text-surface-200">{issue.issue_title}</p>
                    <span className="text-[10px] bg-risk-high/15 text-risk-high px-2 py-0.5 rounded-full shrink-0">
                      Priority {issue.priority}
                    </span>
                  </div>
                  <p className="text-sm text-surface-400 mb-2">{issue.issue_description}</p>
                  <p className="text-xs text-cream-400">
                    <span className="font-medium text-surface-400">Action:</span> {issue.recommended_action}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── Positive Aspects ── */}
        {advisory && advisory.positive_aspects.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="mb-6"
          >
            <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-risk-low" />
              Positive Aspects ({advisory.positive_aspects.length})
            </h3>
            <div className="space-y-2">
              {advisory.positive_aspects.map((pa, i) => (
                <div key={i} className="p-3 rounded-xl border border-risk-low/15 bg-risk-low/5 flex items-start gap-3">
                  <CheckCircle2 className="w-4 h-4 text-risk-low shrink-0 mt-0.5" />
                  <p className="text-sm text-surface-400">Clause {pa.clause_id}: {pa.description}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── Clause-by-Clause ── */}
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="mb-8"
        >
          <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wide mb-3">
            Clause Analysis ({clauseData.length})
          </h3>
          <div className="space-y-2">
            {clauseData.map(({ clause, risk, classification, simplification, benchmark }) => {
              const isExpanded = expandedClause === clause.clause_id
              const score = risk?.risk_score ?? 0

              return (
                <motion.div
                  key={clause.clause_id}
                  variants={staggerItem}
                  className="rounded-xl border border-cream-200 overflow-hidden"
                >
                  {/* Collapsed header */}
                  <button
                    onClick={() => setExpandedClause(isExpanded ? null : clause.clause_id)}
                    className="w-full flex items-center gap-3 p-4 text-left hover:bg-cream-100/50 transition-colors"
                  >
                    <div className={cn('w-2 h-2 rounded-full shrink-0', riskBg(score))} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-200 truncate">
                        {clause.title || `Clause ${clause.clause_id}`}
                      </p>
                      {classification && (
                        <p className="text-xs text-cream-400">{classification.category}</p>
                      )}
                    </div>
                    {risk && (
                      <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', riskColor(score),
                        score <= 3 ? 'bg-risk-low/10' : score <= 6 ? 'bg-risk-medium/10' : 'bg-risk-high/10',
                      )}>
                        {score}/10
                      </span>
                    )}
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-cream-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-cream-400 shrink-0" />
                    )}
                  </button>

                  {/* Expanded detail */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 space-y-3 border-t border-cream-200 pt-3">
                          {/* Original text */}
                          <div>
                            <p className="text-[11px] font-medium text-cream-400 uppercase mb-1">Original</p>
                            <p className="text-sm text-surface-400 leading-relaxed">{clause.text}</p>
                          </div>

                          {/* Simplified */}
                          {simplification && (
                            <div>
                              <p className="text-[11px] font-medium text-cream-400 uppercase mb-1">Plain English</p>
                              <p className="text-sm text-surface-300 leading-relaxed bg-suits-500/5 p-3 rounded-lg">
                                {simplification.simplified_text}
                              </p>
                            </div>
                          )}

                          {/* Risk detail */}
                          {risk && (
                            <div>
                              <p className="text-[11px] font-medium text-cream-400 uppercase mb-1">Risk Assessment</p>
                              <p className="text-sm text-surface-400">{risk.reasoning}</p>
                              {risk.flags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {risk.flags.map((flag, i) => (
                                    <span key={i} className="text-[11px] bg-risk-high/10 text-risk-high px-2 py-0.5 rounded-full">
                                      {flag}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {risk.suggested_modification && (
                                <p className="text-xs text-suits-500 mt-2 flex items-start gap-1">
                                  <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" />
                                  {risk.suggested_modification}
                                </p>
                              )}
                            </div>
                          )}

                          {/* Benchmark */}
                          {benchmark && (
                            <div>
                              <p className="text-[11px] font-medium text-cream-400 uppercase mb-1">Benchmark</p>
                              <p className="text-sm text-surface-400">{benchmark.benchmark_comparison}</p>
                              <span className={cn(
                                'inline-block text-[11px] px-2 py-0.5 rounded-full mt-1',
                                benchmark.deviation_level === 'STANDARD' ? 'bg-risk-low/10 text-risk-low' :
                                benchmark.deviation_level === 'MODERATE_DEVIATION' ? 'bg-risk-medium/10 text-risk-medium' :
                                'bg-risk-high/10 text-risk-high',
                              )}>
                                {benchmark.deviation_level.replace(/_/g, ' ')}
                              </span>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
        </motion.div>

        {/* ── Agent Timings ── */}
        {result.agent_timings.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mb-8"
          >
            <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Agent Performance
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {result.agent_timings.map(t => (
                <div key={t.agent} className="p-3 rounded-xl border border-cream-200 bg-white/30">
                  <p className="text-xs text-cream-400 capitalize mb-0.5">{t.agent.replace(/_/g, ' ')}</p>
                  <p className="text-sm font-medium text-surface-300">{formatMs(t.timing_ms)}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
