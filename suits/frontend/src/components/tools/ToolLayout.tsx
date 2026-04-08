import { motion } from 'framer-motion'
import { Upload } from 'lucide-react'
import { easeOutExpo } from '@/lib/motion'
import type { AnalysisResult } from '@/api/client'

interface ToolLayoutProps {
  title: string
  description: string
  icon: typeof Upload
  result: AnalysisResult | null
  children: React.ReactNode
}

export default function ToolLayout({ title, description, icon: Icon, result, children }: ToolLayoutProps) {
  return (
    <div className="flex-1 h-screen overflow-y-auto bg-cream">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: easeOutExpo }}
        >
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-suits-500/10 flex items-center justify-center">
              <Icon className="w-[18px] h-[18px] text-suits-600" />
            </div>
            <h1 className="text-xl font-semibold text-surface-200">{title}</h1>
          </div>
          <p className="text-sm text-cream-400 mb-8 ml-12">{description}</p>

          {!result ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-cream-200 flex items-center justify-center mb-4">
                <Upload className="w-6 h-6 text-cream-400" />
              </div>
              <p className="text-surface-300 font-medium mb-1">No document analyzed yet</p>
              <p className="text-cream-400 text-sm">Upload and analyze a document to use this tool</p>
            </div>
          ) : (
            children
          )}
        </motion.div>
      </div>
    </div>
  )
}
