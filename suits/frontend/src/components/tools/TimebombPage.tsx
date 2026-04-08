import { motion } from 'framer-motion'
import { Timer } from 'lucide-react'
import ToolLayout from './ToolLayout'
import { cn } from '@/lib/utils'
import { staggerContainer, staggerItem } from '@/lib/motion'
import type { AnalysisResult } from '@/api/client'

const TIMEBOMB_KEYWORDS = [
  'auto-renew', 'automatic renewal', 'automatically renew',
  'escalation', 'increase', 'escalate',
  'expire', 'expiration', 'expiry',
  'notice period', 'prior notice', 'written notice',
  'terminate', 'termination',
  'penalty', 'liquidated damages',
  'non-compete', 'non-solicitation',
  'lock-in', 'minimum term', 'commitment period',
]

interface TimebombClause {
  clauseId: number
  title: string
  text: string
  keywords: string[]
  riskScore: number
  riskLevel: string
  page: number
}

function findTimebombs(result: AnalysisResult): TimebombClause[] {
  const items: TimebombClause[] = []

  for (const clause of result.clauses) {
    const lower = clause.text.toLowerCase()
    const matched = TIMEBOMB_KEYWORDS.filter(kw => lower.includes(kw))
    if (matched.length === 0) continue

    const risk = result.risks.find(r => r.clause_id === clause.clause_id)

    items.push({
      clauseId: clause.clause_id,
      title: clause.title || `Clause ${clause.clause_id}`,
      text: clause.text.slice(0, 200),
      keywords: matched,
      riskScore: risk?.risk_score ?? 0,
      riskLevel: risk?.risk_level ?? 'GREEN',
      page: clause.page_number,
    })
  }

  return items.sort((a, b) => b.riskScore - a.riskScore)
}

export default function TimebombPage({ result }: { result: AnalysisResult | null }) {
  const timebombs = result ? findTimebombs(result) : []

  return (
    <ToolLayout title="Timebomb Clauses" description="Auto-renewals, escalations, and time-triggered obligations" icon={Timer} result={result}>
      {timebombs.length === 0 ? (
        <p className="text-center text-cream-400 py-12">No timebomb clauses detected in this document.</p>
      ) : (
        <>
          <div className="flex items-center gap-4 mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-100">
            <Timer className="w-5 h-5 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-700">
              Found <strong>{timebombs.length}</strong> clause{timebombs.length > 1 ? 's' : ''} with time-triggered conditions that could activate automatically.
            </p>
          </div>

          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-3">
            {timebombs.map((tb) => (
              <motion.div
                key={tb.clauseId}
                variants={staggerItem}
                className="bg-white rounded-2xl border border-cream-200 p-5"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <p className="text-sm font-semibold text-surface-200">{tb.title}</p>
                    <p className="text-xs text-cream-400 mt-0.5">Clause {tb.clauseId} · Page {tb.page}</p>
                  </div>
                  <div className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-bold shrink-0',
                    tb.riskLevel === 'RED' ? 'bg-red-50 text-red-600' :
                    tb.riskLevel === 'YELLOW' ? 'bg-amber-50 text-amber-600' :
                    'bg-green-50 text-green-600',
                  )}>
                    {tb.riskScore}
                  </div>
                </div>
                <p className="text-sm text-surface-400 mb-3 line-clamp-3">{tb.text}</p>
                <div className="flex flex-wrap gap-1.5">
                  {tb.keywords.map(kw => (
                    <span key={kw} className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-xs">{kw}</span>
                  ))}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </>
      )}
    </ToolLayout>
  )
}
