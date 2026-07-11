import { Moon, Sun } from 'lucide-react'
import { motion } from 'motion/react'
import { useTheme } from '@/lib/theme'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Icon toggle between dark and light. Persists via the theme provider. */
export function ThemeToggle() {
  const { resolved, toggle } = useTheme()
  const isDark = resolved === 'dark'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={isDark ? 'Passer en thème clair' : 'Passer en thème sombre'}
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
      <TooltipContent side="top">{isDark ? 'Thème clair' : 'Thème sombre'}</TooltipContent>
    </Tooltip>
  )
}
