import { motion } from 'framer-motion'
import { BookOpen, ExternalLink } from 'lucide-react'
import { easeOutExpo, staggerContainer, staggerItem } from '@/lib/motion'

const RESOURCES = [
  { category: 'Indian Contract Law', items: [
    { title: 'Indian Contract Act, 1872', desc: 'Foundation of contract law in India' },
    { title: 'Specific Relief Act, 1963', desc: 'Remedies for breach of contract' },
    { title: 'Sale of Goods Act, 1930', desc: 'Commercial sale transactions' },
    { title: 'Indian Stamp Act, 1899', desc: 'Stamp duty on legal documents' },
  ]},
  { category: 'Employment & Tenancy', items: [
    { title: 'Shops & Establishments Act', desc: 'State-level employment regulations' },
    { title: 'Rent Control Acts', desc: 'State-specific tenant protections' },
    { title: 'Industrial Disputes Act, 1947', desc: 'Labour dispute resolution' },
  ]},
  { category: 'Legal Principles', items: [
    { title: 'Section 27 — Restraint of Trade', desc: 'Non-compete clause enforceability' },
    { title: 'Section 73 — Damages', desc: 'Compensation for breach of contract' },
    { title: 'Section 23 — Unlawful Consideration', desc: 'Void agreements and public policy' },
  ]},
]

export default function LibraryPage() {
  return (
    <div className="flex-1 h-screen overflow-y-auto bg-cream">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: easeOutExpo }}
        >
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-suits-500/10 flex items-center justify-center">
              <BookOpen className="w-[18px] h-[18px] text-suits-600" />
            </div>
            <h1 className="text-xl font-semibold text-surface-200">Library & Sources</h1>
          </div>
          <p className="text-sm text-cream-400 mb-8 ml-12">Legal references used by our analysis agents</p>

          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-8">
            {RESOURCES.map((section) => (
              <motion.div key={section.category} variants={staggerItem}>
                <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-3">{section.category}</p>
                <div className="space-y-2">
                  {section.items.map((item) => (
                    <div
                      key={item.title}
                      className="flex items-start gap-3 bg-white rounded-xl border border-cream-200 p-4 hover:shadow-sm transition-shadow"
                    >
                      <ExternalLink className="w-4 h-4 text-suits-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-surface-200">{item.title}</p>
                        <p className="text-xs text-cream-400 mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}
