import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload,
  FileSearch,
  ShieldAlert,
  Handshake,
  Sparkles,
  Download,
} from 'lucide-react'
import { useUser } from '@/context/UserContext'
import ChatMessage from './ChatMessage'
import ChatInput from './ChatInput'
import {
  generalChatStream,
  chatWithDocumentStream,
  type ChatResponse,
} from '@/api/client'
import { easeOutExpo, staggerContainer, staggerItem } from '@/lib/motion'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: ChatResponse['source_clauses']
}

interface ChatInterfaceProps {
  chatId: string
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

function ThinkingIndicator() {
  return (
    <div className="flex gap-4 px-6 py-5">
      <img src="/images/suits-logo.png" alt="Suits AI" className="w-8 h-8 object-contain shrink-0" />
      <div className="bg-cream border border-cream-200 rounded-2xl rounded-tl-md px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-suits-500 typing-dot" />
            <div className="w-2 h-2 rounded-full bg-suits-500 typing-dot" />
            <div className="w-2 h-2 rounded-full bg-suits-500 typing-dot" />
          </div>
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-sm text-cream-400"
          >
            Thinking...
          </motion.span>
        </div>
      </div>
    </div>
  )
}

export default function ChatInterface({ chatId, documentId, onFileSelect }: ChatInterfaceProps) {
  const { user, addChat, chatHistory } = useUser()

  // Load existing messages if resuming a chat
  const [messages, setMessages] = useState<Message[]>(() => {
    const existing = chatHistory.find(c => c.id === chatId)
    if (existing?.messages) {
      return existing.messages.map(m => ({ ...m, sources: undefined }))
    }
    return []
  })

  const chatSavedRef = useRef(
    chatHistory.some(c => c.id === chatId),
  )
  const [isThinking, setIsThinking] = useState(false)
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tokenBufferRef = useRef('')
  const rafRef = useRef<number>(0)
  const streamMsgIdRef = useRef<string | null>(null)
  const messagesRef = useRef<Message[]>(messages)

  const isEmpty = messages.length === 0
  const isBusy = isThinking || streamingId !== null

  // Keep messages ref in sync so async callbacks always see latest
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isThinking, streamingId])

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // Flush buffered tokens to state at ~60fps
  const flushTokens = useCallback(() => {
    const msgId = streamMsgIdRef.current
    if (!msgId || !tokenBufferRef.current) return
    const chunk = tokenBufferRef.current
    tokenBufferRef.current = ''
    setMessages(prev =>
      prev.map(m =>
        m.id === msgId ? { ...m, content: m.content + chunk } : m,
      ),
    )
    // Keep scrolling during stream
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  const handleSend = useCallback(
    async (content: string) => {
      if (isBusy) return

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
      }
      setMessages(prev => [...prev, userMsg])
      setIsThinking(true)

      const assistantId = crypto.randomUUID()
      streamMsgIdRef.current = assistantId
      tokenBufferRef.current = ''
      let firstTokenReceived = false

      const onToken = (token: string) => {
        // On first token, transition from thinking → streaming
        if (!firstTokenReceived) {
          firstTokenReceived = true
          setIsThinking(false)
          setMessages(prev => [
            ...prev,
            { id: assistantId, role: 'assistant' as const, content: '' },
          ])
          setStreamingId(assistantId)
        }

        // Buffer tokens, flush via rAF
        tokenBufferRef.current += token
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(flushTokens)
      }

      const onDone = (sources: ChatResponse['source_clauses']) => {
        // Final flush
        cancelAnimationFrame(rafRef.current)
        const remaining = tokenBufferRef.current
        tokenBufferRef.current = ''
        streamMsgIdRef.current = null

        // Compute final messages from ref (setState updaters run during render, not inline)
        const finalMessages = messagesRef.current.map(m =>
          m.id === assistantId
            ? { ...m, content: m.content + remaining, sources }
            : m,
        )

        setMessages(finalMessages)
        setStreamingId(null)
        setIsThinking(false)

        // Persist to chat history
        const isFirstSave = !chatSavedRef.current
        chatSavedRef.current = true
        addChat({
          id: chatId,
          title: isFirstSave
            ? content.slice(0, 50) + (content.length > 50 ? '...' : '')
            : '',
          documentId,
          createdAt: Date.now(),
          lastMessage: content,
          messages: finalMessages.map(m => ({ id: m.id, role: m.role, content: m.content })),
        })
      }

      const onError = (error: string) => {
        cancelAnimationFrame(rafRef.current)
        tokenBufferRef.current = ''
        streamMsgIdRef.current = null
        setStreamingId(null)
        setIsThinking(false)

        setMessages(prev => {
          // If we already have a streaming message, update it
          const existing = prev.find(m => m.id === assistantId)
          if (existing) {
            return prev.map(m =>
              m.id === assistantId
                ? { ...m, content: m.content || error }
                : m,
            )
          }
          return [
            ...prev,
            { id: assistantId, role: 'assistant' as const, content: error },
          ]
        })
      }

      try {
        if (documentId) {
          await chatWithDocumentStream(documentId, content, onToken, onDone, onError)
        } else {
          await generalChatStream(content, onToken, onDone, onError)
        }
      } catch {
        onError('Something went wrong. Please try again.')
      }
    },
    [documentId, isBusy, flushTokens, addChat, chatId],
  )

  const openFilePicker = () => fileInputRef.current?.click()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    onFileSelect?.(file)
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

  const handleExportChat = useCallback(() => {
    if (messages.length === 0) return
    const lines = [
      'Suits AI — Chat Transcript',
      `Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      documentId ? `Document ID: ${documentId}` : 'General conversation',
      '═'.repeat(60),
      '',
    ]
    for (const msg of messages) {
      const label = msg.role === 'user' ? `${user.name}` : 'Suits AI'
      lines.push(`[${label}]`)
      lines.push(msg.content)
      lines.push('')
    }
    lines.push('═'.repeat(60))
    lines.push('Generated by Suits AI')

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `suits-chat-${chatId.slice(0, 8)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [messages, documentId, chatId, user.name])

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
        {isEmpty && !isThinking ? (
          <div className="flex flex-col items-center justify-center h-full px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: easeOutExpo }}
              className="text-center mb-12"
            >
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
          <div className="max-w-4xl mx-auto py-6 relative">
            {/* Export chat button */}
            {messages.length > 0 && !isBusy && (
              <div className="sticky top-2 z-10 flex justify-end px-6 mb-2">
                <motion.button
                  onClick={handleExportChat}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/80 backdrop-blur border border-cream-200 text-xs text-surface-400 hover:text-surface-200 hover:border-cream-300 transition-colors shadow-sm"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Download className="w-3 h-3" />
                  <span>Export chat</span>
                </motion.button>
              </div>
            )}
            <AnimatePresence>
              {messages.map((msg, i) => (
                <ChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  sources={msg.sources}
                  userName={user.name}
                  userAvatar={user.avatar}
                  index={i}
                  isStreaming={msg.id === streamingId}
                />
              ))}
            </AnimatePresence>
            {isThinking && <ThinkingIndicator />}
          </div>
        )}
      </div>

      <ChatInput
        onSend={handleSend}
        onUpload={openFilePicker}
        disabled={isBusy}
      />
    </div>
  )
}
