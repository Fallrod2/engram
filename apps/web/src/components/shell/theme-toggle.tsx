import { Moon, Sun } from 'lucide-react'
import { motion } from 'motion/react'
import { useTheme } from '@/lib/theme'
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
 */
export function ThemeToggle() {
  const { resolved, toggle } = useTheme()
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
            initial={{ opacity: 0, rotate: -30 }}
            animate={{ opacity: 1, rotate: 0 }}
            transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
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
