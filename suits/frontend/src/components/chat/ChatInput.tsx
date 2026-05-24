import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowUp, Paperclip, Square, X, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  onSend: (message: string) => void
  onUpload?: () => void
  onStop?: () => void
  attachedFile?: File | null
  onRemoveAttachment?: () => void
  onAnalyzeAttachment?: () => void
  disabled?: boolean
  isStreaming?: boolean
  placeholder?: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function ChatInput({
  onSend,
  onUpload,
  onStop,
  attachedFile,
  onRemoveAttachment,
  onAnalyzeAttachment,
  disabled = false,
  isStreaming = false,
  placeholder = 'Ask anything about your document...',
}: ChatInputProps) {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const hasAttachment = !!attachedFile
  const canSend = (message.trim().length > 0 || hasAttachment) && !disabled

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
    }
  }, [message])

  const handleSend = () => {
    if (isStreaming) {
      onStop?.()
      return
    }
    if (!canSend) return
    if (hasAttachment) {
      // The analyze flow doesn't currently take a question — discard any
      // typed text so the user isn't surprised by it disappearing into the
      // ether during analysis.
      onAnalyzeAttachment?.()
      setMessage('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      return
    }
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

  const sendDisabled = !isStreaming && !canSend

  return (
    <div className="px-6 pb-6 pt-2">
      <div className="max-w-3xl mx-auto">
        {/* Staged attachment chip — sits above the input so it's obvious
            nothing has been uploaded or processed yet. */}
        {hasAttachment && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-2 flex items-center justify-between gap-3 bg-suits-500/5 border border-suits-500/20 rounded-xl px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-suits-500/10 flex items-center justify-center shrink-0">
                <FileText className="w-3.5 h-3.5 text-suits-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-surface-200 truncate">
                  {attachedFile!.name}
                </p>
                <p className="text-[11px] text-cream-400">
                  {formatBytes(attachedFile!.size)} · Press send to analyze
                </p>
              </div>
            </div>
            <button
              onClick={onRemoveAttachment}
              className="p-1.5 rounded-md text-cream-400 hover:text-surface-200 hover:bg-cream-200/60 transition-colors shrink-0"
              title="Remove attachment"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}

        <div className="flex items-center gap-2 bg-cream border border-cream-300 rounded-2xl px-4 py-3 shadow-sm focus-within:border-suits-500/40 focus-within:shadow-md transition-all duration-300">
          {/* Attachment */}
          {onUpload && (
            <button
              onClick={onUpload}
              disabled={disabled || hasAttachment}
              className="p-1.5 rounded-lg text-surface-400 hover:text-surface-300 hover:bg-cream-100 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              title={hasAttachment ? 'Remove current attachment first' : 'Attach a document'}
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
            placeholder={
              hasAttachment
                ? 'Press send to analyze this document'
                : placeholder
            }
            disabled={disabled || hasAttachment}
            rows={1}
            className="flex-1 bg-transparent text-surface-200 placeholder:text-cream-400 text-[15px] leading-relaxed outline-none resize-none overflow-hidden disabled:opacity-50"
          />

          {/* Send / Stop button */}
          <motion.button
            onClick={handleSend}
            disabled={sendDisabled}
            className={cn(
              'p-2 rounded-xl transition-all duration-200 shrink-0',
              isStreaming || canSend
                ? 'bg-surface-200 text-cream hover:bg-surface-300'
                : 'bg-cream-200 text-cream-400 cursor-not-allowed',
            )}
            whileHover={!sendDisabled ? { scale: 1.05 } : {}}
            whileTap={!sendDisabled ? { scale: 0.95 } : {}}
            title={isStreaming ? 'Stop generating' : hasAttachment ? 'Analyze document' : 'Send'}
            aria-label={isStreaming ? 'Stop generating' : 'Send message'}
          >
            {isStreaming ? (
              <Square className="w-3.5 h-3.5 fill-current" />
            ) : (
              <ArrowUp className="w-4 h-4" />
            )}
          </motion.button>
        </div>

        <p className="text-center text-xs text-cream-400 mt-2.5">
          Suits AI is an analytical tool, not legal advice. Always consult a qualified lawyer.
        </p>
      </div>
    </div>
  )
}
