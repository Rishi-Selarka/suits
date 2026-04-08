import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { easeOutExpo } from '@/lib/motion'

interface SelectCardProps {
  label: string
  sublabel?: string
  icon?: LucideIcon
  emoji?: string
  selected: boolean
  onClick: () => void
  index?: number
}

export default function SelectCard({
  label,
  sublabel,
  icon: Icon,
  emoji,
  selected,
  onClick,
  index = 0,
}: SelectCardProps) {
  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.5, ease: easeOutExpo }}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'relative flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition-all duration-300 cursor-pointer text-center w-full',
        selected
          ? 'border-suits-500 bg-suits-500/10'
          : 'border-surface-300 bg-surface-100/50 hover:border-surface-400 hover:bg-surface-200/50',
      )}
    >
      {/* Selection check */}
      <motion.div
        className="absolute top-3 right-3"
        initial={false}
        animate={{ scale: selected ? 1 : 0, opacity: selected ? 1 : 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      >
        <div className="w-5 h-5 rounded-full bg-suits-500 flex items-center justify-center">
          <Check className="w-3 h-3 text-white" strokeWidth={3} />
        </div>
      </motion.div>

      {/* Icon or emoji */}
      {emoji && <span className="text-3xl">{emoji}</span>}
      {Icon && (
        <div
          className={cn(
            'w-11 h-11 rounded-xl flex items-center justify-center transition-colors duration-300',
            selected ? 'bg-suits-500/20' : 'bg-surface-300/50',
          )}
        >
          <Icon
            className={cn(
              'w-5 h-5 transition-colors duration-300',
              selected ? 'text-suits-400' : 'text-surface-600',
            )}
          />
        </div>
      )}

      {/* Label */}
      <div>
        <p
          className={cn(
            'font-medium text-sm transition-colors duration-300',
            selected ? 'text-suits-300' : 'text-surface-800',
          )}
        >
          {label}
        </p>
        {sublabel && (
          <p className="text-xs text-surface-500 mt-1">{sublabel}</p>
        )}
      </div>
    </motion.button>
  )
}
