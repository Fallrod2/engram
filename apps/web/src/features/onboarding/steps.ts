/**
 * The first-run journey's step machine — pure, so the ORDER (which is the part
 * Alex arbitrated) and the "you can always leave" rule are asserted directly
 * rather than through a rendered tree.
 *
 * THE ORDER IS DELIBERATE, and it is an argument about friction:
 *
 *  1. `appearance` — language and theme. Their effect is visible the instant
 *     they are picked, so the first thing the journey does is prove that the
 *     user's answers change something. It also costs nothing: no account state
 *     is written unless a value is actually chosen.
 *  2. `pace` — the study rhythm. A real product decision, but still about the
 *     user's own habits, and its consequence (what the next days will ask of
 *     them) can be shown on screen while they choose.
 *  3. `ai` — a secret. Asking someone for an API key before they have seen a
 *     single card is the friction peak of a product, which is exactly why it is
 *     LAST and why it is skippable like the rest.
 */
export const ONBOARDING_STEPS = ['appearance', 'pace', 'ai'] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length

/** 1-based position, for « Étape 2 sur 3 » and the progress bar. */
export function stepPosition(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step) + 1
}

/**
 * The next step, or `null` when there is none — and `null` means "this finishes
 * the journey". Advancing past the last step is not an error the caller has to
 * guard against; it is the completion signal.
 */
export function nextStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1] ?? null
}

/** The previous step, or `null` on the first one (there is no "back" out). */
export function previousStep(step: OnboardingStep): OnboardingStep | null {
  const i = ONBOARDING_STEPS.indexOf(step)
  return i > 0 ? (ONBOARDING_STEPS[i - 1] ?? null) : null
}

/**
 * Is this the last step? Split out from `nextStep() === null` so the button
 * label ("Continuer" vs "Terminer") reads as the question it answers.
 */
export function isLastStep(step: OnboardingStep): boolean {
  return nextStep(step) === null
}
