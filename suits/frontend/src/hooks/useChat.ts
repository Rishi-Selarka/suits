import { useState, useCallback } from 'react'
import { type ChatResponse, chatWithDocument } from '@/api/client'
import { type ChatMessage } from '@/context/UserContext'

export function useChat(documentId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: content.trim(),
        timestamp: Date.now(),
      }

      setMessages(prev => [...prev, userMsg])
      setIsLoading(true)
      setError(null)

      try {
        const response = await chatWithDocument(documentId, content.trim())

        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.answer,
          sources: response.source_clauses,
          timestamp: Date.now(),
        }

        setMessages(prev => [...prev, assistantMsg])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to get response')
      } finally {
        setIsLoading(false)
      }
    },
    [documentId],
  )

  const clearChat = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearChat,
  }
}
