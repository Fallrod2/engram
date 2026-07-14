import { useEffect, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, Keyboard, LineChart, ScanLine } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLang, useT } from '@/lib/i18n'
import { useTheme } from '@/lib/theme'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/shell/theme-toggle'

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
          {/* Sign-in stays available; the primary conversion action is the
              account CTA (repeated at the foot of the page too). */}
          <Button asChild variant="ghost" size="default" className="hidden sm:inline-flex">
            <Link to="/login">{t('landing.nav.signIn')}</Link>
          </Button>
          <Button asChild size="default">
            <Link to="/signup">{t('landing.nav.createAccount')}</Link>
          </Button>
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
  const reduce = useReducedMotion()

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

          <motion.div {...rise(0.18)} className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="min-w-40">
              <Link to="/signup">
                {t('landing.hero.cta')}
                <ArrowRight />
              </Link>
            </Button>
            {/* Second CTA — activated once the demo account exists (landing spec
                §2). Intentionally not rendered until then. */}
            {/* <Button asChild variant="outline" size="lg">
              <Link to="/login">{t('landing.hero.demoCta')}</Link>
            </Button> */}
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

/* ------------------------------------------------------------ rhythm strip -- */

/** FSRS-style expanding intervals (days). The growing gaps ARE the message. */
const INTERVALS = [1, 3, 8, 21, 55] as const

function RhythmStrip() {
  const t = useT()
  const unit = t('landing.rhythm.unit')

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="rounded-lg border border-border bg-surface-1 p-6 sm:p-8">
        <SectionLabel>{t('landing.rhythm.label')}</SectionLabel>
        {/* Focusable + named: the strip scrolls horizontally below ~520px, so it
            must be reachable by keyboard (axe scrollable-region-focusable) — the
            page is mobile-first and claims 100% keyboard operability. */}
        {/* The wrapper adds a right-edge fade so the horizontal cut on narrow
            screens reads as "scroll me", not "content ends here". */}
        <div className="relative mt-6">
          <div
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
            className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-surface-1 to-transparent sm:hidden"
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

function Providers() {
  const t = useT()
  const chips = [
    'Anthropic',
    'Mistral',
    'OpenRouter',
    `Ollama · ${t('landing.providers.local')}`,
    t('landing.providers.openaiCompat'),
  ]

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
          {chips.map((chip) => (
            <li
              key={chip}
              className="rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-2xs text-text-muted"
            >
              {chip}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ footer -- */

function FinalCta() {
  const t = useT()
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
          <Button asChild size="lg" className="min-w-44">
            <Link to="/signup">
              {t('landing.nav.createAccount')}
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/login">{t('landing.nav.signIn')}</Link>
          </Button>
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

/** A restrained browser bezel around a product screenshot. */
function BrowserFrame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-2 shadow-lg">
      <div className="flex h-8 items-center gap-1.5 border-b border-border px-3">
        <span className="size-2.5 rounded-full bg-border-strong" aria-hidden />
        <span className="size-2.5 rounded-full bg-border-strong" aria-hidden />
        <span className="size-2.5 rounded-full bg-border-strong" aria-hidden />
        <span className="ml-3 hidden font-mono text-2xs text-text-faint sm:inline">
          engram · localhost
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
  review: { width: 2160, height: 1680 },
  analytics: { width: 2880, height: 1960 },
}

/**
 * Theme-aware product screenshot. Picks the dark/light WebP from the resolved
 * theme (synchronous from the theme context — no flash, no extra loading state).
 * Served from `public/landing/`, so it never touches the JS bundle (§5.4).
 */
function ThemedShot({ base, alt, priority }: { base: ShotBase; alt: string; priority?: boolean }) {
  const { resolved } = useTheme()
  const src = `/landing/${base}-${resolved}.webp`
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
