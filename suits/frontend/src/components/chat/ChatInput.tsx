import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowUp, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  onSend: (message: string) => void
  onUpload?: () => void
  disabled?: boolean
  placeholder?: string
}

export default function ChatInput({
  onSend,
  onUpload,
  disabled = false,
  placeholder = 'Ask anything about your document...',
}: ChatInputProps) {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const canSend = message.trim().length > 0 && !disabled

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
    }
  }, [message])

  const handleSend = () => {
    if (!canSend) return
    onSend(message.trim())
    setMessage('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="px-6 pb-6 pt-2">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 bg-cream border border-cream-300 rounded-2xl px-4 py-3 shadow-sm focus-within:border-suits-500/40 focus-within:shadow-md transition-all duration-300">
          {/* Attachment */}
          {onUpload && (
            <button
              onClick={onUpload}
              className="p-1.5 rounded-lg text-surface-400 hover:text-surface-300 hover:bg-cream-100 transition-colors shrink-0"
            >
              <Paperclip className="w-[18px] h-[18px]" />
            </button>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="flex-1 bg-transparent text-surface-200 placeholder:text-cream-400 text-[15px] leading-relaxed outline-none resize-none overflow-hidden disabled:opacity-50"
          />

          {/* Send button */}
          <motion.button
            onClick={handleSend}
            disabled={!canSend}
            className={cn(
              'p-2 rounded-xl transition-all duration-200 shrink-0',
              canSend
                ? 'bg-surface-200 text-cream hover:bg-surface-300'
                : 'bg-cream-200 text-cream-400 cursor-not-allowed',
            )}
            whileHover={canSend ? { scale: 1.05 } : {}}
            whileTap={canSend ? { scale: 0.95 } : {}}
          >
            <ArrowUp className="w-4 h-4" />
          </motion.button>
        </div>

        <p className="text-center text-xs text-cream-400 mt-2.5">
          Suits AI is an analytical tool, not legal advice. Always consult a qualified lawyer.
        </p>
      </div>
    </div>
  )
}
