import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'

// Self-hosted variable fonts (localhost only — no CDN).
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'

import { ThemeProvider } from '@/lib/theme'
import { LangProvider } from '@/lib/i18n'
import { AuthProvider } from '@/lib/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { createQueryClient } from '@/lib/query-client'
import { configureAuth } from '@/lib/api'
import { authStore } from '@/lib/auth-store'
import { routeTree } from './routeTree.gen'

// Router ⇄ Query are soldered: the QueryClient lives in the router context so
// loaders can `ensureQueryData` the screen's primary data (spec §1.1/§1.2). The
// auth store also lives in the context so the `beforeLoad` guard can read it.
const queryClient = createQueryClient()

const router = createRouter({
  routeTree,
  context: { queryClient, auth: authStore },
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Sign-out effect (spec §3.2/§3.3): purge cached data and land on /login. Used
// both by manual logout (Settings) and by the api 401 handler via forceSignOut.
authStore.setOnSignedOut(() => {
  queryClient.clear()
  void router.navigate({ to: '/login' })
})

// Inject the bearer token into every API request, and on a 401 sign out +
// navigate to /login (audit §8/§9).
configureAuth({
  getAccessToken: () => authStore.token(),
  onUnauthorized: () => authStore.forceSignOut(),
})

// Start session hydration BEFORE the router runs its guard (which awaits `ready`).
void authStore.init()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <LangProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TooltipProvider delayDuration={200} skipDelayDuration={300}>
              <RouterProvider router={router} />
              <Toaster />
            </TooltipProvider>
          </AuthProvider>
        </QueryClientProvider>
      </LangProvider>
    </ThemeProvider>
  </StrictMode>,
)
