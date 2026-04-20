import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
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

  const disabled = loading || !supabaseConfigured

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabaseConfigured) {
      setError(
        'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env.',
      )
      return
    }
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      if (mode === 'signup') {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name: name || email.split('@')[0] } },
        })
        if (err) throw err
        setInfo(
          'Account created. Check your inbox to confirm your email, then sign in.',
        )
        setMode('signin')
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
        // On success the AuthContext session listener will flip the app into the main flow.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    if (!supabaseConfigured) {
      setError(
        'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env.',
      )
      return
    }
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
      setError('Enter your email above, then click Reset password.')
      return
    }
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    if (err) setError(err.message)
    else setInfo('Password reset email sent (if the address is registered).')
  }

  return (
    <div className="fixed inset-0 bg-surface flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: easeOutExpo }}
        className="w-full max-w-sm"
      >
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-display font-semibold text-surface-950">
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-2 text-sm text-surface-700">
            {mode === 'signin'
              ? 'Sign in to continue to Suits AI.'
              : 'Start analysing documents in minutes.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'signup' && (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              autoComplete="name"
              className="w-full px-4 py-3 rounded-xl bg-surface-100 border border-surface-300 text-surface-950 placeholder:text-surface-600 focus:outline-none focus:border-suits-400 transition-colors"
            />
          )}

          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
            className="w-full px-4 py-3 rounded-xl bg-surface-100 border border-surface-300 text-surface-950 placeholder:text-surface-600 focus:outline-none focus:border-suits-400 transition-colors"
          />

          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            className="w-full px-4 py-3 rounded-xl bg-surface-100 border border-surface-300 text-surface-950 placeholder:text-surface-600 focus:outline-none focus:border-suits-400 transition-colors"
          />

          {error && (
            <p className="text-sm text-risk-high">{error}</p>
          )}
          {info && (
            <p className="text-sm text-risk-low">{info}</p>
          )}

          <button
            type="submit"
            disabled={disabled}
            className="w-full px-4 py-3 rounded-xl text-sm font-medium bg-suits-600 text-white hover:bg-suits-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading
              ? 'Please wait…'
              : mode === 'signin'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <div className="flex-1 h-px bg-surface-300" />
          <span className="text-xs text-surface-600">or</span>
          <div className="flex-1 h-px bg-surface-300" />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={disabled}
          className="w-full px-4 py-3 rounded-xl text-sm font-medium bg-surface-100 border border-surface-300 text-surface-950 hover:bg-surface-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Continue with Google
        </button>

        <div className="mt-6 flex items-center justify-between text-xs text-surface-700">
          <button
            type="button"
            onClick={() => {
              setError(null)
              setInfo(null)
              setMode(mode === 'signin' ? 'signup' : 'signin')
            }}
            className="hover:text-surface-950 transition-colors"
          >
            {mode === 'signin' ? 'Create an account' : 'I already have an account'}
          </button>

          {mode === 'signin' && (
            <button
              type="button"
              onClick={handleResetPassword}
              className="hover:text-surface-950 transition-colors"
            >
              Reset password
            </button>
          )}
        </div>

        {!supabaseConfigured && (
          <p className="mt-6 text-center text-xs text-surface-600">
            Supabase env vars are missing. This form is disabled until they're set.
          </p>
        )}
      </motion.div>
    </div>
  )
}
