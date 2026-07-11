import { useState } from 'react'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Sidebar } from './sidebar'
import { Header } from './header'
import { MobileTabBar } from './mobile-tab-bar'
import { CommandMenu } from './command-menu'
import { ShellProvider } from './shell-context'
import { getPageTitle } from './page-title'

function ShellInner() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const reduceMotion = useReducedMotion()
  const [scrolled, setScrolled] = useState(false)

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-text">
      {/* Skip link (a11y) — first in tab order. */}
      <a
        href="#main-content"
        className="sr-only left-3 top-3 z-50 rounded-sm bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg focus:not-sr-only focus:absolute"
      >
        Aller au contenu
      </a>

      <div className="hidden md:flex">
        <Sidebar />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header title={getPageTitle(pathname)} scrolled={scrolled} />
        <main
          id="main-content"
          tabIndex={-1}
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
          className="flex-1 overflow-y-auto scroll-pt-12 outline-none"
        >
          <div className="mx-auto w-full max-w-[1200px] px-4 pb-24 pt-6 md:px-8 md:pb-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      <MobileTabBar />
      <CommandMenu />
    </div>
  )
}

/** The app shell (spec §5): sidebar + header + content, with mobile fallbacks. */
export function AppShell() {
  return (
    <ShellProvider>
      <ShellInner />
    </ShellProvider>
  )
}
