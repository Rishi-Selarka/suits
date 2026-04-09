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
  const [fading, setFading] = useState(false)
  const [videoReady, setVideoReady] = useState(false)

  const handleComplete = useCallback(() => {
    if (fading) return
    setFading(true)
    setTimeout(() => {
      setShow(false)
      setTimeout(onComplete, 100)
    }, 800)
  }, [onComplete, fading])

  // Cut video 1.5s early
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (!video || fading) return
    if (video.duration && video.currentTime >= video.duration - 1.5) {
      handleComplete()
    }
  }, [fading, handleComplete])

  // Fallback: if video fails or doesn't load, skip after a brief pause
  useEffect(() => {
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
          className="fixed inset-0 z-50 bg-cream flex items-center justify-center overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: easeOutExpo }}
        >
          {/* Video — fades in once loaded, scaled up to crop edges */}
          {!videoError && (
            <motion.video
              ref={videoRef}
              src={ASSETS.onboardingVideo}
              className="absolute inset-0 w-full h-full object-cover scale-[1.15] origin-center"
              autoPlay
              muted
              playsInline
              onCanPlay={() => setVideoReady(true)}
              onEnded={handleComplete}
              onTimeUpdate={handleTimeUpdate}
              onError={() => setVideoError(true)}
              initial={{ opacity: 0 }}
              animate={{ opacity: videoReady && !fading ? 1 : 0 }}
              transition={{ duration: fading ? 0.8 : 1.2, ease: 'easeInOut' }}
            />
          )}

          {/* Cream overlay — visible at start, fades out as video appears, fades back in on exit */}
          <motion.div
            className="absolute inset-0 bg-cream pointer-events-none"
            initial={{ opacity: 1 }}
            animate={{ opacity: fading ? 1 : videoReady ? 0 : 1 }}
            transition={{ duration: fading ? 0.8 : 1.2, ease: 'easeInOut' }}
          />

          {/* Fallback: animated brand reveal if no video */}
          {videoError && (
            <motion.div
              className="flex flex-col items-center"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, ease: easeOutExpo }}
            >
              <motion.img
                src="/images/suits-logo.png"
                alt="Suits AI"
                className="w-20 h-20 object-contain mb-6"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: easeOutExpo }}
              />
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.6 }}
                className="text-neutral-900 text-lg tracking-widest uppercase font-semibold"
              >
                Suits AI
              </motion.p>
            </motion.div>
          )}

          {/* Skip button */}
          <motion.button
            onClick={handleComplete}
            className="absolute top-8 right-8 text-white/60 hover:text-white text-sm font-medium tracking-wide transition-colors z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: fading ? 0 : videoReady ? 1 : 0 }}
            transition={{ delay: videoReady ? 0 : 1, duration: 0.5 }}
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
