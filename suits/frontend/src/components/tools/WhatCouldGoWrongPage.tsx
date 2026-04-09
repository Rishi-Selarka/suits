import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import ToolLayout from './ToolLayout'
import { cn } from '@/lib/utils'
import { staggerContainer, staggerItem } from '@/lib/motion'
import type { AnalysisResult } from '@/api/client'

export function WhatCouldGoWrongContent({ result }: { result: AnalysisResult }) {
  const issues = result.advisory?.critical_issues || []
  const missing = result.advisory?.missing_clauses || []
  const redRisks = result.risks?.filter(r => r.risk_level === 'RED') || []

  return (
    <>
      {/* Critical Issues */}
      {issues.length > 0 && (
        <div className="mb-8">
          <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-4">Critical Issues</p>
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-3">
            {issues.map((issue, i) => (
              <motion.div
                key={i}
                variants={staggerItem}
                className="bg-white rounded-2xl border border-cream-200 p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold',
                    issue.priority <= 2 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600',
                  )}>
                    {issue.priority}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-surface-200">{issue.issue_title}</p>
                    <p className="text-sm text-surface-400 mt-1">{issue.issue_description}</p>
                    <div className="mt-3 p-3 rounded-xl bg-red-50/50 border border-red-100">
                      <p className="text-xs font-medium text-red-700 mb-1">Impact</p>
                      <p className="text-xs text-red-600">{issue.impact}</p>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-suits-600">
                      <ArrowRight className="w-3 h-3" />
                      <span>{issue.recommended_action}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}

      {/* Missing Protections */}
      {missing.length > 0 && (
        <div className="mb-8">
          <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-4">Missing Protections</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {missing.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="bg-white rounded-2xl border border-amber-100 p-4"
              >
                <p className="text-sm font-medium text-surface-200 mb-1">{m.clause_type}</p>
                <p className="text-xs text-cream-400 mb-2">{m.why_important}</p>
                <div className="p-2 rounded-lg bg-cream-100 text-xs text-surface-400">
                  <span className="font-medium">Suggested: </span>{m.suggested_language}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Red Flag Clauses */}
      {redRisks.length > 0 && (
        <div>
          <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-4">Red Flag Clauses</p>
          <div className="space-y-2">
            {redRisks.map(r => (
              <div key={r.clause_id} className="flex items-center gap-3 p-3 rounded-xl bg-red-50/30 border border-red-100">
                <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg">C{r.clause_id}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-surface-300 truncate">{r.specific_concern || r.reasoning}</p>
                </div>
                <span className="text-xs text-red-500 font-medium">{r.risk_score}/10</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {issues.length === 0 && missing.length === 0 && redRisks.length === 0 && (
        <p className="text-center text-cream-400 py-12">No critical issues detected in this document.</p>
      )}
    </>
  )
}

export default function WhatCouldGoWrongPage() {
  return (
    <ToolLayout title="What Could Go Wrong" description="Worst-case scenarios and impact analysis" icon={AlertTriangle} exportType="risk_summary">
      {(result) => <WhatCouldGoWrongContent result={result} />}
    </ToolLayout>
  )
}
