import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'

export interface UserData {
  name: string
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

type UserUpdater = Partial<UserData> | ((prev: UserData) => Partial<UserData>)

interface UserContextType {
  user: UserData
  setUser: (data: UserUpdater) => void
  resetUser: () => void
  chatHistory: ChatHistoryItem[]
  addChat: (chat: ChatHistoryItem) => void
  removeChat: (id: string) => void
}

// localStorage keys still in active use:
//   STORAGE_KEY   — paint cache for {name, onboarded, avatar} so the UI doesn't
//                   flash a loading state while /api/profile resolves on cold load.
//   OWNER_KEY     — guards against the previous user's cache leaking when
//                   another account signs in on the same browser.
//   CHAT_HISTORY  — sidebar chat list. Still local-only; moving it server-side
//                   is a separate effort because it's tangled with the live
//                   SSE chat streaming flow.
//
// Removed keys (now server-backed via /api/documents and /api/downloads):
//   - suits-documents
//   - suits-downloads
const STORAGE_KEY = 'suits-user'
const CHAT_HISTORY_KEY = 'suits-chats'
const OWNER_KEY = 'suits-owner'
// Stale keys cleaned up on mount so existing users don't carry forward megabytes
// of dead localStorage from the pre-migration version of the app.
const LEGACY_KEYS = ['suits-documents', 'suits-downloads'] as const

const defaultUser: UserData = {
  name: '',
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

function clearLocalStorage() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(CHAT_HISTORY_KEY)
  for (const k of LEGACY_KEYS) localStorage.removeItem(k)
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
    // Drop pre-migration keys for the current owner too — these used to hold
    // documents/downloads as the source of truth and now just waste space.
    for (const k of LEGACY_KEYS) localStorage.removeItem(k)
  }

  const [user, setUserState] = useState<UserData>(loadUser)
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>(loadChats)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  }, [user])

  useEffect(() => {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatHistory))
  }, [chatHistory])

  const setUser = (data: UserUpdater) => {
    setUserState(prev => ({ ...prev, ...(typeof data === 'function' ? data(prev) : data) }))
  }

  const resetUser = () => {
    setUserState(defaultUser)
    setChatHistory([])
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

  const value = useMemo(() => ({
    user, setUser, resetUser, chatHistory, addChat, removeChat,
  }), [user, setUser, resetUser, chatHistory, addChat, removeChat])

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
