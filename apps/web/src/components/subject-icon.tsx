import { useState } from 'react'
import {
  Anchor,
  Atom,
  Beaker,
  Binary,
  Book,
  BookOpen,
  Brain,
  Calculator,
  Clock,
  Code,
  Compass,
  Cpu,
  Database,
  Dna,
  Feather,
  FlaskConical,
  FunctionSquare,
  Gavel,
  GitBranch,
  Globe,
  GraduationCap,
  Heart,
  Landmark,
  Languages,
  Layers,
  Leaf,
  Library,
  Lightbulb,
  Map as MapIcon,
  Microscope,
  Music,
  Network,
  Palette,
  PenTool,
  Percent,
  Presentation,
  Rocket,
  Ruler,
  Scale,
  School,
  Server,
  Sigma,
  Telescope,
  Terminal,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

/** Curated subject icons (spec §2). Stored id = the lucide export name. */
export const SUBJECT_ICONS: { id: string; icon: LucideIcon; keywords: string }[] = [
  { id: 'BookOpen', icon: BookOpen, keywords: 'livre lecture littérature' },
  { id: 'GraduationCap', icon: GraduationCap, keywords: 'école diplôme études' },
  { id: 'Code', icon: Code, keywords: 'programmation dev informatique' },
  { id: 'Terminal', icon: Terminal, keywords: 'shell console système' },
  { id: 'Binary', icon: Binary, keywords: 'binaire logique numérique' },
  { id: 'Cpu', icon: Cpu, keywords: 'processeur architecture matériel' },
  { id: 'Server', icon: Server, keywords: 'serveur réseau backend' },
  { id: 'Database', icon: Database, keywords: 'base données sql' },
  { id: 'Network', icon: Network, keywords: 'réseau graphe' },
  { id: 'GitBranch', icon: GitBranch, keywords: 'git version branche' },
  { id: 'Sigma', icon: Sigma, keywords: 'somme maths statistiques' },
  { id: 'FunctionSquare', icon: FunctionSquare, keywords: 'fonction analyse maths' },
  { id: 'Calculator', icon: Calculator, keywords: 'calcul arithmétique maths' },
  { id: 'Percent', icon: Percent, keywords: 'pourcentage probabilité' },
  { id: 'Ruler', icon: Ruler, keywords: 'géométrie mesure' },
  { id: 'Compass', icon: Compass, keywords: 'géométrie direction' },
  { id: 'Atom', icon: Atom, keywords: 'physique atome science' },
  { id: 'FlaskConical', icon: FlaskConical, keywords: 'chimie laboratoire' },
  { id: 'Beaker', icon: Beaker, keywords: 'chimie expérience' },
  { id: 'Microscope', icon: Microscope, keywords: 'biologie science' },
  { id: 'Dna', icon: Dna, keywords: 'biologie génétique' },
  { id: 'Leaf', icon: Leaf, keywords: 'biologie botanique nature' },
  { id: 'Brain', icon: Brain, keywords: 'neuro psychologie cognition' },
  { id: 'Telescope', icon: Telescope, keywords: 'astronomie espace' },
  { id: 'Rocket', icon: Rocket, keywords: 'espace physique' },
  { id: 'Globe', icon: Globe, keywords: 'géographie monde' },
  { id: 'MapIcon', icon: MapIcon, keywords: 'carte géographie' },
  { id: 'Landmark', icon: Landmark, keywords: 'histoire institution' },
  { id: 'Gavel', icon: Gavel, keywords: 'droit justice loi' },
  { id: 'Scale', icon: Scale, keywords: 'droit équilibre justice' },
  { id: 'Languages', icon: Languages, keywords: 'langue traduction anglais' },
  { id: 'Book', icon: Book, keywords: 'livre manuel' },
  { id: 'Library', icon: Library, keywords: 'bibliothèque documentation' },
  { id: 'School', icon: School, keywords: 'école cours' },
  { id: 'Presentation', icon: Presentation, keywords: 'présentation exposé' },
  { id: 'PenTool', icon: PenTool, keywords: 'design écriture' },
  { id: 'Palette', icon: Palette, keywords: 'art design couleur' },
  { id: 'Music', icon: Music, keywords: 'musique solfège' },
  { id: 'Feather', icon: Feather, keywords: 'écriture littérature' },
  { id: 'Lightbulb', icon: Lightbulb, keywords: 'idée concept' },
  { id: 'Clock', icon: Clock, keywords: 'temps histoire chronologie' },
  { id: 'Heart', icon: Heart, keywords: 'santé médecine' },
  { id: 'Anchor', icon: Anchor, keywords: 'marine transport' },
  { id: 'Zap', icon: Zap, keywords: 'électricité énergie physique' },
  { id: 'Layers', icon: Layers, keywords: 'général pile matière' },
]

const ICON_BY_ID = new Map(SUBJECT_ICONS.map((e) => [e.id, e.icon]))

/** Render a stored subject icon id (falls back to BookOpen). */
export function SubjectIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_BY_ID.get(name) ?? BookOpen
  return <Icon className={cn('size-4', className)} />
}

/** Searchable icon picker (spec §2): a secondary button → popover Command. */
export function SubjectIconPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const t = useT()
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={t('dialogs.iconPickerTrigger')}
        >
          <SubjectIcon name={value} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={t('dialogs.iconPickerSearch')} />
          <CommandList>
            <CommandEmpty>{t('dialogs.iconPickerEmpty')}</CommandEmpty>
            <CommandGroup>
              <div className="grid grid-cols-6 gap-1 p-1">
                {SUBJECT_ICONS.map(({ id, icon: Icon, keywords }) => (
                  <CommandItem
                    key={id}
                    value={`${id} ${keywords}`}
                    onSelect={() => {
                      onChange(id)
                      setOpen(false)
                    }}
                    className={cn(
                      'flex size-9 items-center justify-center rounded-sm p-0',
                      id === value && 'bg-accent-subtle text-text',
                    )}
                  >
                    <Icon className="size-4" />
                  </CommandItem>
                ))}
              </div>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
