import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { useReducedMotion } from '@/lib/motion'
import { ArrowRight, Keyboard, LineChart, ScanLine } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AiProviderId } from '@engram/shared'
import { useLang, useT, type TKey } from '@/lib/i18n'
import { PROVIDER_ORDER, providerLabel } from '@/features/ai/providers'
import { useTheme } from '@/lib/theme'
import { fetchHealth } from '@/lib/api'
import { siteHost } from '@/lib/build-info'
import { qk } from '@/lib/query-keys'
import { AUTH_ENABLED_WEB } from '@/lib/supabase'
import { useAuthStatus } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ThemeToggle } from '@/components/shell/theme-toggle'
import { DemoBootWindow } from './demo-boot-window'
import { useDemoBoot } from './use-demo-boot'

/**
 * Public landing page (landing spec §2). Rendered OUTSIDE the app shell for a
 * signed-out visitor on `/`, and unconditionally on `/welcome`. Loaded from its
 * OWN async chunk (React.lazy in the route), so it never weighs on the
 * authenticated dashboard's critical path (§5.4).
 *
 * Design: the app's Precision-Linear system (OKLCH indigo, Inter + JetBrains
 * Mono, tight radii). The signature is the product's own idea made visible — the
 * *spacing rhythm* of FSRS reviews (§ RhythmStrip). Dark by default, light
 * supported; mobile-first; motion subtle (<250 ms) and reduced-motion aware.
 */

const GITHUB_URL = 'https://github.com/Fallrod2/engram'

/**
 * The landing is reachable WITH a session (Réglages → À propos, ⌘K, or a direct
 * `/welcome`), so it must not keep selling an account to someone who already has
 * one: every sign-in / sign-up CTA becomes a single way back into the app. Read
 * from the store rather than `useAuth()` so the page keeps rendering outside
 * `<AuthProvider>` (bare route, unit tests). `loading` is treated as signed OUT —
 * the anonymous CTAs are the safe default, and the swap happens as soon as the
 * session resolves.
 */
function useSignedIn(): boolean {
  return useAuthStatus() === 'authenticated'
}

/** The one CTA a signed-in visitor needs: back to the app. */
function OpenAppButton({ size = 'default' }: { size?: 'default' | 'lg' }) {
  const t = useT()
  return (
    <Button asChild size={size}>
      <Link to="/">
        {t('landing.nav.openApp')}
        <ArrowRight />
      </Link>
    </Button>
  )
}

export default function LandingPage() {
  const t = useT()

  // Marketing tab title + social/description meta on the landing, kept in sync
  // with the active language (the static index.html ships the FR default for
  // crawlers; here we localize once the SPA hydrates — documented SEO debt of a
  // client-rendered marketing page). The authenticated shell resets the title to
  // 'engram' at mount (see app-shell). Not a loading state — invisible effect.
  useEffect(() => {
    const previous = document.title
    document.title = t('landing.meta.title')
    const restore = setMetaContent('name', 'description', t('landing.meta.description'))
    return () => {
      document.title = previous
      restore()
    }
  }, [t])

  return (
    <div className="min-h-dvh overflow-x-hidden bg-bg text-text">
      <LandingHeader />
      <main>
        <Hero />
        <RhythmStrip />
        <Pillars />
        <Showcase />
        <HowItWorks />
        <Providers />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  )
}

/**
 * Set a `<meta>` tag's content by attribute (`name`/`property`), returning a
 * restore fn so unmount reverts to the static HTML value. Creates the tag if the
 * SPA is the first to need it.
 */
function setMetaContent(attr: 'name' | 'property', key: string, value: string): () => void {
  if (typeof document === 'undefined') return () => {}
  const selector = `meta[${attr}="${key}"]`
  let el = document.head.querySelector<HTMLMetaElement>(selector)
  const created = el === null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  const previous = el.getAttribute('content')
  el.setAttribute('content', value)
  return () => {
    if (created) el?.remove()
    else if (previous !== null) el?.setAttribute('content', previous)
  }
}

/* ------------------------------------------------------------------ header -- */

function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <span
        className="flex size-6 items-center justify-center rounded-sm bg-accent text-accent-fg"
        aria-hidden
      >
        <span className="text-2xs leading-none">◆</span>
      </span>
      <span className="text-sm font-semibold tracking-[-0.01em] text-text">engram</span>
    </span>
  )
}

function LandingHeader() {
  const t = useT()
  const signedIn = useSignedIn()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-colors duration-base',
        scrolled ? 'border-b border-border bg-bg/80 backdrop-blur' : 'border-b border-transparent',
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1.5 px-4 sm:gap-2 sm:px-6 lg:px-8">
        <Wordmark />
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {/* Language toggle promoted from the footer so an anglophone visitor
              (e.g. from GitHub) discovers the EN copy without scrolling 7 screens. */}
          <LangToggle />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label={t('landing.nav.githubAria')}
            className="hidden size-8 items-center justify-center rounded-sm text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text sm:flex"
          >
            <GithubMark className="size-4" />
          </a>
          <ThemeToggle />
          {signedIn ? (
            <OpenAppButton />
          ) : (
            <>
              {/* Sign-in stays available; the primary conversion action is the
                  account CTA (repeated at the foot of the page too). */}
              <Button asChild variant="ghost" size="default" className="hidden sm:inline-flex">
                <Link to="/login">{t('landing.nav.signIn')}</Link>
              </Button>
              <Button asChild size="default">
                <Link to="/signup">{t('landing.nav.createAccount')}</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

/** Compact FR/EN segmented toggle, shared by the header and (historically) the
 *  footer. Single instance now lives in the header. */
function LangToggle() {
  const t = useT()
  const { lang, setLang } = useLang()
  return (
    <div
      className="inline-flex rounded-sm border border-border p-0.5"
      role="group"
      aria-label={t('landing.nav.language')}
    >
      {(['fr', 'en'] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={cn(
            'rounded-[4px] px-2 py-1 text-xs font-medium uppercase transition-colors duration-fast',
            lang === code ? 'bg-surface-2 text-text' : 'text-text-faint hover:text-text-muted',
          )}
        >
          {code}
        </button>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------- hero -- */

function Hero() {
  const t = useT()
  const signedIn = useSignedIn()
  const reduce = useReducedMotion()
  // Owned by the hero, not by <DemoCta>, so the message renders UNDER the whole
  // CTA row: a message inside the row would widen its column and shove the
  // primary "Créer un compte" button sideways the moment the demo fails.
  const [demoFailed, setDemoFailed] = useState(false)

  const rise = (delay: number) => ({
    initial: reduce ? false : ({ opacity: 0, y: 10 } as const),
    animate: { opacity: 1, y: 0 } as const,
    transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const, delay },
  })

  return (
    <section className="relative">
      {/* One deliberate glow — the sole "spectacular" moment the system allows. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] overflow-hidden"
      >
        <div className="absolute left-1/2 top-[-120px] h-[420px] w-[820px] max-w-[130vw] -translate-x-1/2 rounded-full bg-accent/16 blur-[120px]" />
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-16 sm:px-6 sm:pt-20 lg:px-8 lg:pt-28">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <motion.span
            {...rise(0)}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-1 px-3 py-1 font-mono text-2xs uppercase tracking-[0.12em] text-text-muted"
          >
            <span className="size-1.5 rounded-full bg-accent" aria-hidden />
            {t('landing.hero.eyebrow')}
          </motion.span>

          <motion.h1
            {...rise(0.06)}
            className="mt-6 text-balance text-[2rem] font-semibold leading-[1.06] tracking-[-0.03em] text-text sm:text-[2.75rem] lg:text-[3.5rem]"
          >
            {t('landing.hero.title')}
          </motion.h1>

          <motion.p
            {...rise(0.12)}
            className="mt-5 max-w-2xl text-pretty text-md leading-relaxed text-text-muted sm:text-lg"
          >
            {t('landing.hero.subtitle')}
          </motion.p>

          <motion.div {...rise(0.18)} className="mt-8 flex flex-col items-center gap-3">
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              {signedIn ? (
                // Already signed in: no account to create and no demo session to
                // open — the hero's action is simply "go back to the app".
                <OpenAppButton size="lg" />
              ) : (
                <>
                  <Button asChild size="lg" className="min-w-40">
                    <Link to="/signup">
                      {t('landing.hero.cta')}
                      <ArrowRight />
                    </Link>
                  </Button>
                  {/* Second CTA — rendered only when the SERVER says a demo login
                      is configured (landing spec §2). See <DemoCta>. */}
                  <DemoCta onFailedChange={setDemoFailed} />
                </>
              )}
            </div>
            {demoFailed && (
              <p role="alert" className="max-w-sm text-pretty text-xs text-danger">
                {t('landing.hero.demoError')}
              </p>
            )}
          </motion.div>

          <motion.p {...rise(0.22)} className="mt-4 text-xs text-text-faint">
            {t('landing.hero.note')}
          </motion.p>
        </div>

        <motion.div {...rise(0.28)} className="mx-auto mt-14 max-w-5xl">
          <BrowserFrame>
            <ThemedShot base="dashboard" alt={t('landing.hero.shotAlt')} priority />
          </BrowserFrame>
        </motion.div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- demo CTA -- */

/**
 * "Try the demo" CTA (landing spec §2). Three things worth knowing:
 *
 *  1. AVAILABILITY IS LEARNED AT RUNTIME, not at build time. `GET /api/health` is
 *     public and reports `demoLoginEnabled` — the exact predicate the server route
 *     uses. So Alex can turn the demo on by setting the env vars on Vercel, with
 *     NO front-end redeploy. Nothing about the demo is baked into the bundle: the
 *     account's password lives on the server only and has no `VITE_` twin.
 *  2. IT NEVER SENDS CREDENTIALS. `POST /api/demo/session` takes no input; the
 *     server signs in with its own env credentials and hands back a token pair,
 *     which we install with `supabase.auth.setSession`. `AUTH_ENABLED_WEB` is part
 *     of the condition because without a Supabase client there is nowhere to put
 *     the session (local dev / e2e, where the whole auth flow is off anyway).
 *  3. WHILE THE PROBE IS IN FLIGHT we hold the button's footprint with a skeleton
 *     rather than popping the CTA in (or spinning): the hero must not reflow under
 *     the reader. Probe failed, or no demo → nothing is rendered at all.
 *  4. THE WAIT IS OWNED BY `useDemoBoot`: open a session, wait for the server to
 *     finish seeding, and only THEN sign the browser in — that order is what keeps
 *     this page (and the boot window) mounted, because `routes/index.tsx` swaps
 *     the landing for the dashboard as soon as the auth status flips. Past 500 ms
 *     a window appears saying which step is running; see `use-demo-boot.ts` for
 *     why 500 ms and why it is often never shown at all. A boot that never crosses
 *     that threshold behaves EXACTLY as before: a pending button, then the app.
 */
function DemoCta({ onFailedChange }: { onFailedChange: (failed: boolean) => void }) {
  const t = useT()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const boot = useDemoBoot({
    onEnter: () => void navigate({ to: '/' }),
    onFailedChange,
    // The boot already paid for `GET /api/me`; hand it to the cache so the app
    // shell does not immediately ask again.
    onPrimed: (me) => qc.setQueryData(qk.me, me),
  })
  // Deliberately stays true through `ready`: the landing is about to unmount and
  // the button must not become clickable again in between.
  const pending = boot.state.phase === 'working' || boot.state.phase === 'ready'

  const health = useQuery({
    queryKey: qk.health,
    queryFn: ({ signal }) => fetchHealth(signal),
    // One shot: a server that cannot answer its own health probe is not going to
    // serve a demo session either, and the landing must never retry-storm.
    retry: false,
    staleTime: 5 * 60_000,
  })

  if (health.isPending) {
    return (
      <Skeleton
        role="status"
        aria-label={t('landing.hero.demoCtaLoading')}
        className="h-9 w-36 rounded-sm"
      />
    )
  }
  if (!AUTH_ENABLED_WEB || !health.data?.demoLoginEnabled) return null

  return (
    <>
      <Button type="button" variant="outline" size="lg" disabled={pending} onClick={boot.start}>
        {pending ? t('landing.hero.demoCtaPending') : t('landing.hero.demoCta')}
      </Button>
      <DemoBootWindow
        open={boot.windowOpen}
        state={boot.state}
        onRetry={boot.retry}
        onDismiss={boot.dismiss}
        onEnterAnyway={boot.enterAnyway}
      />
    </>
  )
}

/* ------------------------------------------------------------ rhythm strip -- */

/** FSRS-style expanding intervals (days). The growing gaps ARE the message. */
const INTERVALS = [1, 3, 8, 21, 55] as const

function RhythmStrip() {
  const t = useT()
  const unit = t('landing.rhythm.unit')

  // Scroll-driven right-edge fade: it signals "more to scroll" on narrow screens,
  // then lifts once the strip is scrolled to the end so the final pill (+55 j) is
  // never left veiled at its destination (finding: static fade masked the last
  // glyph). Recomputed on scroll + resize; a non-overflowing strip reads as
  // "already at end", so no fade shows.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [atEnd, setAtEnd] = useState(true)

  const syncFade = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    syncFade()
    window.addEventListener('resize', syncFade)
    return () => window.removeEventListener('resize', syncFade)
  }, [syncFade])

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="rounded-lg border border-border bg-surface-1 p-6 sm:p-8">
        <SectionLabel>{t('landing.rhythm.label')}</SectionLabel>
        {/* Focusable + named: the strip scrolls horizontally below ~520px, so it
            must be reachable by keyboard (axe scrollable-region-focusable) — the
            page is mobile-first and claims 100% keyboard operability. */}
        <div className="relative mt-6">
          <div
            ref={scrollerRef}
            onScroll={syncFade}
            className="overflow-x-auto pb-1"
            role="group"
            tabIndex={0}
            aria-label={t('landing.rhythm.label')}
          >
            <div className="flex min-w-[520px] items-center gap-2">
              <RhythmPill accent>{t('landing.rhythm.today')}</RhythmPill>
              {INTERVALS.map((n) => (
                <div key={n} className="flex flex-1 items-center gap-2">
                  <span
                    aria-hidden
                    className="h-px flex-1 bg-gradient-to-r from-accent/45 to-border"
                    style={{ flexGrow: n }}
                  />
                  <RhythmPill>{`+${n}\u00A0${unit}`}</RhythmPill>
                </div>
              ))}
            </div>
          </div>
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-surface-1 to-transparent transition-opacity duration-200 sm:hidden',
              atEnd && 'opacity-0',
            )}
          />
        </div>
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-text-muted">
          {t('landing.rhythm.caption')}
        </p>
      </div>
    </section>
  )
}

function RhythmPill({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded-full border px-3 py-1 font-mono text-2xs tabular-nums',
        accent
          ? 'border-accent/40 bg-accent-subtle text-accent'
          : 'border-border bg-surface-2 text-text-muted',
      )}
    >
      {children}
    </span>
  )
}

/* ----------------------------------------------------------------- pillars -- */

function Pillars() {
  const t = useT()
  const pillars = [
    {
      icon: Keyboard,
      title: t('landing.pillars.review.title'),
      body: t('landing.pillars.review.body'),
    },
    {
      icon: ScanLine,
      title: t('landing.pillars.import.title'),
      body: t('landing.pillars.import.body'),
    },
    {
      icon: LineChart,
      title: t('landing.pillars.analytics.title'),
      body: t('landing.pillars.analytics.body'),
    },
  ]

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <SectionLabel className="mb-6">{t('landing.pillars.label')}</SectionLabel>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {pillars.map(({ icon: Icon, title, body }) => (
          <article
            key={title}
            className="group flex flex-col gap-3 rounded-lg border border-border bg-surface-1 p-6 transition-colors duration-base hover:border-border-strong hover:bg-surface-2"
          >
            <span className="flex size-9 items-center justify-center rounded-md bg-accent-subtle text-accent [&_svg]:size-4.5">
              <Icon />
            </span>
            <h3 className="text-md font-semibold tracking-[-0.01em] text-text">{title}</h3>
            <p className="text-sm leading-relaxed text-text-muted">{body}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- showcase -- */

function Showcase() {
  const t = useT()
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <SectionLabel className="mb-6">{t('landing.showcase.label')}</SectionLabel>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ShowcaseCard
          base="review"
          title={t('landing.showcase.review.title')}
          caption={t('landing.showcase.review.caption')}
          alt={t('landing.showcase.review.alt')}
        />
        <ShowcaseCard
          base="analytics"
          title={t('landing.showcase.analytics.title')}
          caption={t('landing.showcase.analytics.caption')}
          alt={t('landing.showcase.analytics.alt')}
        />
      </div>
    </section>
  )
}

function ShowcaseCard({
  base,
  title,
  caption,
  alt,
}: {
  base: ShotBase
  title: string
  caption: string
  alt: string
}) {
  return (
    <figure className="flex flex-col gap-4 rounded-lg border border-border bg-surface-1 p-4 sm:p-5">
      <BrowserFrame>
        <ThemedShot base={base} alt={alt} />
      </BrowserFrame>
      <figcaption className="px-1">
        <h3 className="text-md font-semibold tracking-[-0.01em] text-text">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-text-muted">{caption}</p>
      </figcaption>
    </figure>
  )
}

/* ------------------------------------------------------------- how it works -- */

function HowItWorks() {
  const t = useT()
  const steps = [
    { title: t('landing.how.step1.title'), body: t('landing.how.step1.body') },
    { title: t('landing.how.step2.title'), body: t('landing.how.step2.body') },
    { title: t('landing.how.step3.title'), body: t('landing.how.step3.body') },
  ]

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <SectionLabel className="mb-8">{t('landing.how.label')}</SectionLabel>
      <ol className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-6">
        {steps.map((step, i) => (
          <li key={step.title} className="relative flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-lg font-medium tabular-nums text-accent">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span aria-hidden className="h-px flex-1 bg-border" />
            </div>
            <h3 className="text-md font-semibold tracking-[-0.01em] text-text">{step.title}</h3>
            <p className="text-sm leading-relaxed text-text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

/* --------------------------------------------------------------- providers -- */

/**
 * A landing-only nuance appended to a provider's chip, when the bare name would
 * over-promise. `null` = the name says everything a visitor needs.
 *
 * EXHAUSTIVE over `AiProviderId` on purpose (`Record`, not `Partial<Record>`):
 * adding a provider breaks THIS file until someone decides what the landing says
 * about it. That is the point — the chips used to be a hand-copied array of five
 * strings, it silently lost `openai-codex`, and nothing failed (fix 29/07/2026).
 * Now the *set* comes from `PROVIDER_ORDER` and the *names* from
 * `providerLabel()`, so the only thing that can go missing is a nuance, and the
 * compiler catches that.
 *
 * Not derived from `providerUsesKey()`, tempting as it looks: that predicate is
 * false for BOTH `ollama` and `openai-codex`, which need opposite copy ("runs on
 * your machine, no key" vs "rides an unofficial route, do not count on it").
 */
const PROVIDER_NOTE: Record<AiProviderId, TKey | null> = {
  anthropic: null,
  openrouter: null,
  // No key, no account, nothing leaves the machine — the one thing worth saying
  // to someone still choosing.
  ollama: 'landing.providers.local',
  'openai-compat': null,
  mistral: null,
  // Never announced bare: it rides an existing ChatGPT subscription through an
  // unofficial route. See `landing.providers.codexNote` for the full caveat.
  'openai-codex': 'landing.providers.experimental',
}

function Providers() {
  const t = useT()

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="rounded-lg border border-border bg-surface-1 p-8 sm:p-10">
        <SectionLabel>{t('landing.providers.label')}</SectionLabel>
        <h2 className="mt-4 max-w-2xl text-xl font-semibold tracking-[-0.02em] text-text sm:text-[1.75rem]">
          {t('landing.providers.title')}
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-muted sm:text-base">
          {t('landing.providers.body')}
        </p>
        <ul className="mt-6 flex flex-wrap gap-2">
          {PROVIDER_ORDER.map((id) => {
            const note = PROVIDER_NOTE[id]
            return (
              <li
                key={id}
                className="rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-2xs text-text-muted"
              >
                {providerLabel(t, id)}
                {note ? <span className="text-text-faint"> · {t(note)}</span> : null}
              </li>
            )
          })}
        </ul>
        {/*
          The one chip whose availability is not the visitor's to control: the
          subscription route depends on an unofficial OpenAI endpoint AND on the
          server's `ENGRAM_ENABLE_CODEX` switch. Saying so here costs one faint
          line and keeps the chip from being a promise the instance may not keep.
        */}
        <p className="mt-4 max-w-2xl text-xs leading-relaxed text-text-faint">
          {t('landing.providers.codexNote')}
        </p>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ footer -- */

function FinalCta() {
  const t = useT()
  const signedIn = useSignedIn()
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="relative overflow-hidden rounded-lg border border-border bg-surface-1 px-6 py-12 text-center sm:px-10 sm:py-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-full overflow-hidden"
        >
          <div className="absolute left-1/2 top-[-60px] h-[280px] w-[560px] max-w-[130vw] -translate-x-1/2 rounded-full bg-accent/12 blur-[100px]" />
        </div>
        <h2 className="mx-auto max-w-2xl text-balance text-2xl font-semibold tracking-[-0.02em] text-text sm:text-[2rem]">
          {t('landing.finalCta.title')}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-sm leading-relaxed text-text-muted sm:text-base">
          {t('landing.finalCta.body')}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {signedIn ? (
            <OpenAppButton size="lg" />
          ) : (
            <>
              <Button asChild size="lg" className="min-w-44">
                <Link to="/signup">
                  {t('landing.nav.createAccount')}
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/login">{t('landing.nav.signIn')}</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function LandingFooter() {
  const t = useT()

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <div className="flex flex-col gap-3">
          <Wordmark />
          <p className="text-sm text-text-faint">{t('landing.footer.tagline')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text"
          >
            <GithubMark className="size-3.5" />
            {t('landing.footer.github')}
          </a>

          <ThemeToggle />
        </div>
      </div>
    </footer>
  )
}

/* ------------------------------------------------------------- primitives -- */

/**
 * Section eyebrow. Rendered as an <h2> (not a styled <p>) so the document keeps a
 * gapless heading order — h1 (hero) → h2 (section) → h3 (cards). Skipping to h3
 * trips axe `heading-order`, one of the four rules the project a11y suite gates
 * (e2e/tests/a11y.spec.ts). Visual weight is unchanged; only the tag differs.
 */
function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        'font-mono text-2xs font-semibold uppercase tracking-[0.12em] text-text-faint',
        className,
      )}
    >
      {children}
    </h2>
  )
}

/**
 * A restrained browser bezel around a product screenshot.
 *
 * The chrome label used to be the literal string `engram · localhost` — printed
 * on a public deployment, where it read as "this is a screenshot of somebody's
 * laptop". It now shows the host the page is really served from (`siteHost()`):
 * `engram.alexabriel.com` in production, `localhost:5173` for a developer. No
 * configuration, and no way for it to drift out of date. When the host is
 * unknowable (no `window`, e.g. a unit test) the label collapses to the wordmark
 * alone rather than guessing.
 */
function BrowserFrame({ children }: { children: ReactNode }) {
  const host = siteHost()
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-2 shadow-lg">
      <div className="flex h-8 items-center gap-1.5 border-b border-border px-3">
        <span className="size-2.5 rounded-full bg-border-strong" aria-hidden />
        <span className="size-2.5 rounded-full bg-border-strong" aria-hidden />
        <span className="size-2.5 rounded-full bg-border-strong" aria-hidden />
        <span className="ml-3 hidden truncate font-mono text-2xs text-text-faint sm:inline">
          {host ? `engram · ${host}` : 'engram'}
        </span>
      </div>
      {children}
    </div>
  )
}

type ShotBase = 'dashboard' | 'review' | 'analytics'

/**
 * Intrinsic pixel size of each capture (they are cropped to different aspect
 * ratios). Passing the true width/height keeps the reserved box ratio equal to
 * the loaded image's, so there is no layout shift as each shot decodes.
 */
const SHOT_SIZE: Record<ShotBase, { width: number; height: number }> = {
  // Intrinsic pixel size of the regenerated captures (scripts/generate-landing-shots.ts,
  // deviceScaleFactor 2). Only the ratio matters — it reserves the correct box so
  // the shot decodes without layout shift.
  dashboard: { width: 2880, height: 1560 },
  // 1560, not 1680: the review capture's viewport shrank to 1080×780 when the
  // session became a fixed-height block, and a stale height here is exactly the
  // layout shift this table exists to prevent.
  review: { width: 2160, height: 1560 },
  analytics: { width: 2880, height: 1960 },
}

/**
 * Theme- AND language-aware product screenshot. Picks the WebP for the resolved
 * theme × active language (both synchronous from context — no flash, no extra
 * loading state), so the EN landing shows an EN-chrome app instead of reusing the
 * FR captures (finding: EN landing shipped 100% FR shots). Served from
 * `public/landing/`, so it never touches the JS bundle (§5.4). The four variants
 * per screen are regenerated by scripts/generate-landing-shots.ts.
 */
function ThemedShot({ base, alt, priority }: { base: ShotBase; alt: string; priority?: boolean }) {
  const { resolved } = useTheme()
  const { lang } = useLang()
  const src = `/landing/${base}-${resolved}-${lang}.webp`
  const { width, height } = SHOT_SIZE[base]
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className="block h-auto w-full bg-bg"
    />
  )
}

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}
