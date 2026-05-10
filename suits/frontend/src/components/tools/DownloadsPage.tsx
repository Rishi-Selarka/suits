import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Download, FileText, ArrowLeft, RotateCcw, Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { downloadReport, listDownloads, type DownloadHistoryItem } from '@/api/client'
import { cn } from '@/lib/utils'
import { easeOutExpo, staggerContainer, staggerItem } from '@/lib/motion'

export default function DownloadsPage({ onBack }: { onBack?: () => void }) {
  const [downloads, setDownloads] = useState<DownloadHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [redownloading, setRedownloading] = useState<string | null>(null)

  const fetchDownloads = async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true)
    else setRefreshing(true)
    setErrorMsg(null)
    try {
      setDownloads(await listDownloads())
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load downloads')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchDownloads('initial')
  }, [])

  const handleOpen = async (dl: DownloadHistoryItem) => {
    if (opening) return
    setOpening(dl.id)
    try {
      const blob = await downloadReport(dl.document_id, dl.export_type)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch {
      // silently fail
    } finally {
      setOpening(null)
    }
  }

  const handleRedownload = async (dl: DownloadHistoryItem) => {
    if (redownloading) return
    setRedownloading(dl.id)
    try {
      const blob = await downloadReport(dl.document_id, dl.export_type)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `suits-${dl.export_type}-${dl.document_id.slice(0, 8)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      // silently fail
    } finally {
      setRedownloading(null)
    }
  }

  const formatDate = (iso: string) => {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="flex flex-col h-screen bg-cream overflow-hidden">
      {/* ── Header (matches ToolLayout) ── */}
      <div className="shrink-0 px-6 pt-4 pb-3 border-b border-cream-200 bg-white/50">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-cream-100 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-9 h-9 rounded-xl bg-suits-500/10 flex items-center justify-center">
              <Download className="w-[18px] h-[18px] text-suits-600" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-surface-200">Downloads</h1>
              <p className="text-xs text-cream-400">Your downloaded reports and exports</p>
            </div>
          </div>
          <button
            onClick={() => fetchDownloads('refresh')}
            disabled={loading || refreshing}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-cream-100 transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Loader2 className="w-6 h-6 text-suits-500 animate-spin mb-3" />
              <p className="text-cream-400 text-sm">Loading your downloads...</p>
            </div>
          ) : errorMsg ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mb-4">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
              <p className="text-surface-300 font-medium mb-1">Couldn't load downloads</p>
              <p className="text-cream-400 text-sm mb-4">{errorMsg}</p>
              <button
                onClick={() => fetchDownloads('initial')}
                className="px-4 py-2 rounded-xl bg-surface-200 text-cream text-sm hover:bg-surface-300 transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : downloads.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: easeOutExpo }}
              className="flex flex-col items-center justify-center py-24 text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-cream-200 flex items-center justify-center mb-4">
                <Download className="w-6 h-6 text-cream-400" />
              </div>
              <p className="text-surface-300 font-medium mb-1">No downloads yet</p>
              <p className="text-cream-400 text-sm">Reports you download from tools will appear here</p>
            </motion.div>
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="space-y-2"
            >
              {downloads.map((dl) => (
                <motion.div
                  key={dl.id}
                  variants={staggerItem}
                  className="flex items-center gap-4 bg-white rounded-2xl border border-cream-200 p-4 hover:shadow-sm transition-all cursor-pointer"
                  onClick={() => handleOpen(dl)}
                >
                  <div className="w-10 h-10 rounded-xl bg-suits-50 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-suits-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-surface-200 truncate">{dl.export_label || dl.export_type}</p>
                    <p className="text-xs text-cream-400 mt-0.5">
                      {dl.filename} &middot; {formatDate(dl.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRedownload(dl) }}
                    disabled={redownloading === dl.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cream-200 text-xs text-surface-400 hover:text-surface-200 hover:border-cream-300 transition-colors disabled:opacity-50 shrink-0"
                  >
                    <RotateCcw className={`w-3 h-3 ${redownloading === dl.id ? 'animate-spin' : ''}`} />
                    <span>{redownloading === dl.id ? 'Downloading...' : 'Re-download'}</span>
                  </button>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
