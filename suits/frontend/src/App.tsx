import { useState, useEffect, Component, type ErrorInfo, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { UserProvider, useUser } from '@/context/UserContext'
import Welcome from '@/pages/Welcome'
import Home from '@/pages/Home'
import { easeOutExpo } from '@/lib/motion'

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-cream gap-4">
          <p className="text-lg font-semibold text-surface-200">Something went wrong</p>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-xl text-sm font-medium bg-suits-600 text-white hover:bg-suits-500 transition-colors"
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

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
    <ErrorBoundary>
      <UserProvider>
        <AppRouter />
      </UserProvider>
    </ErrorBoundary>
  )
}
