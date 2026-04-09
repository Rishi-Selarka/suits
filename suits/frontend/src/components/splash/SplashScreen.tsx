import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { easeOutExpo } from '@/lib/motion'

interface SplashScreenProps {
  onContinue: (name: string) => void
}

export default function SplashScreen({ onContinue }: SplashScreenProps) {
  const [name, setName] = useState('')
  const [exiting, setExiting] = useState(false)

  const canContinue = name.trim().length >= 2

  const handleSubmit = () => {
    if (!canContinue) return
    setExiting(true)
    setTimeout(() => onContinue(name.trim()), 800)
  }

  return (
    <AnimatePresence>
      {!exiting ? (
        <motion.div
          className="fixed inset-0 bg-cream flex overflow-hidden"
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.8, ease: easeOutExpo }}
        >
          {/* ── Hero image (left half) ── */}
          <motion.div
            className="hidden lg:block w-1/2 relative"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.2, ease: easeOutExpo }}
          >
            <img
              src="/images/splash-hero.jpg"
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Fade edge into cream */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-cream" />
          </motion.div>

          {/* ── Form area (right half / full on mobile) ── */}
          <div className="flex-1 flex items-center justify-center px-8 lg:px-16 relative z-10">
            <div className="w-full max-w-md">
              {/* Brand mark */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.8, ease: easeOutExpo }}
                className="mb-14"
              >
                <div className="flex items-center gap-3">
                  <img
                    src="/images/suits-logo.png"
                    alt="Suits AI"
                    className="w-10 h-10 object-contain rounded-lg"
                  />
                  <span className="text-neutral-900 text-sm font-semibold tracking-widest uppercase">
                    Suits AI
                  </span>
                </div>
              </motion.div>

              {/* Heading */}
              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.8, ease: easeOutExpo }}
                className="text-4xl lg:text-5xl font-light text-neutral-900 leading-tight mb-3"
              >
                What should we
                <br />
                call you?
              </motion.h1>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7, duration: 0.6 }}
                className="text-neutral-500 text-base mb-10"
              >
                Your legal intelligence, tailored to you.
              </motion.p>

              {/* Name input card */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.9, duration: 0.7, ease: easeOutExpo }}
                className="bg-neutral-900 rounded-2xl p-6"
              >
                <label className="block text-xs font-medium text-neutral-400 uppercase tracking-wider mb-3">
                  Your name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  placeholder="Enter your name"
                  autoFocus
                  className="w-full bg-neutral-800 text-lg text-white placeholder:text-neutral-500 rounded-xl px-4 py-3 outline-none border border-neutral-700 focus:border-neutral-500 transition-colors duration-300 caret-white"
                />

                {/* Continue button */}
                <motion.button
                  onClick={handleSubmit}
                  disabled={!canContinue}
                  className="w-full mt-4 flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-cream text-neutral-900 font-semibold text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:bg-cream-100 active:scale-[0.98] transition-all duration-200"
                  whileTap={canContinue ? { scale: 0.98 } : {}}
                >
                  <span>Continue</span>
                  <ArrowRight className="w-4 h-4" />
                </motion.button>
              </motion.div>

              {/* Footer hint */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.2, duration: 0.6 }}
                className="text-xs text-neutral-400 mt-6 text-center"
              >
                Powered by multi-agent AI with 6 specialized models
              </motion.p>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
