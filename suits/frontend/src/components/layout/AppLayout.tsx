import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import Sidebar from './Sidebar'
import ChatInterface from '@/components/chat/ChatInterface'
import { easeOutExpo } from '@/lib/motion'

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeView, setActiveView] = useState('chat')
  const [activeDocumentId, setActiveDocumentId] = useState<string | undefined>()

  const handleNewChat = useCallback(() => {
    setActiveDocumentId(undefined)
    setActiveView('chat')
  }, [])

  const handleUploadRequest = useCallback(() => {
    setActiveView('chat')
  }, [])

  const handleChatSelect = useCallback((_chatId: string, documentId?: string) => {
    setActiveDocumentId(documentId)
    setActiveView('chat')
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
        onViewChange={setActiveView}
        onChatSelect={handleChatSelect}
      />

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {activeView === 'chat' && (
          <ChatInterface
            documentId={activeDocumentId}
            onUploadRequest={handleUploadRequest}
          />
        )}

        {/* Tool views — stubs for now, will be built out */}
        {activeView !== 'chat' &&
          activeView !== 'documents' &&
          activeView !== 'settings' && (
            <ToolPlaceholder view={activeView} />
          )}

        {activeView === 'documents' && (
          <ToolPlaceholder view="documents" />
        )}

        {activeView === 'settings' && (
          <ToolPlaceholder view="settings" />
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
