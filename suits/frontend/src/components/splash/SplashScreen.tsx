import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { ASSETS } from '@/lib/assets'
import { easeOutExpo } from '@/lib/motion'

interface SplashScreenProps {
  onContinue: (name: string) => void
}

export default function SplashScreen({ onContinue }: SplashScreenProps) {
  const [name, setName] = useState('')
  const [imageLoaded, setImageLoaded] = useState(false)
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
          className="fixed inset-0 bg-surface flex overflow-hidden"
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.8, ease: easeOutExpo }}
        >
          {/* ── Background image layer ── */}
          <div className="absolute inset-0 w-[60%] h-full hidden lg:block">
            <motion.img
              src={ASSETS.splashHero}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              initial={{ scale: 1.08, opacity: 0 }}
              animate={{
                scale: imageLoaded ? 1 : 1.08,
                opacity: imageLoaded ? 1 : 0,
              }}
              transition={{ duration: 2.2, ease: easeOutExpo }}
              onLoad={() => setImageLoaded(true)}
            />

            {/* Right edge fade — image melts into the dark surface */}
            <div className="absolute inset-0 splash-mask" />

            {/* Warm cinematic tint overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-suits-950/40 via-transparent to-surface/50 mix-blend-multiply" />

            {/* Bottom vignette for depth */}
            <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-transparent" />

            {/* Top vignette — subtle */}
            <div className="absolute inset-0 bg-gradient-to-b from-surface/50 via-transparent to-transparent" />

            {/* Subtle blue accent glow at the fade edge */}
            <motion.div
              className="absolute top-0 right-0 w-1/3 h-full bg-gradient-to-l from-suits-600/8 to-transparent"
              initial={{ opacity: 0 }}
              animate={{ opacity: imageLoaded ? 1 : 0 }}
              transition={{ duration: 2, delay: 0.5 }}
            />
          </div>

          {/* ── Mobile: subtle background glow instead of image ── */}
          <div className="absolute inset-0 lg:hidden">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-suits-600/8 rounded-full blur-[120px]" />
          </div>

          {/* ── Right: Name input area ── */}
          <div className="flex-1 flex items-center justify-center px-8 lg:px-16 relative z-10 lg:ml-[40%]">
            {/* Ambient glow behind form */}
            <motion.div
              className="absolute top-1/3 right-1/4 w-96 h-96 bg-suits-600/5 rounded-full blur-3xl pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 2, delay: 1 }}
            />

            <div className="w-full max-w-md relative z-10">
              {/* Brand mark */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.8, ease: easeOutExpo }}
                className="mb-16"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-suits-500 to-suits-700 flex items-center justify-center shadow-lg shadow-suits-500/20">
                    <span className="text-white text-sm font-bold">S</span>
                  </div>
                  <span className="text-surface-600 text-sm font-medium tracking-widest uppercase">
                    Suits AI
                  </span>
                </div>
              </motion.div>

              {/* Heading */}
              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.8, ease: easeOutExpo }}
                className="text-4xl lg:text-5xl font-light text-surface-800 leading-tight mb-4"
              >
                What would you like
                <br />
                us to call you?
              </motion.h1>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7, duration: 0.6 }}
                className="text-surface-500 text-lg mb-12"
              >
                Your legal intelligence, tailored to you.
              </motion.p>

              {/* Name input */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.9, duration: 0.7, ease: easeOutExpo }}
              >
                <div className="relative group">
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                    placeholder="Enter your name"
                    autoFocus
                    className="w-full bg-transparent text-2xl text-surface-900 font-light placeholder:text-surface-400 border-b-2 border-surface-300 focus:border-suits-500 pb-4 outline-none transition-colors duration-500 caret-suits-500"
                  />
                  <motion.div
                    className="absolute bottom-0 left-0 h-0.5 bg-suits-500"
                    initial={{ width: '0%' }}
                    animate={{ width: name ? '100%' : '0%' }}
                    transition={{ duration: 0.4, ease: easeOutExpo }}
                  />
                </div>
              </motion.div>

              {/* Continue button */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.1, duration: 0.6 }}
                className="mt-12"
              >
                <motion.button
                  onClick={handleSubmit}
                  disabled={!canContinue}
                  className="group flex items-center gap-3 text-lg font-medium disabled:opacity-30 disabled:cursor-not-allowed transition-opacity duration-300"
                  whileHover={canContinue ? { x: 4 } : {}}
                  whileTap={canContinue ? { scale: 0.98 } : {}}
                >
                  <span className="text-surface-800">Continue</span>
                  <motion.div
                    animate={canContinue ? { x: [0, 4, 0] } : {}}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <ArrowRight className="w-5 h-5 text-suits-500" />
                  </motion.div>
                </motion.button>
              </motion.div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
