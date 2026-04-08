import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload,
  FileSearch,
  ShieldAlert,
  Handshake,
  Scale,
  Sparkles,
} from 'lucide-react'
import { useUser } from '@/context/UserContext'
import ChatMessage from './ChatMessage'
import ChatInput from './ChatInput'
import { chatWithDocument, type ChatResponse } from '@/api/client'
import { easeOutExpo, staggerContainer, staggerItem } from '@/lib/motion'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: ChatResponse['source_clauses']
}

interface ChatInterfaceProps {
  documentId?: string
  onFileSelect?: (file: File) => void
}

const QUICK_ACTIONS = [
  {
    label: 'Upload a contract',
    sublabel: 'PDF, image, or text',
    icon: Upload,
    action: 'upload',
  },
  {
    label: 'Review a document',
    sublabel: 'Full AI analysis',
    icon: FileSearch,
    action: 'upload',
  },
  {
    label: 'Assess legal risks',
    sublabel: 'Identify red flags',
    icon: ShieldAlert,
    action: 'risk',
  },
  {
    label: 'Negotiation strategy',
    sublabel: 'Leverage & tactics',
    icon: Handshake,
    action: 'negotiate',
  },
]

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function TypingIndicator() {
  return (
    <div className="flex gap-4 px-6 py-5">
      <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-suits-500 to-suits-700 flex items-center justify-center shrink-0">
        <span className="text-white text-xs font-bold">S</span>
      </div>
      <div className="bg-cream border border-cream-200 rounded-2xl rounded-tl-md px-5 py-4">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-surface-400 typing-dot" />
          <div className="w-2 h-2 rounded-full bg-surface-400 typing-dot" />
          <div className="w-2 h-2 rounded-full bg-surface-400 typing-dot" />
        </div>
      </div>
    </div>
  )
}

export default function ChatInterface({ documentId, onFileSelect }: ChatInterfaceProps) {
  const { user } = useUser()
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isEmpty = messages.length === 0

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isLoading])

  const handleSend = useCallback(
    async (content: string) => {
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
      }
      setMessages(prev => [...prev, userMsg])
      setIsLoading(true)

      try {
        if (documentId) {
          const response = await chatWithDocument(documentId, content)
          const assistantMsg: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: response.answer,
            sources: response.source_clauses,
          }
          setMessages(prev => [...prev, assistantMsg])
        } else {
          const assistantMsg: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content:
              "I'd love to help you analyze a legal document. Please upload a contract or document first using the attachment button, and I'll provide a comprehensive analysis with risk assessments, clause breakdowns, and actionable insights.",
          }
          setMessages(prev => [...prev, assistantMsg])
        }
      } catch (_) {
        const errorMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'I encountered an error processing your request. Please try again.',
        }
        setMessages(prev => [...prev, errorMsg])
      } finally {
        setIsLoading(false)
      }
    },
    [documentId],
  )

  const openFilePicker = () => fileInputRef.current?.click()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    onFileSelect?.(file)
    // Reset so the same file can be re-selected
    e.target.value = ''
  }

  const handleQuickAction = (action: string) => {
    if (action === 'upload') {
      openFilePicker()
      return
    }
    const prompts: Record<string, string> = {
      risk: 'What kind of legal risks can you identify in contracts?',
      negotiate: 'How can you help me with negotiation strategy for a contract?',
    }
    if (prompts[action]) handleSend(prompts[action])
  }

  return (
    <div className="flex-1 flex flex-col h-screen bg-cream">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.txt"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* ── Messages area ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: easeOutExpo }}
              className="text-center mb-12"
            >
              <motion.div
                className="mx-auto mb-6 w-16 h-16 rounded-2xl bg-surface-100 border border-surface-300/50 flex items-center justify-center"
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200, damping: 15 }}
              >
                <Scale className="w-7 h-7 text-surface-300" />
              </motion.div>

              <h1 className="text-3xl font-light text-surface-200 mb-2">
                {getGreeting()}, {user.name}
              </h1>
              <p className="text-surface-400 text-lg">How can I help you today?</p>
            </motion.div>

            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-2 lg:grid-cols-4 gap-3 max-w-3xl w-full"
            >
              {QUICK_ACTIONS.map((action) => (
                <motion.button
                  key={action.label}
                  variants={staggerItem}
                  onClick={() => handleQuickAction(action.action)}
                  className="flex flex-col items-start gap-3 p-4 rounded-2xl border border-cream-300 bg-cream hover:border-surface-400/30 hover:shadow-md transition-all duration-300 text-left group"
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="w-9 h-9 rounded-xl bg-cream-100 group-hover:bg-surface-100 flex items-center justify-center transition-colors duration-300">
                    <action.icon className="w-4 h-4 text-surface-400 group-hover:text-surface-300" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-surface-200">{action.label}</p>
                    <p className="text-xs text-cream-400 mt-0.5">{action.sublabel}</p>
                  </div>
                </motion.button>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              className="flex items-center gap-2 mt-8 text-cream-400"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-xs">Powered by multi-agent AI with 6 specialized models</span>
            </motion.div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto py-6">
            <AnimatePresence>
              {messages.map((msg, i) => (
                <ChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  sources={msg.sources}
                  userName={user.name}
                  index={i}
                />
              ))}
            </AnimatePresence>
            {isLoading && <TypingIndicator />}
          </div>
        )}
      </div>

      <ChatInput
        onSend={handleSend}
        onUpload={openFilePicker}
        disabled={isLoading}
      />
    </div>
  )
}
