import { useState, useCallback, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import Sidebar from './Sidebar'
import ChatInterface from '@/components/chat/ChatInterface'
import PipelineProgress from '@/components/pipeline/PipelineProgress'
import ResultsDashboard from '@/components/analysis/ResultsDashboard'
import SettingsPage from '@/components/settings/SettingsPage'
import RiskScorePage from '@/components/tools/RiskScorePage'
import WhatCouldGoWrongPage from '@/components/tools/WhatCouldGoWrongPage'
import DeadlineTrackerPage from '@/components/tools/DeadlineTrackerPage'
import TimebombPage from '@/components/tools/TimebombPage'
import TrapDetectorPage from '@/components/tools/TrapDetectorPage'
import NegotiatorPage from '@/components/tools/NegotiatorPage'
import RunAllToolsPage from '@/components/tools/RunAllToolsPage'
import DocumentsPage from '@/components/tools/DocumentsPage'
import LibraryPage from '@/components/tools/LibraryPage'
import DownloadsPage from '@/components/tools/DownloadsPage'
import { useAnalysis } from '@/hooks/useAnalysis'
import { useUser } from '@/context/UserContext'
import { uploadDocument, getResults, type AnalysisResult } from '@/api/client'
import { easeOutExpo } from '@/lib/motion'

type AppView = 'chat' | 'uploading' | 'pipeline' | 'results' | 'settings' | 'run-all-tools' | 'risk-score' | 'simulator' | 'deadlines' | 'timebomb' | 'trap-detector' | 'negotiator' | 'documents' | 'library' | 'downloads'

// Tool views that should stay mounted once visited (to preserve state)
const PERSISTENT_TOOL_VIEWS = ['run-all-tools', 'risk-score', 'simulator', 'deadlines', 'timebomb', 'trap-detector', 'negotiator'] as const

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeView, setActiveView] = useState<AppView>('chat')
  const [activeChatId, setActiveChatId] = useState<string>(() => crypto.randomUUID())
  const [activeDocumentId, setActiveDocumentId] = useState<string | undefined>()
  const [activeFilename, setActiveFilename] = useState<string>('')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [cachedResult, setCachedResult] = useState<AnalysisResult | null>(null)
  const [mountedViews, setMountedViews] = useState<Set<string>>(new Set())

  const analysis = useAnalysis()
  const { addDocument } = useUser()
  const analysisCompletedRef = useRef<string | null>(null)

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

      addDocument({ id: docId, filename: file.name, uploadedAt: Date.now(), analyzed: false })

      // If server already has this analyzed (cached), jump to results
      if (uploadRes.status === 'cached') {
        try {
          const result = await getResults(docId)
          setCachedResult(result)
          addDocument({ id: docId, filename: file.name, uploadedAt: Date.now(), analyzed: true })
          setActiveView('results')
          return
        } catch {
          // Duplicate file but not yet analyzed — fall through to analysis
        }
      }

      // Step 2: Trigger analysis pipeline
      setActiveView('pipeline')
      await analysis.runAnalysis(docId)

      // Step 3: When analysis completes via SSE, result is in analysis.result
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
      setActiveView('chat')
    }
  }, [analysis, addDocument])

  const currentResult = cachedResult || analysis.result

  // Watch for analysis completion
  useEffect(() => {
    if (
      activeView === 'pipeline' &&
      (analysis.pipelineStatus === 'complete' || analysis.pipelineStatus === 'cached') &&
      analysis.result
    ) {
      // Guard against duplicate calls when addDocument identity changes
      const docId = analysis.result.document_id
      if (analysisCompletedRef.current === docId) return
      analysisCompletedRef.current = docId

      setCachedResult(analysis.result)
      addDocument({
        id: docId,
        filename: activeFilename,
        uploadedAt: Date.now(),
        analyzed: true,
      })
      setActiveView('results')
    }
  }, [activeView, analysis.pipelineStatus, analysis.result, activeFilename, addDocument])

  const handleNewChat = useCallback(() => {
    setActiveChatId(crypto.randomUUID())
    setActiveDocumentId(undefined)
    setActiveFilename('')
    setCachedResult(null)
    analysis.reset()
    setActiveView('chat')
    setUploadError(null)
    analysisCompletedRef.current = null
  }, [analysis])

  const handleChatSelect = useCallback((chatId: string, documentId?: string) => {
    setActiveChatId(chatId)
    setActiveDocumentId(documentId)
    setActiveView('chat')
  }, [])

  const handleOpenChat = useCallback(() => {
    setActiveView('chat')
  }, [])

  const handleViewChange = useCallback((view: string) => {
    setActiveView(view as AppView)
    if (PERSISTENT_TOOL_VIEWS.includes(view as typeof PERSISTENT_TOOL_VIEWS[number])) {
      setMountedViews(prev => {
        if (prev.has(view)) return prev
        const next = new Set(prev)
        next.add(view)
        return next
      })
    }
  }, [])

  // ── Run All Tools (preload from results view) ──
  const [runAllPreload, setRunAllPreload] = useState<AnalysisResult | null>(null)
  const [runAllDocId, setRunAllDocId] = useState<string | undefined>()
  const [runAllFilename, setRunAllFilename] = useState('')

  const handleRunAllTools = useCallback(() => {
    setRunAllPreload(currentResult)
    setRunAllDocId(activeDocumentId)
    setRunAllFilename(activeFilename)
    handleViewChange('run-all-tools')
  }, [currentResult, activeDocumentId, activeFilename, handleViewChange])

  const handleViewDocument = useCallback((docId: string) => {
    setActiveDocumentId(docId)
    // Try to load results for this document
    getResults(docId).then(result => {
      setCachedResult(result)
      setActiveView('results')
    }).catch(() => {
      setActiveView('chat')
    })
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
        activeChatId={activeChatId}
        onViewChange={handleViewChange}
        onChatSelect={handleChatSelect}
      />

      <main className="flex-1 overflow-hidden">
        {activeView === 'chat' && (
          <ChatInterface key={activeChatId} chatId={activeChatId} documentId={activeDocumentId} onFileSelect={handleFileSelect} />
        )}

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

        {activeView === 'pipeline' && (
          <PipelineProgress
            agents={analysis.agents}
            agentOrder={analysis.agentOrder}
            pipelineStatus={analysis.pipelineStatus}
            error={analysis.error || uploadError}
            filename={activeFilename}
          />
        )}

        {activeView === 'results' && currentResult && (
          <ResultsDashboard result={currentResult} filename={activeFilename} onOpenChat={handleOpenChat} onBack={handleOpenChat} onRunAllTools={handleRunAllTools} />
        )}

        {activeView === 'settings' && <SettingsPage onBack={handleOpenChat} />}

        {/* Tool pages: stay mounted once visited so state (uploads, analysis, chat) survives navigation */}
        {mountedViews.has('run-all-tools') && (
          <div style={{ display: activeView === 'run-all-tools' ? undefined : 'none' }} className="h-full">
            <RunAllToolsPage
              preloadResult={runAllPreload}
              preloadDocumentId={runAllDocId}
              preloadFilename={runAllFilename}
            />
          </div>
        )}
        {mountedViews.has('risk-score') && (
          <div style={{ display: activeView === 'risk-score' ? undefined : 'none' }} className="h-full">
            <RiskScorePage />
          </div>
        )}
        {mountedViews.has('simulator') && (
          <div style={{ display: activeView === 'simulator' ? undefined : 'none' }} className="h-full">
            <WhatCouldGoWrongPage />
          </div>
        )}
        {mountedViews.has('deadlines') && (
          <div style={{ display: activeView === 'deadlines' ? undefined : 'none' }} className="h-full">
            <DeadlineTrackerPage />
          </div>
        )}
        {mountedViews.has('timebomb') && (
          <div style={{ display: activeView === 'timebomb' ? undefined : 'none' }} className="h-full">
            <TimebombPage />
          </div>
        )}
        {mountedViews.has('trap-detector') && (
          <div style={{ display: activeView === 'trap-detector' ? undefined : 'none' }} className="h-full">
            <TrapDetectorPage />
          </div>
        )}
        {mountedViews.has('negotiator') && (
          <div style={{ display: activeView === 'negotiator' ? undefined : 'none' }} className="h-full">
            <NegotiatorPage />
          </div>
        )}

        {activeView === 'documents' && <DocumentsPage onViewDocument={handleViewDocument} onBack={handleOpenChat} />}
        {activeView === 'library' && <LibraryPage onBack={handleOpenChat} />}
        {activeView === 'downloads' && <DownloadsPage onBack={handleOpenChat} />}
      </main>
    </motion.div>
  )
}
