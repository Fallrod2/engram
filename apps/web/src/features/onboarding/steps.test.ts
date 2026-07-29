import { describe, expect, it } from 'vitest'
import {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_COUNT,
  isLastStep,
  nextStep,
  previousStep,
  stepPosition,
  type OnboardingStep,
} from './steps'

describe('the journey order', () => {
  it('is exactly the one Alex arbitrated: visible effect, then habit, then secret', () => {
    // Not decoration: the order IS the friction argument (see `steps.ts`). If a
    // future change reorders these, it has to say so here first.
    expect([...ONBOARDING_STEPS]).toEqual(['appearance', 'pace', 'ai'])
    expect(ONBOARDING_STEP_COUNT).toBe(3)
  })

  it('asks for the API key LAST', () => {
    expect(ONBOARDING_STEPS.at(-1)).toBe('ai')
    expect(isLastStep('ai')).toBe(true)
  })

  it('numbers the steps from 1, for « Étape N sur 3 »', () => {
    expect(ONBOARDING_STEPS.map(stepPosition)).toEqual([1, 2, 3])
  })
})

describe('walking the journey', () => {
  it('chains forward to the end, then reports completion with null', () => {
    expect(nextStep('appearance')).toBe('pace')
    expect(nextStep('pace')).toBe('ai')
    expect(nextStep('ai')).toBeNull()
  })

  it('chains back to the first step, which has no way further back', () => {
    expect(previousStep('ai')).toBe('pace')
    expect(previousStep('pace')).toBe('appearance')
    expect(previousStep('appearance')).toBeNull()
  })

  it('next and previous are inverse everywhere they are both defined', () => {
    for (const step of ONBOARDING_STEPS) {
      const forward = nextStep(step)
      if (forward) expect(previousStep(forward)).toBe(step)
    }
  })

  it('every step but the last is not the last', () => {
    const flags = ONBOARDING_STEPS.map((s: OnboardingStep) => isLastStep(s))
    expect(flags).toEqual([false, false, true])
  })
})
