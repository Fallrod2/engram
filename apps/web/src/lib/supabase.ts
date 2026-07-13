import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase client — AUTH ONLY (spec §3.1): `signInWithPassword`, `getSession`,
 * `onAuthStateChange`, `signOut`. No data ever flows through it; the REST API is
 * the Hono server.
 *
 * `null` when web auth is disabled (no `VITE_SUPABASE_URL`) — the default in
 * local dev and e2e, symmetric with the server gate being OFF there.
 *
 * The anon key is PUBLIC by design: it identifies the project and grants nothing
 * without a signed user JWT. Shipping it in the bundle is safe — the real
 * protection is server-side JWT verification (§2) + closed sign-ups (§1.2).
 */
const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase: SupabaseClient | null =
  url && anon
    ? createClient(url, anon, {
        auth: {
          persistSession: true, // localStorage
          autoRefreshToken: true, // background refresh
          detectSessionInUrl: false, // no magic-link / OAuth callback to parse
          storageKey: 'engram-auth',
        },
      })
    : null

/** True iff the web auth flow is active (a Supabase client exists). */
export const AUTH_ENABLED_WEB = supabase !== null
