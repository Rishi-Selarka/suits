import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ASSETS } from '@/lib/assets'
import { easeOutExpo } from '@/lib/motion'

interface OnboardingVideoProps {
  onComplete: () => void
}

export default function OnboardingVideo({ onComplete }: OnboardingVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [show, setShow] = useState(true)
  const [videoError, setVideoError] = useState(false)

  const handleComplete = useCallback(() => {
    setShow(false)
    setTimeout(onComplete, 600)
  }, [onComplete])

  useEffect(() => {
    // If no video available, skip after a brief dramatic pause
    const timeout = setTimeout(() => {
      if (videoError || !videoRef.current?.src) {
        handleComplete()
      }
    }, 2500)
    return () => clearTimeout(timeout)
  }, [videoError, handleComplete])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-50 bg-surface flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.05 }}
          transition={{ duration: 0.6, ease: easeOutExpo }}
        >
          {/* Video */}
          {!videoError && (
            <video
              ref={videoRef}
              src={ASSETS.onboardingVideo}
              className="absolute inset-0 w-full h-full object-cover"
              autoPlay
              muted
              playsInline
              onEnded={handleComplete}
              onError={() => setVideoError(true)}
            />
          )}

          {/* Fallback: animated brand reveal if no video */}
          {videoError && (
            <motion.div
              className="flex flex-col items-center"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, ease: easeOutExpo }}
            >
              <motion.div
                className="w-20 h-20 rounded-2xl bg-gradient-to-br from-suits-500 to-suits-700 flex items-center justify-center mb-6"
                animate={{
                  boxShadow: [
                    '0 0 0px rgba(92, 124, 250, 0)',
                    '0 0 60px rgba(92, 124, 250, 0.4)',
                    '0 0 0px rgba(92, 124, 250, 0)',
                  ],
                }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <span className="text-white text-3xl font-bold">S</span>
              </motion.div>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.6 }}
                className="text-surface-600 text-lg tracking-widest uppercase"
              >
                Suits AI
              </motion.p>
            </motion.div>
          )}

          {/* Vignette overlay */}
          <div className="absolute inset-0 video-vignette pointer-events-none" />

          {/* Skip button */}
          <motion.button
            onClick={handleComplete}
            className="absolute top-8 right-8 text-surface-500 hover:text-surface-700 text-sm font-medium tracking-wide transition-colors z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 0.5 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Skip
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
