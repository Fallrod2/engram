import { useNavigate } from '@tanstack/react-router'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { useShell } from './shell-context'
import { NAV_GROUPS } from './nav'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'

/**
 * ⌘K command palette — Phase 0 stub (full palette in Phase 6). Navigates to any
 * route and toggles the theme. Opened via the shell's global ⌘K shortcut.
 */
export function CommandMenu() {
  const { commandOpen, setCommandOpen } = useShell()
  const navigate = useNavigate()
  const { resolved, toggle } = useTheme()

  const go = (to: string) => {
    setCommandOpen(false)
    void navigate({ to })
  }

  return (
    <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
      <CommandInput placeholder="Rechercher ou aller à…" />
      <CommandList>
        <CommandEmpty>Aucun résultat.</CommandEmpty>
        {NAV_GROUPS.map((group, i) => (
          <div key={group.id}>
            {i > 0 && <CommandSeparator />}
            <CommandGroup heading={group.label}>
              {group.items.map((item) => (
                <CommandItem key={item.to} value={item.label} onSelect={() => go(item.to)}>
                  <item.icon />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Préférences">
          <CommandItem
            value="thème basculer"
            onSelect={() => {
              toggle()
              setCommandOpen(false)
            }}
          >
            {resolved === 'dark' ? <Sun /> : <Moon />}
            Basculer le thème
            <CommandShortcut>{resolved === 'dark' ? 'Clair' : 'Sombre'}</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
