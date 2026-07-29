import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { Check, Languages, Sparkles, Timer, X } from 'lucide-react'
import { useReducedMotion } from '@/lib/motion'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { LanguageSelect, ThemeSelect } from '@/features/settings/appearance-controls'
import { StudyPaceFields } from '@/features/study-settings/study-pace-fields'
import { DURATION_BASE, EASE_OUT } from '@/features/review/reveal-motion'
import { AiStep } from './ai-step'
import { useCompleteOnboarding } from './queries'
import {
  ONBOARDING_STEP_COUNT,
  isLastStep,
  nextStep,
  previousStep,
  stepPosition,
  type OnboardingStep,
} from './steps'

/**
 * The first-run journey (T-049): language & theme → study pace → AI, in that
 * order, with a way out of every step.
 *
 * ═══ IT IS A PAGE, NOT A MODAL ═══
 *
 * Deliberately: a modal would need a focus trap, and a focus trap around a
 * skippable wizard is a contradiction — the user must be able to Tab straight
 * out of it. As a route it gets a real URL (so Settings can link back to it),
 * a working back button, and no trap to get wrong. It renders OUTSIDE the app
 * shell (`__root.tsx`) so the sidebar's data queries do not fan out behind a
 * screen the user has not asked anything of yet.
 *
 * ═══ NOTHING IS BLOCKING, AND NOTHING IS WRITTEN BY ARRIVING ═══
 *
 * Every step has « Passer cette étape »; the header has « Quitter ». Both end
 * the journey the same way — by marking it done, because "I do not want this"
 * is a complete answer to "shall we ask again". The steps themselves write only
 * on an explicit choice: theme/language persist in `setTheme`/`setLang`, the
 * pace fields PATCH only on a committed change, and the AI step never sends
 * anything unless a key is typed. Skipping all three leaves the account exactly
 * as it was found.
 *
 * ═══ ACCESSIBILITY ═══
 *
 * The step heading is focused on every transition (`tabIndex={-1}`), so a
 * keyboard or screen-reader user lands on the new content instead of having the
 * focus dropped to `<body>`. A polite live region announces « Étape N sur 3 »
 * plus the heading. The progress bar carries `role="progressbar"` with its
 * values, not just a coloured div. No focus trap, no autofocus stealing the
 * first field.
 */
export function OnboardingFlow() {
  const t = useT()
  const navigate = useNavigate()
  const reduced = useReducedMotion()
  const complete = useCompleteOnboarding()
  const [step, setStep] = useState<OnboardingStep>('appearance')
  const headingRef = useRef<HTMLHeadingElement>(null)
  // The FIRST render must not steal focus: someone who arrived by clicking
  // « Revoir » in Settings is mid-keyboard-flow, and yanking focus onto a
  // heading is exactly the kind of surprise that makes a wizard hostile.
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    headingRef.current?.focus()
  }, [step])

  /**
   * End the journey. `completed: true` whichever door was used — finishing and
   * quitting are the same answer to "ask again?".
   *
   * The navigation happens whatever the PATCH did. A marker that failed to save
   * is a nuisance (the journey may reappear on the next full page load); being
   * stuck on a screen one has explicitly left is a defect. The anti-loop latch
   * in `gate.ts` is what makes that safe within this page load.
   */
  function finish(opts: { announce?: boolean } = {}) {
    complete.mutate(
      { completed: true },
      { onError: () => toast.error(t('onboarding.journey.saveMarkerError')) },
    )
    if (opts.announce) toast.success(t('onboarding.journey.doneToast'))
    void navigate({ to: '/' })
  }

  function goNext() {
    const after = nextStep(step)
    if (after) setStep(after)
    else finish({ announce: true })
  }

  const back = previousStep(step)
  const position = stepPosition(step)

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex shrink-0 items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold tracking-[-0.01em] text-text">
            {t('onboarding.journey.title')}
          </span>
          <span className="font-mono text-2xs tabular-nums text-text-faint">
            {t('onboarding.journey.stepOf', { current: position, total: ONBOARDING_STEP_COUNT })}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => finish()}
          aria-label={t('onboarding.journey.quitAria')}
        >
          {t('onboarding.journey.quit')}
          <X />
        </Button>
      </header>

      {/* Progress: a real progressbar, so it is announced and not merely seen. */}
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={ONBOARDING_STEP_COUNT}
        aria-valuenow={position}
        aria-label={t('onboarding.journey.progressLabel')}
        className="flex shrink-0 gap-1 px-4 sm:px-6"
      >
        {Array.from({ length: ONBOARDING_STEP_COUNT }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className={`h-0.5 flex-1 rounded-full transition-colors duration-fast ${
              i < position ? 'bg-accent' : 'bg-surface-2'
            }`}
          />
        ))}
      </div>

      {/* Announced once per transition; `sr-only` costs the layout nothing. */}
      <div aria-live="polite" className="sr-only">
        {t('onboarding.journey.stepOf', { current: position, total: ONBOARDING_STEP_COUNT })} —{' '}
        {t(STEP_TITLES[step])}
      </div>

      {/* `my-auto` and not `items-center`: a centred flex item whose content is
          taller than the box gets clipped at the TOP, past any scrollbar. Auto
          margins centre the short steps and give up gracefully on the tall
          ones, which then scroll from their own beginning. */}
      <main className="flex flex-1 justify-center overflow-y-auto px-4 py-8 sm:px-6 sm:py-12">
        <div className="my-auto flex w-full max-w-xl flex-col gap-6">
          <motion.section
            key={step}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION_BASE, ease: EASE_OUT }}
            className="flex flex-col gap-5"
          >
            <div className="flex flex-col gap-2">
              <span className="flex size-9 items-center justify-center rounded-md border border-border bg-surface-1 text-accent">
                <StepIcon step={step} />
              </span>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="text-xl font-semibold tracking-[-0.02em] text-text outline-none"
              >
                {t(STEP_TITLES[step])}
              </h1>
              <p className="max-w-[56ch] text-pretty text-sm leading-relaxed text-text-muted">
                {t(STEP_BODIES[step])}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-surface-1 p-5">
              {step === 'appearance' && <AppearanceStep />}
              {step === 'pace' && <StudyPaceFields />}
              {step === 'ai' && <AiStep onSaved={() => finish({ announce: true })} />}
            </div>
          </motion.section>

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {back && (
                <Button variant="ghost" onClick={() => setStep(back)}>
                  {t('onboarding.journey.back')}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={goNext}>
                {isLastStep(step)
                  ? t('onboarding.journey.skipLast')
                  : t('onboarding.journey.skipStep')}
              </Button>
              {!isLastStep(step) && (
                <Button onClick={goNext}>
                  {t('onboarding.journey.next')}
                  <Check />
                </Button>
              )}
            </div>
          </div>

          <p className="text-xs text-text-faint">{t('onboarding.journey.reopenHint')}</p>
        </div>
      </main>
    </div>
  )
}

const STEP_TITLES = {
  appearance: 'onboarding.journey.appearance.title',
  pace: 'onboarding.journey.pace.title',
  ai: 'onboarding.journey.ai.title',
} as const

const STEP_BODIES = {
  appearance: 'onboarding.journey.appearance.body',
  pace: 'onboarding.journey.pace.body',
  ai: 'onboarding.journey.ai.body',
} as const

function StepIcon({ step }: { step: OnboardingStep }) {
  if (step === 'appearance') return <Languages className="size-4" aria-hidden />
  if (step === 'pace') return <Timer className="size-4" aria-hidden />
  return <Sparkles className="size-4" aria-hidden />
}

/**
 * Step 1 — the two controls whose effect is instant, and which is why they come
 * first. Both are the SAME components the settings screen mounts
 * (`features/settings/appearance-controls.tsx`), so the invariant that carries
 * them holds here for free: no stored value = no choice = follow the system, and
 * passing this step writes nothing at all.
 */
function AppearanceStep() {
  const t = useT()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="onboarding-lang">{t('settings.language')}</Label>
        <LanguageSelect id="onboarding-lang" className="w-40" />
      </div>
      <Separator />
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="onboarding-theme">{t('settings.theme')}</Label>
        <ThemeSelect id="onboarding-theme" className="w-40" />
      </div>
      <p className="text-xs leading-relaxed text-text-muted">
        {t('onboarding.journey.appearance.systemNote')}
      </p>
    </div>
  )
}
