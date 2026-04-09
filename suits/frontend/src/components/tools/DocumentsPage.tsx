import { motion } from 'framer-motion'
import { FileText, CheckCircle, Clock, AlertCircle, ArrowLeft } from 'lucide-react'
import { useUser } from '@/context/UserContext'
import { cn } from '@/lib/utils'
import { easeOutExpo, staggerContainer, staggerItem } from '@/lib/motion'

export default function DocumentsPage({ onViewDocument, onBack }: { onViewDocument?: (docId: string) => void; onBack?: () => void }) {
  const { documents } = useUser()

  return (
    <div className="flex-1 h-screen overflow-y-auto bg-cream">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: easeOutExpo }}
        >
          <div className="flex items-center gap-3 mb-1">
            {onBack && (
              <button
                onClick={onBack}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-cream-100 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h1 className="text-xl font-semibold text-surface-200">Documents</h1>
          </div>
          <p className="text-sm text-cream-400 mb-8">Your uploaded documents and analysis history</p>

          {documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-cream-200 flex items-center justify-center mb-4">
                <FileText className="w-6 h-6 text-cream-400" />
              </div>
              <p className="text-surface-300 font-medium mb-1">No documents yet</p>
              <p className="text-cream-400 text-sm">Upload a document from the chat to get started</p>
            </div>
          ) : (
            <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
              {documents.map((doc) => {
                const StatusIcon = doc.analyzed ? CheckCircle : doc.filename ? Clock : AlertCircle
                const statusColor = doc.analyzed ? 'text-green-500' : 'text-amber-500'
                const statusLabel = doc.analyzed ? 'Analyzed' : 'Pending'

                return (
                  <motion.button
                    key={doc.id}
                    variants={staggerItem}
                    onClick={() => onViewDocument?.(doc.id)}
                    className="w-full flex items-center gap-4 bg-white rounded-2xl border border-cream-200 p-4 hover:shadow-md hover:border-suits-500/20 transition-all text-left"
                  >
                    <div className="w-10 h-10 rounded-xl bg-suits-50 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-suits-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-200 truncate">{doc.filename}</p>
                      <p className="text-xs text-cream-400">
                        {new Date(doc.uploadedAt).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <div className={cn('flex items-center gap-1.5', statusColor)}>
                      <StatusIcon className="w-3.5 h-3.5" />
                      <span className="text-xs font-medium">{statusLabel}</span>
                    </div>
                  </motion.button>
                )
              })}
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
