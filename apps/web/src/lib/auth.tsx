import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { authStore, type AuthState, type LinkState } from './auth-store'

/**
 * React binding over the vanilla `authStore` (spec §3.2). Exposes the session
 * status + the `signIn`/`signOut` actions. Navigation/query-purge on sign-out is
 * wired once in `main.tsx` via `authStore.setOnSignedOut`, so the provider stays
 * free of router/query dependencies.
 */

export interface AuthContextValue {
  status: AuthState['status']
  user: User | null
  email: string | null
  /** Generic result — GoTrue does not distinguish unknown email vs wrong password. */
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  /**
   * Register a new account (spec BYOK §2). With email confirmation ON, GoTrue
   * returns NO session — the user must click the confirmation link — and, for
   * anti-enumeration, does NOT error when the email already exists. So on
   * `error: null` the caller shows a neutral "check your email" screen. `status`
   * (422 weak password, 429 rate limit) lets the caller map actionable errors.
   */
  signUp: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null; status: number | null }>
  signOut: () => Promise<void>
  /**
   * Send a password-reset email (public "forgot password" flow). The recovery
   * link lands on the site root with a `type=recovery` fragment, which
   * `captureAuthLink` → `init()` promotes into the EXISTING set-password gate.
   * Always resolves `error: null` on the happy path; the caller shows a neutral
   * "email sent" screen regardless (anti-enumeration).
   */
  resetPassword: (email: string) => Promise<{ error: string | null }>
  /**
   * Set the current user's password via the active session (invite/recovery
   * onboarding, or a change from Settings). Requires an active session.
   */
  setPassword: (password: string) => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => authStore.getState())

  useEffect(() => {
    // Re-sync in case the store advanced between first render and subscription.
    setState(authStore.getState())
    return authStore.subscribe(setState)
  }, [])

  const user = state.session?.user ?? null

  const value: AuthContextValue = {
    status: state.status,
    user,
    email: user?.email ?? null,
    signIn: async (email, password) => {
      if (!supabase) return { error: null }
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return { error: error ? error.message : null }
    },
    signUp: async (email, password) => {
      if (!supabase) return { error: null, status: null }
      // Confirmation link lands on the site root; `captureAuthLink` parses the
      // `type=signup` fragment and `init()` promotes it to a normal session.
      const emailRedirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/` : undefined
      const { error } = await supabase.auth.signUp({
        email,
        password,
        ...(emailRedirectTo ? { options: { emailRedirectTo } } : {}),
      })
      return { error: error ? error.message : null, status: error?.status ?? null }
    },
    signOut: async () => {
      await supabase?.auth.signOut()
    },
    resetPassword: async (email) => {
      if (!supabase) return { error: null }
      // The recovery email link lands on the site root; `captureAuthLink` parses
      // the `type=recovery` fragment and `init()` establishes the recovery
      // session, gating the existing `/set-password` screen.
      const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/` : undefined
      const { error } = await supabase.auth.resetPasswordForEmail(
        email,
        redirectTo ? { redirectTo } : {},
      )
      return { error: error ? error.message : null }
    },
    setPassword: async (password) => {
      if (!supabase) return { error: null }
      const { error } = await supabase.auth.updateUser({ password })
      return { error: error ? error.message : null }
    },
  }

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

/**
 * Subscribe to the onboarding link state (invite/recovery). Reactive so the root
 * layout and the `/set-password` screen re-render when the flow starts or clears.
 */
export function useAuthLink(): LinkState {
  return useSyncExternalStore(
    authStore.subscribeLink,
    authStore.getLinkState,
    authStore.getLinkState,
  )
}
