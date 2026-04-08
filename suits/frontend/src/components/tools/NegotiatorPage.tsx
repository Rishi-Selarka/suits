import { motion } from 'framer-motion'
import { Swords, ArrowRight } from 'lucide-react'
import ToolLayout from './ToolLayout'
import { cn } from '@/lib/utils'
import { staggerContainer, staggerItem } from '@/lib/motion'
import type { AnalysisResult } from '@/api/client'

export default function NegotiatorPage({ result }: { result: AnalysisResult | null }) {
  const advisory = result?.advisory
  const priorities = advisory?.negotiation_priority_order || []
  const issues = advisory?.critical_issues || []

  return (
    <ToolLayout title="AI Negotiator" description="Negotiation priorities, counter-language, and strategy" icon={Swords} result={result}>
      {/* Negotiation Priority Order */}
      {priorities.length > 0 && (
        <div className="mb-8">
          <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-4">Negotiation Priority Order</p>
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
            {priorities.map((priority, i) => (
              <motion.div
                key={i}
                variants={staggerItem}
                className="flex items-center gap-4 bg-white rounded-2xl border border-cream-200 p-4"
              >
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold',
                  i === 0 ? 'bg-red-50 text-red-600' :
                  i <= 2 ? 'bg-amber-50 text-amber-600' :
                  'bg-cream-200 text-surface-400',
                )}>
                  {i + 1}
                </div>
                <p className="text-sm text-surface-300 flex-1">{priority}</p>
                {i === 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-red-50 text-red-600 text-xs font-medium">Top Priority</span>
                )}
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}

      {/* Counter-Language Suggestions */}
      {issues.length > 0 && (
        <div>
          <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-4">Counter-Language Playbook</p>
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-4">
            {issues.filter(i => i.suggested_counter_language).map((issue, i) => (
              <motion.div
                key={i}
                variants={staggerItem}
                className="bg-white rounded-2xl border border-cream-200 overflow-hidden"
              >
                <div className="p-5">
                  <div className="flex items-start gap-3 mb-3">
                    <div className={cn(
                      'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold',
                      issue.priority <= 2 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600',
                    )}>
                      {issue.priority}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-surface-200">{issue.issue_title}</p>
                      <p className="text-xs text-cream-400 mt-0.5">Clause {issue.clause_id}</p>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-cream-100 mb-3">
                    <p className="text-xs text-surface-400">{issue.issue_description}</p>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-suits-600 mb-2">
                    <ArrowRight className="w-3 h-3" />
                    <span className="font-medium">{issue.recommended_action}</span>
                  </div>
                </div>

                <div className="px-5 py-4 bg-suits-50/50 border-t border-cream-200">
                  <p className="text-xs font-medium text-suits-700 mb-2">Suggested Counter-Language</p>
                  <p className="text-sm text-surface-300 italic leading-relaxed">
                    "{issue.suggested_counter_language}"
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}

      {priorities.length === 0 && issues.length === 0 && (
        <p className="text-center text-cream-400 py-12">No negotiation data available for this document.</p>
      )}
    </ToolLayout>
  )
}
