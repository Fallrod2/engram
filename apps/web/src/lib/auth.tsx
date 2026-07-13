import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { authStore, type AuthState } from './auth-store'

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
  signOut: () => Promise<void>
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
    signOut: async () => {
      await supabase?.auth.signOut()
    },
  }

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
