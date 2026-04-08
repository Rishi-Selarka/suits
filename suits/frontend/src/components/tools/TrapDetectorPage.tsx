import { motion } from 'framer-motion'
import { Eye, AlertCircle } from 'lucide-react'
import ToolLayout from './ToolLayout'
import { cn } from '@/lib/utils'
import { staggerContainer, staggerItem } from '@/lib/motion'
import type { AnalysisResult } from '@/api/client'

interface TrapClause {
  clauseId: number
  title: string
  originalText: string
  plainEnglish: string
  hiddenImplication: string | null
  riskScore: number
  flags: string[]
  suggestedFix: string | null
  page: number
}

function findTraps(result: AnalysisResult): TrapClause[] {
  const traps: TrapClause[] = []

  const redRisks = result.risks.filter(r => r.risk_level === 'RED' || r.risk_score >= 60)

  for (const risk of redRisks) {
    const clause = result.clauses.find(c => c.clause_id === risk.clause_id)
    const simple = result.simplifications.find(s => s.clause_id === risk.clause_id)
    if (!clause) continue

    traps.push({
      clauseId: risk.clause_id,
      title: clause.title || `Clause ${risk.clause_id}`,
      originalText: clause.text.slice(0, 300),
      plainEnglish: simple?.simplified_text || '',
      hiddenImplication: simple?.hidden_implications || null,
      riskScore: risk.risk_score,
      flags: risk.flags,
      suggestedFix: risk.suggested_modification || null,
      page: clause.page_number,
    })
  }

  return traps.sort((a, b) => b.riskScore - a.riskScore)
}

function TrapDetectorContent({ result }: { result: AnalysisResult }) {
  const traps = findTraps(result)

  return traps.length === 0 ? (
    <p className="text-center text-cream-400 py-12">No trap clauses detected. This document looks clean.</p>
  ) : (
    <>
      <div className="flex items-center gap-4 mb-6 p-4 rounded-2xl bg-red-50 border border-red-100">
        <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
        <p className="text-sm text-red-700">
          Detected <strong>{traps.length}</strong> potentially dangerous clause{traps.length > 1 ? 's' : ''} that require attention.
        </p>
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-4">
        {traps.map((trap) => (
          <motion.div
            key={trap.clauseId}
            variants={staggerItem}
            className="bg-white rounded-2xl border border-cream-200 overflow-hidden"
          >
            <div className="p-5">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <p className="text-sm font-semibold text-surface-200">{trap.title}</p>
                  <p className="text-xs text-cream-400 mt-0.5">Clause {trap.clauseId} · Page {trap.page}</p>
                </div>
                <div className={cn(
                  'px-2.5 py-1 rounded-lg text-xs font-bold shrink-0',
                  trap.riskScore >= 75 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600',
                )}>
                  Risk: {trap.riskScore}
                </div>
              </div>

              {/* What they say vs what it means */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div className="p-3 rounded-xl bg-cream-100">
                  <p className="text-xs font-medium text-cream-400 mb-1">What it says</p>
                  <p className="text-xs text-surface-400 line-clamp-4">{trap.originalText}</p>
                </div>
                {trap.plainEnglish && (
                  <div className="p-3 rounded-xl bg-amber-50/50 border border-amber-100">
                    <p className="text-xs font-medium text-amber-600 mb-1">What it actually means</p>
                    <p className="text-xs text-surface-400 line-clamp-4">{trap.plainEnglish}</p>
                  </div>
                )}
              </div>

              {trap.hiddenImplication && (
                <div className="p-3 rounded-xl bg-red-50/50 border border-red-100 mb-3">
                  <p className="text-xs font-medium text-red-600 mb-1">Hidden Implication</p>
                  <p className="text-xs text-red-700">{trap.hiddenImplication}</p>
                </div>
              )}

              {trap.flags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {trap.flags.map((f, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-md bg-red-50 text-red-600 text-xs">{f}</span>
                  ))}
                </div>
              )}
            </div>

            {trap.suggestedFix && (
              <div className="px-5 py-3 bg-green-50/50 border-t border-cream-200">
                <p className="text-xs font-medium text-green-700 mb-1">Suggested Fix</p>
                <p className="text-xs text-green-600">{trap.suggestedFix}</p>
              </div>
            )}
          </motion.div>
        ))}
      </motion.div>
    </>
  )
}

export default function TrapDetectorPage() {
  return (
    <ToolLayout title="Trap Clause Detector" description="Hidden risks, one-sided terms, and deceptive language" icon={Eye}>
      {(result) => <TrapDetectorContent result={result} />}
    </ToolLayout>
  )
}
