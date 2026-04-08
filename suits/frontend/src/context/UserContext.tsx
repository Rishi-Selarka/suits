import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export interface UserData {
  name: string
  location: string
  profession: string
  purpose: string
  onboarded: boolean
  avatar?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export interface ChatHistoryItem {
  id: string
  title: string
  documentId?: string
  createdAt: number
  lastMessage?: string
  messages?: ChatMessage[]
}

export interface DocumentItem {
  id: string
  filename: string
  uploadedAt: number
  analyzed: boolean
}

interface UserContextType {
  user: UserData
  setUser: (data: Partial<UserData>) => void
  resetUser: () => void
  chatHistory: ChatHistoryItem[]
  addChat: (chat: ChatHistoryItem) => void
  removeChat: (id: string) => void
  documents: DocumentItem[]
  addDocument: (doc: DocumentItem) => void
}

const STORAGE_KEY = 'suits-user'
const CHAT_HISTORY_KEY = 'suits-chats'
const DOCUMENTS_KEY = 'suits-documents'

const defaultUser: UserData = {
  name: '',
  location: '',
  profession: '',
  purpose: '',
  onboarded: false,
}

const UserContext = createContext<UserContextType | null>(null)

function loadUser(): UserData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return { ...defaultUser, ...JSON.parse(stored) }
  } catch { /* ignore */ }
  return defaultUser
}

function loadChats(): ChatHistoryItem[] {
  try {
    const stored = localStorage.getItem(CHAT_HISTORY_KEY)
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }
  return []
}

function loadDocuments(): DocumentItem[] {
  try {
    const stored = localStorage.getItem(DOCUMENTS_KEY)
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }
  return []
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserData>(loadUser)
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>(loadChats)
  const [documents, setDocuments] = useState<DocumentItem[]>(loadDocuments)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  }, [user])

  useEffect(() => {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatHistory))
  }, [chatHistory])

  useEffect(() => {
    localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(documents))
  }, [documents])

  const setUser = (data: Partial<UserData>) => {
    setUserState(prev => ({ ...prev, ...data }))
  }

  const resetUser = () => {
    setUserState(defaultUser)
    setChatHistory([])
    setDocuments([])
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(CHAT_HISTORY_KEY)
    localStorage.removeItem(DOCUMENTS_KEY)
  }

  const addChat = (chat: ChatHistoryItem) => {
    setChatHistory(prev => {
      const idx = prev.findIndex(c => c.id === chat.id)
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = { ...updated[idx], ...chat }
        const [item] = updated.splice(idx, 1)
        return [item, ...updated].slice(0, 20)
      }
      return [chat, ...prev].slice(0, 20)
    })
  }

  const removeChat = (id: string) => {
    setChatHistory(prev => prev.filter(c => c.id !== id))
  }

  const addDocument = (doc: DocumentItem) => {
    setDocuments(prev => {
      const existing = prev.findIndex(d => d.id === doc.id)
      if (existing >= 0) {
        const updated = [...prev]
        updated[existing] = doc
        return updated
      }
      return [doc, ...prev]
    })
  }

  return (
    <UserContext.Provider value={{ user, setUser, resetUser, chatHistory, addChat, removeChat, documents, addDocument }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  const context = useContext(UserContext)
  if (!context) throw new Error('useUser must be used within UserProvider')
  return context
}
