import { Moon, Sun } from 'lucide-react'
import { motion } from 'motion/react'
import { useTheme } from '@/lib/theme'
import { useReducedMotion } from '@/lib/motion'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Icon toggle between dark and light. Persists via the theme provider.
 *
 * Both strings name the theme the click takes you TO, never the current one: the
 * accessible name spells the action out ("Passer en thème clair"), the tooltip
 * is its short form ("Thème clair"). They were hardcoded French, which is the
 * one thing a screen-reader user cannot work around — this control is on the
 * shell footer AND the landing header, so an English visitor met French on the
 * very first screen.
 *
 * THE ICON SWAP OBEYS THE MOTION PREFERENCE (T-053, 31/07/2026). It never did.
 * The `motion.span` below has animated since the day it was written and this
 * file did not mention `useReducedMotion` once — not before the 29/07 override
 * landed and not after, so the spin played for someone who had asked their OS
 * for less movement, and kept playing whatever the product setting said. It was
 * not a regression from the override; it never obeyed anything.
 *
 * `motion` does not do this by itself: it only auto-respects the media query
 * under a `<MotionConfig reducedMotion="user">`, and this app mounts none. Every
 * animation is opt-in to the preference, which is why `motion-guard.test.ts` now
 * fails any file that animates without the preference in scope.
 *
 * Reduced: `initial={false}` makes the icon MOUNT at its resting state instead
 * of tweening to it, and the zeroed transition covers the imperative path. The
 * icon still changes — the preference is about movement, not information.
 */
export function ThemeToggle() {
  const { resolved, toggle } = useTheme()
  const reduce = useReducedMotion()
  const t = useT()
  const isDark = resolved === 'dark'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={isDark ? t('themeToggle.toLightAria') : t('themeToggle.toDarkAria')}
          className="text-text-muted"
        >
          <motion.span
            key={resolved}
            initial={reduce ? false : { opacity: 0, rotate: -30 }}
            animate={{ opacity: 1, rotate: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className="flex"
          >
            {isDark ? <Moon /> : <Sun />}
          </motion.span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {isDark ? t('themeToggle.toLight') : t('themeToggle.toDark')}
      </TooltipContent>
    </Tooltip>
  )
}
