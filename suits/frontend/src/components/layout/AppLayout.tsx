import { useState, useCallback, useEffect } from 'react'
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
import DocumentsPage from '@/components/tools/DocumentsPage'
import LibraryPage from '@/components/tools/LibraryPage'
import DownloadsPage from '@/components/tools/DownloadsPage'
import { useAnalysis } from '@/hooks/useAnalysis'
import { useUser } from '@/context/UserContext'
import { uploadDocument, getResults, type AnalysisResult } from '@/api/client'
import { easeOutExpo } from '@/lib/motion'

type AppView = 'chat' | 'uploading' | 'pipeline' | 'results' | string

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeView, setActiveView] = useState<AppView>('chat')
  const [activeChatId, setActiveChatId] = useState<string>(() => crypto.randomUUID())
  const [activeDocumentId, setActiveDocumentId] = useState<string | undefined>()
  const [activeFilename, setActiveFilename] = useState<string>('')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [cachedResult, setCachedResult] = useState<AnalysisResult | null>(null)

  const analysis = useAnalysis()
  const { addDocument } = useUser()

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
        const result = await getResults(docId)
        setCachedResult(result)
        addDocument({ id: docId, filename: file.name, uploadedAt: Date.now(), analyzed: true })
        setActiveView('results')
        return
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
      setCachedResult(analysis.result)
      addDocument({
        id: analysis.result.document_id,
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
    setActiveView(view)
  }, [])

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
          <ResultsDashboard result={currentResult} filename={activeFilename} onOpenChat={handleOpenChat} />
        )}

        {activeView === 'settings' && <SettingsPage />}
        {activeView === 'risk-score' && <RiskScorePage result={currentResult} />}
        {activeView === 'simulator' && <WhatCouldGoWrongPage result={currentResult} />}
        {activeView === 'deadlines' && <DeadlineTrackerPage result={currentResult} />}
        {activeView === 'timebomb' && <TimebombPage result={currentResult} />}
        {activeView === 'trap-detector' && <TrapDetectorPage result={currentResult} />}
        {activeView === 'negotiator' && <NegotiatorPage result={currentResult} />}
        {activeView === 'documents' && <DocumentsPage onViewDocument={handleViewDocument} />}
        {activeView === 'library' && <LibraryPage />}
        {activeView === 'downloads' && <DownloadsPage result={currentResult} />}
      </main>
    </motion.div>
  )
}
