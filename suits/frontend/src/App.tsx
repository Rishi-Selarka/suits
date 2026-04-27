import { useState, useEffect, useRef, Component, type ErrorInfo, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { UserProvider, useUser } from '@/context/UserContext'
import Welcome from '@/pages/Welcome'
import Home from '@/pages/Home'
import Login from '@/pages/Login'
import { easeOutExpo } from '@/lib/motion'
import { getProfile } from '@/api/client'
import { profileToUserData } from '@/lib/profile'

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

  useEffect(() => {
    if (!user.onboarded) setShowApp(false)
    else setShowApp(true)
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

/**
 * Bridge supabase auth state into UserContext:
 *  - On login: hydrate user.name from auth metadata if not already set.
 *  - On logout: clear local user data so the next signup starts clean.
 */
function AuthUserSync({ children }: { children: ReactNode }) {
  const { user: authUser, enabled } = useAuth()
  const { user, setUser, resetUser } = useUser()
  const lastAuthIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const prevId = lastAuthIdRef.current
    const currId = authUser?.id ?? null

    if (currId && currId !== prevId) {
      // Seed the local cache with whatever the auth metadata gives us so the
      // UI doesn't render an empty name while we wait for the server.
      const metaName =
        (authUser?.user_metadata?.name as string | undefined)?.trim() ||
        authUser?.email?.split('@')[0] ||
        ''
      if (metaName && metaName !== user.name) {
        setUser({ name: metaName })
      }

      // Fetch the canonical profile from the backend and hydrate UserContext.
      // This is what makes the onboarding state survive across devices: the
      // server is the source of truth, localStorage is only a cache.
      void (async () => {
        try {
          const profile = await getProfile()
          setUser(profileToUserData(profile))
        } catch (err) {
          // 401 here means the JWT is stale or auth misconfigured. Stay on
          // the cached state so the user isn't kicked out mid-session.
          console.warn('Profile hydration failed', err)
        }
      })()
    }

    if (!currId && prevId) {
      resetUser()
    }

    lastAuthIdRef.current = currId
  }, [authUser, enabled, user.name, setUser, resetUser])

  return <>{children}</>
}

function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, enabled } = useAuth()

  if (!enabled) return <>{children}</>

  if (loading) {
    return (
      <div className="fixed inset-0 bg-cream flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-neutral-300 border-t-neutral-900 animate-spin" />
      </div>
    )
  }

  if (!user) return <Login />

  return <>{children}</>
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AuthGate>
          <UserProvider>
            <AuthUserSync>
              <AppRouter />
            </AuthUserSync>
          </UserProvider>
        </AuthGate>
      </AuthProvider>
    </ErrorBoundary>
  )
}
