/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL — enables web auth when set (mapped from SUPABASE_URL at build). */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase anon key — PUBLIC by design (identifies the project, grants nothing). */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Dev-only proxy target for `/api` (see vite.config.ts). */
  readonly VITE_API_TARGET?: string
}
