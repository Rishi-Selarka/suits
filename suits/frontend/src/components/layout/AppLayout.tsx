import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import Sidebar from './Sidebar'
import ChatInterface from '@/components/chat/ChatInterface'
import PipelineProgress from '@/components/pipeline/PipelineProgress'
import ResultsDashboard from '@/components/analysis/ResultsDashboard'
import { useAnalysis } from '@/hooks/useAnalysis'
import { uploadDocument, getResults, type AnalysisResult } from '@/api/client'
import { easeOutExpo } from '@/lib/motion'

type AppView = 'chat' | 'uploading' | 'pipeline' | 'results' | string

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeView, setActiveView] = useState<AppView>('chat')
  const [activeDocumentId, setActiveDocumentId] = useState<string | undefined>()
  const [activeFilename, setActiveFilename] = useState<string>('')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [cachedResult, setCachedResult] = useState<AnalysisResult | null>(null)

  const analysis = useAnalysis()

  // ── Upload → Analyze → Results flow ──

  const handleFileSelect = useCallback(async (file: File) => {
    setUploadError(null)
    setActiveFilename(file.name)
    setActiveView('uploading')
    setCachedResult(null)

    try {
      // Step 1: Upload
      const uploadRes = await uploadDocument(file)
      const docId = uploadRes.document_id
      setActiveDocumentId(docId)

      // If server already has this analyzed (cached), jump to results
      if (uploadRes.status === 'cached') {
        const result = await getResults(docId)
        setCachedResult(result)
        setActiveView('results')
        return
      }

      // Step 2: Trigger analysis pipeline
      setActiveView('pipeline')
      await analysis.runAnalysis(docId)

      // Step 3: When analysis completes via SSE, result is in analysis.result
      // The useEffect below handles view transition
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
      setActiveView('chat')
    }
  }, [analysis])

  // Watch for analysis completion
  const currentResult = cachedResult || analysis.result
  if (
    activeView === 'pipeline' &&
    (analysis.pipelineStatus === 'complete' || analysis.pipelineStatus === 'cached') &&
    analysis.result
  ) {
    // Synchronous view transition when result arrives
    setCachedResult(analysis.result)
    setActiveView('results')
  }

  const handleNewChat = useCallback(() => {
    setActiveDocumentId(undefined)
    setActiveFilename('')
    setCachedResult(null)
    analysis.reset()
    setActiveView('chat')
    setUploadError(null)
  }, [analysis])

  const handleChatSelect = useCallback((_chatId: string, documentId?: string) => {
    setActiveDocumentId(documentId)
    setActiveView('chat')
  }, [])

  const handleOpenChat = useCallback(() => {
    setActiveView('chat')
  }, [])

  const handleViewChange = useCallback((view: string) => {
    setActiveView(view)
  }, [])

  return (
    <motion.div
      className="flex h-screen overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: easeOutExpo }}
    >
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        onNewChat={handleNewChat}
        activeView={activeView}
        onViewChange={handleViewChange}
        onChatSelect={handleChatSelect}
      />

      <main className="flex-1 overflow-hidden">
        {/* Chat view */}
        {activeView === 'chat' && (
          <ChatInterface
            documentId={activeDocumentId}
            onFileSelect={handleFileSelect}
          />
        )}

        {/* Uploading state */}
        {activeView === 'uploading' && (
          <div className="flex-1 flex items-center justify-center h-screen bg-cream">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-suits-500/10 flex items-center justify-center">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  className="w-5 h-5 border-2 border-suits-500 border-t-transparent rounded-full"
                />
              </div>
              <p className="text-sm text-surface-300">Uploading {activeFilename}...</p>
            </motion.div>
          </div>
        )}

        {/* Pipeline progress */}
        {activeView === 'pipeline' && (
          <PipelineProgress
            agents={analysis.agents}
            agentOrder={analysis.agentOrder}
            pipelineStatus={analysis.pipelineStatus}
            error={analysis.error || uploadError}
            filename={activeFilename}
          />
        )}

        {/* Results dashboard */}
        {activeView === 'results' && currentResult && (
          <ResultsDashboard
            result={currentResult}
            filename={activeFilename}
            onOpenChat={handleOpenChat}
          />
        )}

        {/* Tool views — stubs */}
        {!['chat', 'uploading', 'pipeline', 'results'].includes(activeView) && (
          <ToolPlaceholder view={activeView} />
        )}
      </main>
    </motion.div>
  )
}

function ToolPlaceholder({ view }: { view: string }) {
  const labels: Record<string, string> = {
    'risk-score': 'Risk Score',
    simulator: 'What Could Go Wrong',
    deadlines: 'Deadline Tracker',
    timebomb: 'Timebomb Clause Finder',
    'trap-detector': 'Trap Clause Detector',
    negotiator: 'AI vs AI Negotiator',
    library: 'Library & Sources',
    downloads: 'Downloads',
    documents: 'Documents',
    settings: 'Settings',
  }

  return (
    <div className="flex-1 flex items-center justify-center h-screen bg-cream">
      <motion.div
        key={view}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="text-center"
      >
        <h2 className="text-2xl font-light text-surface-300 mb-2">
          {labels[view] || view}
        </h2>
        <p className="text-cream-400 text-sm">Coming soon</p>
      </motion.div>
    </div>
  )
}
