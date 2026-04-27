import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { easeOutExpo } from '@/lib/motion'

type Mode = 'signin' | 'signup'

export default function Login() {
  const [mode, setMode] = useState<Mode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const isSignup = mode === 'signup'
  const nameValid = !isSignup || name.trim().length >= 2
  const canSubmit = supabaseConfigured && nameValid && email.length > 0 && password.length >= 6

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabaseConfigured) {
      setError('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env.')
      return
    }
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      if (isSignup) {
        const trimmedName = name.trim()
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name: trimmedName },
            emailRedirectTo: window.location.origin,
          },
        })
        if (err) throw err
        if (data.session) {
          // Email confirmation off — session is live, AuthContext will route us in.
          return
        }
        setInfo('Account created. Check your inbox to confirm your email, then sign in.')
        setMode('signin')
        setName('')
        setPassword('')
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    if (!supabaseConfigured) return
    setError(null)
    setInfo(null)
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (err) setError(err.message)
  }

  const handleResetPassword = async () => {
    if (!email) {
      setError('Enter your email above, then click Forgot password.')
      return
    }
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    if (err) setError(err.message)
    else setInfo('Password reset email sent (if the address is registered).')
  }

  const switchMode = () => {
    setError(null)
    setInfo(null)
    setMode(isSignup ? 'signin' : 'signup')
  }

  return (
    <motion.div
      className="fixed inset-0 bg-cream flex overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: easeOutExpo }}
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
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-cream" />
      </motion.div>

      {/* ── Form area ── */}
      <div className="flex-1 flex items-center justify-center px-8 lg:px-16 relative z-10 py-12 overflow-y-auto">
        <div className="w-full max-w-md">
          {/* Brand mark */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.8, ease: easeOutExpo }}
            className="mb-12"
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
            key={mode + '-h'}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: easeOutExpo }}
            className="text-4xl lg:text-5xl font-light text-neutral-900 leading-tight mb-3"
          >
            {isSignup ? (
              <>Create your<br />account</>
            ) : (
              <>Welcome<br />back</>
            )}
          </motion.h1>

          <motion.p
            key={mode + '-p'}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.5 }}
            className="text-neutral-500 text-base mb-8"
          >
            {isSignup
              ? 'Your legal intelligence, tailored to you.'
              : 'Sign in to continue to Suits AI.'}
          </motion.p>

          {/* Form card */}
          <motion.form
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.7, ease: easeOutExpo }}
            className="bg-neutral-900 rounded-2xl p-6 space-y-4"
          >
            {isSignup && (
              <div>
                <label className="block text-xs font-medium text-neutral-400 uppercase tracking-wider mb-2">
                  Your name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="What should we call you?"
                  autoComplete="name"
                  autoFocus
                  className="w-full bg-neutral-800 text-base text-white placeholder:text-neutral-500 rounded-xl px-4 py-3 outline-none border border-neutral-700 focus:border-neutral-500 transition-colors duration-300 caret-white"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-neutral-400 uppercase tracking-wider mb-2">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                autoFocus={!isSignup}
                className="w-full bg-neutral-800 text-base text-white placeholder:text-neutral-500 rounded-xl px-4 py-3 outline-none border border-neutral-700 focus:border-neutral-500 transition-colors duration-300 caret-white"
              />
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-2">
                <label className="block text-xs font-medium text-neutral-400 uppercase tracking-wider">
                  Password
                </label>
                {!isSignup && (
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
                  >
                    Forgot?
                  </button>
                )}
              </div>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignup ? 'At least 6 characters' : 'Your password'}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                className="w-full bg-neutral-800 text-base text-white placeholder:text-neutral-500 rounded-xl px-4 py-3 outline-none border border-neutral-700 focus:border-neutral-500 transition-colors duration-300 caret-white"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}
            {info && (
              <p className="text-sm text-green-400">{info}</p>
            )}

            <motion.button
              type="submit"
              disabled={!canSubmit || loading}
              className="w-full mt-2 flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-cream text-neutral-900 font-semibold text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:bg-cream-100 active:scale-[0.98] transition-all duration-200"
              whileTap={canSubmit && !loading ? { scale: 0.98 } : {}}
            >
              <span>
                {loading
                  ? 'Please wait…'
                  : isSignup
                    ? 'Create account'
                    : 'Sign in'}
              </span>
              {!loading && <ArrowRight className="w-4 h-4" />}
            </motion.button>

            <div className="flex items-center gap-3 pt-1">
              <div className="flex-1 h-px bg-neutral-700" />
              <span className="text-xs text-neutral-500 uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-neutral-700" />
            </div>

            <button
              type="button"
              onClick={handleGoogle}
              disabled={loading || !supabaseConfigured}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-100 text-sm font-medium hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.46-1.74 4.27-5.5 4.27a6.4 6.4 0 1 1 0-12.8 5.84 5.84 0 0 1 4.13 1.6l2.81-2.71A9.78 9.78 0 0 0 12 1.6 10.4 10.4 0 1 0 22.4 12c0-.7-.07-1.23-.16-1.8H12z" />
              </svg>
              <span>Continue with Google</span>
            </button>
          </motion.form>

          {/* Mode toggle */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="mt-6 text-center text-sm text-neutral-500"
          >
            {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={switchMode}
              className="text-neutral-900 font-medium hover:underline"
            >
              {isSignup ? 'Sign in' : 'Create one'}
            </button>
          </motion.div>

          {!supabaseConfigured && (
            <p className="mt-6 text-center text-xs text-neutral-500">
              Supabase env vars are missing. This form is disabled until they're set.
            </p>
          )}
        </div>
      </div>
    </motion.div>
  )
}
