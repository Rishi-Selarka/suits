import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'

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
  sources?: { clause_id: number; title?: string; text?: string; page: number }[]
  timestamp?: number
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

export interface DownloadItem {
  id: string
  documentId: string
  filename: string
  exportType: string
  exportLabel: string
  downloadedAt: number
}

type UserUpdater = Partial<UserData> | ((prev: UserData) => Partial<UserData>)

interface UserContextType {
  user: UserData
  setUser: (data: UserUpdater) => void
  resetUser: () => void
  chatHistory: ChatHistoryItem[]
  addChat: (chat: ChatHistoryItem) => void
  removeChat: (id: string) => void
  documents: DocumentItem[]
  addDocument: (doc: DocumentItem) => void
  downloads: DownloadItem[]
  addDownload: (dl: DownloadItem) => void
}

const STORAGE_KEY = 'suits-user'
const CHAT_HISTORY_KEY = 'suits-chats'
const DOCUMENTS_KEY = 'suits-documents'
const DOWNLOADS_KEY = 'suits-downloads'
const OWNER_KEY = 'suits-owner'

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

function loadDownloads(): DownloadItem[] {
  try {
    const stored = localStorage.getItem(DOWNLOADS_KEY)
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }
  return []
}

function clearLocalStorage() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(CHAT_HISTORY_KEY)
  localStorage.removeItem(DOCUMENTS_KEY)
  localStorage.removeItem(DOWNLOADS_KEY)
}

export function UserProvider({ children }: { children: ReactNode }) {
  const { user: authUser, enabled: authEnabled } = useAuth()
  const ownerId = authEnabled ? authUser?.id ?? null : 'local'

  // If stored data belongs to a different account, wipe it before first read.
  // Runs synchronously on mount so initial state below sees the clean slate.
  if (typeof window !== 'undefined' && ownerId) {
    const storedOwner = localStorage.getItem(OWNER_KEY)
    if (storedOwner && storedOwner !== ownerId) {
      clearLocalStorage()
    }
    if (storedOwner !== ownerId) {
      localStorage.setItem(OWNER_KEY, ownerId)
    }
  }

  const [user, setUserState] = useState<UserData>(loadUser)
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>(loadChats)
  const [documents, setDocuments] = useState<DocumentItem[]>(loadDocuments)
  const [downloads, setDownloads] = useState<DownloadItem[]>(loadDownloads)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  }, [user])

  useEffect(() => {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatHistory))
  }, [chatHistory])

  useEffect(() => {
    localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(documents))
  }, [documents])

  useEffect(() => {
    localStorage.setItem(DOWNLOADS_KEY, JSON.stringify(downloads))
  }, [downloads])

  const setUser = (data: UserUpdater) => {
    setUserState(prev => ({ ...prev, ...(typeof data === 'function' ? data(prev) : data) }))
  }

  const resetUser = () => {
    setUserState(defaultUser)
    setChatHistory([])
    setDocuments([])
    setDownloads([])
    clearLocalStorage()
    localStorage.removeItem(OWNER_KEY)
  }

  const addChat = useCallback((chat: ChatHistoryItem) => {
    setChatHistory(prev => {
      const idx = prev.findIndex(c => c.id === chat.id)
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = {
          ...updated[idx],
          ...chat,
          // Preserve original title and creation time on updates
          title: chat.title || updated[idx].title,
          createdAt: updated[idx].createdAt,
        }
        const [item] = updated.splice(idx, 1)
        return [item, ...updated].slice(0, 20)
      }
      return [chat, ...prev].slice(0, 20)
    })
  }, [])

  const removeChat = useCallback((id: string) => {
    setChatHistory(prev => prev.filter(c => c.id !== id))
  }, [])

  const addDocument = useCallback((doc: DocumentItem) => {
    setDocuments(prev => {
      const existing = prev.findIndex(d => d.id === doc.id)
      if (existing >= 0) {
        const updated = [...prev]
        updated[existing] = doc
        return updated
      }
      return [doc, ...prev]
    })
  }, [])

  const addDownload = useCallback((dl: DownloadItem) => {
    setDownloads(prev => [dl, ...prev].slice(0, 50))
  }, [])

  const value = useMemo(() => ({
    user, setUser, resetUser, chatHistory, addChat, removeChat, documents, addDocument, downloads, addDownload,
  }), [user, setUser, resetUser, chatHistory, addChat, removeChat, documents, addDocument, downloads, addDownload])

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  const context = useContext(UserContext)
  if (!context) throw new Error('useUser must be used within UserProvider')
  return context
}
