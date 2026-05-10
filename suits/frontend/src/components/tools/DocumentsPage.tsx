import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { FileText, CheckCircle, Clock, AlertCircle, ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import { listDocuments, type DocumentListItem } from '@/api/client'
import { cn } from '@/lib/utils'
import { easeOutExpo, staggerContainer, staggerItem } from '@/lib/motion'

export default function DocumentsPage({ onViewDocument, onBack }: { onViewDocument?: (docId: string) => void; onBack?: () => void }) {
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchDocs = async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true)
    else setRefreshing(true)
    setErrorMsg(null)
    try {
      const list = await listDocuments()
      setDocuments(list)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load documents')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchDocs('initial')
  }, [])

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
            <button
              onClick={() => fetchDocs('refresh')}
              disabled={loading || refreshing}
              className="ml-auto w-8 h-8 rounded-xl flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-cream-100 transition-colors disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            </button>
          </div>
          <p className="text-sm text-cream-400 mb-8">Your uploaded documents and analysis history</p>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Loader2 className="w-6 h-6 text-suits-500 animate-spin mb-3" />
              <p className="text-cream-400 text-sm">Loading your documents...</p>
            </div>
          ) : errorMsg ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mb-4">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
              <p className="text-surface-300 font-medium mb-1">Couldn't load documents</p>
              <p className="text-cream-400 text-sm mb-4">{errorMsg}</p>
              <button
                onClick={() => fetchDocs('initial')}
                className="px-4 py-2 rounded-xl bg-surface-200 text-cream text-sm hover:bg-surface-300 transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : documents.length === 0 ? (
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
                const StatusIcon =
                  doc.analyzed ? CheckCircle :
                  doc.status === 'error' ? AlertCircle :
                  Clock
                const statusColor =
                  doc.analyzed ? 'text-green-500' :
                  doc.status === 'error' ? 'text-red-500' :
                  'text-amber-500'
                const statusLabel =
                  doc.analyzed ? 'Analyzed' :
                  doc.status === 'processing' ? 'Processing' :
                  doc.status === 'error' ? 'Failed' :
                  'Pending'
                const uploadedAt = doc.uploaded_at
                  ? new Date(doc.uploaded_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
                    })
                  : ''

                return (
                  <motion.button
                    key={doc.document_id}
                    variants={staggerItem}
                    onClick={() => onViewDocument?.(doc.document_id)}
                    className="w-full flex items-center gap-4 bg-white rounded-2xl border border-cream-200 p-4 hover:shadow-md hover:border-suits-500/20 transition-all text-left"
                  >
                    <div className="w-10 h-10 rounded-xl bg-suits-50 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-suits-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-200 truncate">{doc.filename}</p>
                      <p className="text-xs text-cream-400">
                        {uploadedAt}
                        {doc.page_count > 0 && ` · ${doc.page_count} page${doc.page_count === 1 ? '' : 's'}`}
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
