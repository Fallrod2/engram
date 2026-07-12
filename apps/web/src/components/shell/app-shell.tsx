import { useState } from 'react'
import { Outlet, useRouterState } from '@tanstack/react-router'
import { motion, useReducedMotion } from 'motion/react'
import { Sidebar } from './sidebar'
import { Header } from './header'
import { MobileTabBar } from './mobile-tab-bar'
import { CommandMenu } from './command-menu'
import { CreateHost } from './command-actions'
import { ShortcutsDialog } from './shortcuts-dialog'
import { ShellProvider } from './shell-context'
import { getPageTitleKey, shellOwnsHeading } from './page-title'
import { useT } from '@/lib/i18n'

function ShellInner() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const reduceMotion = useReducedMotion()
  const t = useT()
  const [scrolled, setScrolled] = useState(false)

  return (
    <div id="app-shell" className="flex h-dvh w-full overflow-hidden bg-bg text-text">
      {/* Skip link (a11y) — first in tab order. */}
      <a
        href="#main-content"
        className="sr-only left-3 top-3 z-50 rounded-sm bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg focus:not-sr-only focus:absolute"
      >
        {t('common.skipToContent')}
      </a>

      <div className="hidden md:flex">
        <Sidebar />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          title={t(getPageTitleKey(pathname))}
          scrolled={scrolled}
          asHeading={shellOwnsHeading(pathname)}
        />
        <main
          id="main-content"
          tabIndex={-1}
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
          className="flex-1 overflow-y-auto scroll-pt-12 outline-none"
        >
          <div className="mx-auto w-full max-w-[1200px] px-4 pb-24 pt-6 md:px-8 md:pb-8">
            {/*
              Page transition: a keyed enter-only animation. It deliberately does
              NOT use `AnimatePresence mode="wait"` — with an async router, the
              exit-before-enter cycle remounted the freshly-navigated route a beat
              after it mounted, silently discarding in-progress form state (the
              card composer's first submit right after landing, Phase 7 §4). A
              plain keyed `motion.div` mounts the new route exactly once.
            */}
            <motion.div
              key={pathname}
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <Outlet />
            </motion.div>
          </div>
        </main>
      </div>

      <MobileTabBar />
      <CommandMenu />
      {/* Shell-level hosts (spec §3.4, §4.3): the help dialog and the global
          create dialogs the palette drives from any route. */}
      <ShortcutsDialog />
      <CreateHost />
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
