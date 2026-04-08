import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export interface UserData {
  name: string
  location: string
  profession: string
  purpose: string
  onboarded: boolean
}

interface ChatHistoryItem {
  id: string
  title: string
  documentId?: string
  createdAt: number
  lastMessage?: string
}

interface UserContextType {
  user: UserData
  setUser: (data: Partial<UserData>) => void
  resetUser: () => void
  chatHistory: ChatHistoryItem[]
  addChat: (chat: ChatHistoryItem) => void
  removeChat: (id: string) => void
}

const STORAGE_KEY = 'suits-user'
const CHAT_HISTORY_KEY = 'suits-chats'

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

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserData>(loadUser)
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>(loadChats)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  }, [user])

  useEffect(() => {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatHistory))
  }, [chatHistory])

  const setUser = (data: Partial<UserData>) => {
    setUserState(prev => ({ ...prev, ...data }))
  }

  const resetUser = () => {
    setUserState(defaultUser)
    setChatHistory([])
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(CHAT_HISTORY_KEY)
  }

  const addChat = (chat: ChatHistoryItem) => {
    setChatHistory(prev => [chat, ...prev])
  }

  const removeChat = (id: string) => {
    setChatHistory(prev => prev.filter(c => c.id !== id))
  }

  return (
    <UserContext.Provider value={{ user, setUser, resetUser, chatHistory, addChat, removeChat }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  const context = useContext(UserContext)
  if (!context) throw new Error('useUser must be used within UserProvider')
  return context
}
