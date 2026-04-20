import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Read from Vite env (both vars must be set in frontend/.env).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * True when both SUPABASE env vars are present.
 * When false, the app gracefully skips the auth gate — matching the backend's
 * dev-mode fallback so you can run locally without Supabase.
 */
export const supabaseConfigured: boolean = Boolean(url && anonKey)

/**
 * Supabase client. When env is missing, we construct with placeholders so
 * consuming modules don't blow up at import time; callers should gate on
 * `supabaseConfigured` before invoking auth methods.
 */
export const supabase: SupabaseClient = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)

/**
 * Returns the current session's access token, or null.
 * Used by the API client to attach `Authorization: Bearer <jwt>` to requests.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!supabaseConfigured) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
