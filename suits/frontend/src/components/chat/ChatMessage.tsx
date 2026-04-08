import { motion } from 'framer-motion'
import { ExternalLink, Copy, Check } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { easeOutExpo } from '@/lib/motion'

interface Source {
  clause_id: number
  text: string
  page: number
}

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  userName?: string
  index: number
  isStreaming?: boolean
}

function FormattedContent({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  return (
    <div className="text-[15px] leading-relaxed whitespace-pre-wrap">
      {text.split(/(\*\*.*?\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
      {isStreaming && (
        <span className="inline-block w-[2px] h-[1.1em] bg-suits-500 ml-0.5 align-middle streaming-cursor" />
      )}
    </div>
  )
}

export default function ChatMessage({
  role,
  content,
  sources,
  userName,
  index,
  isStreaming,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false)
  const isUser = role === 'user'

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
      transition={{ delay: index * 0.05, duration: 0.4, ease: easeOutExpo }}
      className={cn(
        'group flex gap-4 px-6 py-5',
        isUser ? 'justify-end' : '',
      )}
    >
      {/* AI avatar */}
      {!isUser && (
        <img src="/images/suits-logo.png" alt="Suits AI" className="w-8 h-8 object-contain shrink-0 mt-1" />
      )}

      <div className={cn('max-w-[680px]', isUser ? 'items-end' : '')}>
        {/* Message bubble */}
        <div
          className={cn(
            'rounded-2xl px-5 py-3.5 relative',
            isUser
              ? 'bg-surface-200 text-surface-950 rounded-tr-md'
              : 'bg-cream border border-cream-200 text-surface-200 rounded-tl-md',
          )}
        >
          <FormattedContent text={content} isStreaming={isStreaming} />

          {/* Copy button — hide while streaming */}
          {!isStreaming && (
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-black/5 transition-all"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-risk-low" />
              ) : (
                <Copy className={cn('w-3.5 h-3.5', isUser ? 'text-surface-500' : 'text-surface-400')} />
              )}
            </button>
          )}
        </div>

        {/* Sources — show after streaming done */}
        {!isUser && !isStreaming && sources && sources.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="mt-3 flex flex-wrap gap-2"
          >
            {sources.map((source) => (
              <div
                key={source.clause_id}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cream-100 border border-cream-200 text-xs text-surface-400 hover:border-suits-500/30 hover:text-surface-300 transition-colors cursor-pointer"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Clause {source.clause_id}, p.{source.page}</span>
              </div>
            ))}
          </motion.div>
        )}
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-surface-400 to-surface-600 flex items-center justify-center shrink-0 mt-1">
          <span className="text-white text-xs font-semibold">
            {userName?.[0]?.toUpperCase() || 'U'}
          </span>
        </div>
      )}
    </motion.div>
  )
}
