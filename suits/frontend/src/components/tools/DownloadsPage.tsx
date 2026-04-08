import { motion } from 'framer-motion'
import { Download, FileDown, FileText } from 'lucide-react'
import { downloadReport } from '@/api/client'
import { easeOutExpo } from '@/lib/motion'
import type { AnalysisResult } from '@/api/client'

const REPORT_TYPES = [
  { id: 'negotiation_brief', label: 'Negotiation Brief', desc: 'Counter-language and strategy playbook', icon: FileText },
  { id: 'risk_summary', label: 'Risk Summary', desc: 'Risk scores and red flags overview', icon: FileDown },
  { id: 'clause_report', label: 'Clause Report', desc: 'Detailed clause-by-clause analysis', icon: FileText },
  { id: 'full_bundle', label: 'Full Analysis Bundle', desc: 'Complete analysis with all agent outputs', icon: FileDown },
]

export default function DownloadsPage({ result }: { result: AnalysisResult | null }) {
  const handleDownload = async (reportType: string) => {
    if (!result) return
    try {
      const blob = await downloadReport(result.document_id, reportType)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `suits-${reportType}-${result.document_id.slice(0, 8)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      // silently fail
    }
  }

  return (
    <div className="flex-1 h-screen overflow-y-auto bg-cream">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: easeOutExpo }}
        >
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-suits-500/10 flex items-center justify-center">
              <Download className="w-[18px] h-[18px] text-suits-600" />
            </div>
            <h1 className="text-xl font-semibold text-surface-200">Downloads</h1>
          </div>
          <p className="text-sm text-cream-400 mb-8 ml-12">Export analysis reports as PDF</p>

          {!result ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-cream-200 flex items-center justify-center mb-4">
                <Download className="w-6 h-6 text-cream-400" />
              </div>
              <p className="text-surface-300 font-medium mb-1">No document analyzed yet</p>
              <p className="text-cream-400 text-sm">Upload and analyze a document to download reports</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {REPORT_TYPES.map((report) => (
                <motion.button
                  key={report.id}
                  onClick={() => handleDownload(report.id)}
                  className="flex items-start gap-4 bg-white rounded-2xl border border-cream-200 p-5 hover:shadow-md hover:border-suits-500/20 transition-all text-left group"
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="w-10 h-10 rounded-xl bg-suits-50 group-hover:bg-suits-100 flex items-center justify-center shrink-0 transition-colors">
                    <report.icon className="w-4 h-4 text-suits-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-surface-200">{report.label}</p>
                    <p className="text-xs text-cream-400 mt-0.5">{report.desc}</p>
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
