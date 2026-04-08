import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  MessageSquare,
  FileText,
  Shield,
  AlertTriangle,
  Calendar,
  Timer,
  Eye,
  Swords,
  BookOpen,
  Download,
  Settings,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'
import { useUser } from '@/context/UserContext'
import { cn } from '@/lib/utils'
import { easeOutExpo } from '@/lib/motion'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  onNewChat: () => void
  activeView: string
  onViewChange: (view: string) => void
  onChatSelect?: (chatId: string, documentId?: string) => void
}

interface NavItem {
  id: string
  label: string
  icon: typeof MessageSquare
}

const TOOL_ITEMS: NavItem[] = [
  { id: 'risk-score', label: 'Risk Score', icon: Shield },
  { id: 'simulator', label: 'What Could Go Wrong', icon: AlertTriangle },
  { id: 'deadlines', label: 'Deadline Tracker', icon: Calendar },
  { id: 'timebomb', label: 'Timebomb Clauses', icon: Timer },
  { id: 'trap-detector', label: 'Trap Clause Detector', icon: Eye },
  { id: 'negotiator', label: 'AI vs AI Negotiator', icon: Swords },
]

const RESOURCE_ITEMS: NavItem[] = [
  { id: 'library', label: 'Library & Sources', icon: BookOpen },
  { id: 'downloads', label: 'Downloads', icon: Download },
]

export default function Sidebar({
  collapsed,
  onToggle,
  onNewChat,
  activeView,
  onViewChange,
  onChatSelect,
}: SidebarProps) {
  const { user, chatHistory } = useUser()
  const [toolsOpen, setToolsOpen] = useState(true)
  const [resourcesOpen, setResourcesOpen] = useState(true)

  const sidebarWidth = collapsed ? 64 : 280

  return (
    <motion.aside
      className="h-screen bg-surface-50 border-r border-surface-300/50 flex flex-col sidebar-shadow relative z-20 overflow-hidden"
      animate={{ width: sidebarWidth }}
      transition={{ duration: 0.3, ease: easeOutExpo }}
    >
      {/* ── Header ── */}
      <div className="p-4 flex items-center justify-between shrink-0">
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              className="flex items-center gap-2.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-suits-500 to-suits-700 flex items-center justify-center shrink-0">
                <span className="text-white text-sm font-bold">S</span>
              </div>
              <span className="text-surface-900 font-semibold text-sm tracking-wide">
                SUITS
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={onToggle}
          className="p-1.5 rounded-lg hover:bg-surface-200 transition-colors text-surface-500 hover:text-surface-700"
        >
          {collapsed ? (
            <PanelLeft className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* ── New Chat button ── */}
      <div className="px-3 mb-2 shrink-0">
        <motion.button
          onClick={onNewChat}
          className={cn(
            'w-full flex items-center gap-2.5 rounded-xl border border-surface-300 hover:border-suits-500/50 hover:bg-suits-500/5 transition-all duration-200 text-surface-700 hover:text-surface-900',
            collapsed ? 'p-2.5 justify-center' : 'px-3.5 py-2.5',
          )}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
        >
          <Plus className="w-4 h-4 shrink-0" />
          {!collapsed && <span className="text-sm font-medium">New Chat</span>}
        </motion.button>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
        {/* Recent chats */}
        {!collapsed && chatHistory.length > 0 && (
          <div className="mb-4">
            <p className="px-2 py-2 text-xs font-medium text-surface-500 uppercase tracking-wider">
              Recent
            </p>
            {chatHistory.slice(0, 8).map((chat) => (
              <button
                key={chat.id}
                onClick={() => {
                  onViewChange('chat')
                  onChatSelect?.(chat.id, chat.documentId)
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors duration-150 group',
                  activeView === chat.id
                    ? 'bg-surface-200 text-surface-900'
                    : 'text-surface-600 hover:bg-surface-200/60 hover:text-surface-800',
                )}
              >
                <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-50" />
                <span className="text-sm truncate">{chat.title}</span>
              </button>
            ))}
          </div>
        )}

        {/* Documents */}
        {!collapsed && (
          <button
            onClick={() => onViewChange('documents')}
            className={cn(
              'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors duration-150 mb-4',
              activeView === 'documents'
                ? 'bg-surface-200 text-surface-900'
                : 'text-surface-600 hover:bg-surface-200/60 hover:text-surface-800',
            )}
          >
            <FileText className="w-4 h-4 shrink-0 opacity-60" />
            <span className="text-sm">Documents</span>
          </button>
        )}

        {/* Tools section */}
        <div className="mb-2">
          {!collapsed && (
            <button
              onClick={() => setToolsOpen(!toolsOpen)}
              className="w-full flex items-center justify-between px-2 py-2 text-xs font-medium text-surface-500 uppercase tracking-wider hover:text-surface-600"
            >
              <span>Tools</span>
              <motion.div
                animate={{ rotate: toolsOpen ? 0 : -90 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown className="w-3 h-3" />
              </motion.div>
            </button>
          )}

          <AnimatePresence initial={false}>
            {(toolsOpen || collapsed) && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                {TOOL_ITEMS.map(item => (
                  <button
                    key={item.id}
                    onClick={() => onViewChange(item.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 rounded-lg transition-colors duration-150',
                      collapsed ? 'p-2.5 justify-center' : 'px-2.5 py-2',
                      activeView === item.id
                        ? 'bg-surface-200 text-surface-900'
                        : 'text-surface-600 hover:bg-surface-200/60 hover:text-surface-800',
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    {!collapsed && <span className="text-sm">{item.label}</span>}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Resources section */}
        <div>
          {!collapsed && (
            <button
              onClick={() => setResourcesOpen(!resourcesOpen)}
              className="w-full flex items-center justify-between px-2 py-2 text-xs font-medium text-surface-500 uppercase tracking-wider hover:text-surface-600"
            >
              <span>Resources</span>
              <motion.div
                animate={{ rotate: resourcesOpen ? 0 : -90 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown className="w-3 h-3" />
              </motion.div>
            </button>
          )}

          <AnimatePresence initial={false}>
            {(resourcesOpen || collapsed) && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                {RESOURCE_ITEMS.map(item => (
                  <button
                    key={item.id}
                    onClick={() => onViewChange(item.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 rounded-lg transition-colors duration-150',
                      collapsed ? 'p-2.5 justify-center' : 'px-2.5 py-2',
                      activeView === item.id
                        ? 'bg-surface-200 text-surface-900'
                        : 'text-surface-600 hover:bg-surface-200/60 hover:text-surface-800',
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    {!collapsed && <span className="text-sm">{item.label}</span>}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="p-3 border-t border-surface-300/30 shrink-0">
        <div
          className={cn(
            'flex items-center gap-2.5 rounded-lg p-2',
            collapsed ? 'justify-center' : '',
          )}
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-suits-400 to-suits-600 flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-semibold">
              {user.name?.[0]?.toUpperCase() || 'U'}
            </span>
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-surface-800 truncate">
                  {user.name || 'User'}
                </p>
                <p className="text-xs text-surface-500 truncate capitalize">
                  {user.profession || 'Member'}
                </p>
              </div>
              <button
                onClick={() => onViewChange('settings')}
                className={cn(
                  'p-1.5 rounded-lg transition-colors duration-150 shrink-0',
                  activeView === 'settings'
                    ? 'bg-surface-200 text-surface-900'
                    : 'text-surface-500 hover:bg-surface-200/60 hover:text-surface-800',
                )}
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </motion.aside>
  )
}
