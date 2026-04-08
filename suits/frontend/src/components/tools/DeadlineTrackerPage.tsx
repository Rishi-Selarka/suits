import { motion } from 'framer-motion'
import { Calendar } from 'lucide-react'
import ToolLayout from './ToolLayout'
import { staggerContainer, staggerItem } from '@/lib/motion'
import type { AnalysisResult } from '@/api/client'

const DATE_RE = /\b(\d{1,2}[\s/-]\w+[\s/-]\d{2,4}|\w+ \d{1,2},?\s*\d{4}|\d{4}-\d{2}-\d{2})\b/gi
const TIME_KEYWORDS = /(\d+)\s*(day|week|month|year|business day)s?/gi

interface DeadlineItem {
  clauseId: number
  text: string
  match: string
  page: number
}

function extractDeadlines(result: AnalysisResult): DeadlineItem[] {
  const items: DeadlineItem[] = []
  const seen = new Set<string>()

  for (const clause of result.clauses) {
    const dateMatches = clause.text.match(DATE_RE) || []
    const timeMatches = clause.text.match(TIME_KEYWORDS) || []

    for (const match of [...dateMatches, ...timeMatches]) {
      const key = `${clause.clause_id}-${match}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        clauseId: clause.clause_id,
        text: clause.title || clause.text.slice(0, 120),
        match,
        page: clause.page_number,
      })
    }
  }
  return items
}

function DeadlineTrackerContent({ result }: { result: AnalysisResult }) {
  const deadlines = extractDeadlines(result)

  return deadlines.length === 0 ? (
    <p className="text-center text-cream-400 py-12">No date references found in this document.</p>
  ) : (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-3">
      {deadlines.map((d, i) => (
        <motion.div
          key={`${d.clauseId}-${d.match}-${i}`}
          variants={staggerItem}
          className="flex items-start gap-4 bg-white rounded-2xl border border-cream-200 p-4"
        >
          <div className="w-10 h-10 rounded-xl bg-suits-500/10 flex items-center justify-center shrink-0">
            <Calendar className="w-4 h-4 text-suits-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded-md bg-suits-50 text-suits-700 text-xs font-medium">{d.match}</span>
              <span className="text-xs text-cream-400">Clause {d.clauseId} · Page {d.page}</span>
            </div>
            <p className="text-sm text-surface-300 line-clamp-2">{d.text}</p>
          </div>
        </motion.div>
      ))}
    </motion.div>
  )
}

export default function DeadlineTrackerPage() {
  return (
    <ToolLayout title="Deadline Tracker" description="Dates, periods, and time-sensitive obligations" icon={Calendar}>
      {(result) => <DeadlineTrackerContent result={result} />}
    </ToolLayout>
  )
}
