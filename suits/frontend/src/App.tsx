import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { UserProvider, useUser } from '@/context/UserContext'
import Welcome from '@/pages/Welcome'
import Home from '@/pages/Home'
import { easeOutExpo } from '@/lib/motion'

function AppRouter() {
  const { user } = useUser()
  const [showApp, setShowApp] = useState(user.onboarded)

  // React to logout: when user.onboarded becomes false, go back to splash
  useEffect(() => {
    if (!user.onboarded) setShowApp(false)
  }, [user.onboarded])

  const handleOnboardingComplete = () => {
    setShowApp(true)
  }

  return (
    <div className="min-h-screen">
      <AnimatePresence mode="wait">
        {!showApp ? (
          <motion.div
            key="welcome"
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.5, ease: easeOutExpo }}
          >
            <Welcome onComplete={handleOnboardingComplete} />
          </motion.div>
        ) : (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, ease: easeOutExpo }}
          >
            <Home />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function App() {
  return (
    <UserProvider>
      <AppRouter />
    </UserProvider>
  )
}
