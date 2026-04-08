import { motion } from 'framer-motion'
import { Shield } from 'lucide-react'
import ToolLayout from './ToolLayout'
import { cn } from '@/lib/utils'
import type { AnalysisResult } from '@/api/client'

export default function RiskScorePage({ result }: { result: AnalysisResult | null }) {
  const advisory = result?.advisory
  const risk = advisory?.overall_risk_assessment
  const risks = result?.risks || []

  const score = risk?.score ?? 0
  const circumference = 2 * Math.PI * 54
  const progress = circumference - (score / 100) * circumference

  const scoreColor =
    score <= 30 ? 'text-risk-low' : score <= 60 ? 'text-risk-medium' : score <= 80 ? 'text-risk-high' : 'text-risk-critical'
  const strokeColor =
    score <= 30 ? '#22c55e' : score <= 60 ? '#f59e0b' : score <= 80 ? '#ef4444' : '#dc2626'

  const distribution = {
    GREEN: risks.filter(r => r.risk_level === 'GREEN').length,
    YELLOW: risks.filter(r => r.risk_level === 'YELLOW').length,
    RED: risks.filter(r => r.risk_level === 'RED').length,
  }
  const total = risks.length || 1

  const topRisks = [...risks].sort((a, b) => b.risk_score - a.risk_score).slice(0, 6)

  return (
    <ToolLayout title="Risk Score" description="Overall risk assessment and clause-level breakdown" icon={Shield} result={result}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Score ring */}
        <div className="bg-white rounded-2xl border border-cream-200 p-6 flex flex-col items-center justify-center">
          <div className="relative w-32 h-32 mb-4">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="#ECEAE4" strokeWidth="8" />
              <motion.circle
                cx="60" cy="60" r="54" fill="none" stroke={strokeColor} strokeWidth="8"
                strokeLinecap="round" strokeDasharray={circumference}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset: progress }}
                transition={{ duration: 1.5, ease: 'easeOut' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={cn('text-3xl font-bold', scoreColor)}>{score}</span>
              <span className="text-xs text-cream-400">/100</span>
            </div>
          </div>
          <p className="text-sm font-medium text-surface-300">{risk?.level?.replace(/_/g, ' ') || 'N/A'}</p>
          <div className={cn(
            'mt-2 px-3 py-1 rounded-full text-xs font-medium',
            risk?.verdict === 'SIGN' ? 'bg-green-50 text-green-700' :
            risk?.verdict === 'NEGOTIATE' ? 'bg-amber-50 text-amber-700' :
            'bg-red-50 text-red-700',
          )}>
            {risk?.verdict || 'N/A'}
          </div>
        </div>

        {/* Distribution */}
        <div className="bg-white rounded-2xl border border-cream-200 p-6">
          <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-4">Risk Distribution</p>
          <div className="space-y-4">
            {(['GREEN', 'YELLOW', 'RED'] as const).map(level => {
              const count = distribution[level]
              const pct = Math.round((count / total) * 100)
              const color = level === 'GREEN' ? 'bg-risk-low' : level === 'YELLOW' ? 'bg-risk-medium' : 'bg-risk-high'
              const label = level === 'GREEN' ? 'Low Risk' : level === 'YELLOW' ? 'Medium Risk' : 'High Risk'
              return (
                <div key={level}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-surface-300">{label}</span>
                    <span className="text-cream-400">{count} ({pct}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-cream-200 overflow-hidden">
                    <motion.div
                      className={cn('h-full rounded-full', color)}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, delay: 0.3 }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Verdict reasoning */}
        <div className="bg-white rounded-2xl border border-cream-200 p-6">
          <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-4">Verdict</p>
          <p className="text-sm text-surface-300 leading-relaxed">
            {risk?.verdict_reasoning || 'No verdict available. Analyze a document to see results.'}
          </p>
        </div>
      </div>

      {/* Top risky clauses */}
      <div className="bg-white rounded-2xl border border-cream-200 p-6">
        <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-4">Highest Risk Clauses</p>
        <div className="space-y-3">
          {topRisks.map(r => (
            <div key={r.clause_id} className="flex items-start gap-4 p-3 rounded-xl bg-cream-100/50">
              <div className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold',
                r.risk_level === 'RED' ? 'bg-red-50 text-red-600' :
                r.risk_level === 'YELLOW' ? 'bg-amber-50 text-amber-600' :
                'bg-green-50 text-green-600',
              )}>
                {r.risk_score}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-surface-200">Clause {r.clause_id}</p>
                <p className="text-xs text-cream-400 mt-0.5 line-clamp-2">{r.reasoning}</p>
                {r.flags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {r.flags.slice(0, 3).map((f, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-md bg-cream-200 text-xs text-surface-400">{f}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ToolLayout>
  )
}
