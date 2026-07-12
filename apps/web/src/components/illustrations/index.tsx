/**
 * Empty-state illustrations (spec §7.2). Inline monochrome SVG, `currentColor`
 * (the caller paints `text-faint`), stroke 1.5, sober geometry — no gradient, no
 * color, no heavy figure. One per screen, derived from that screen's metaphor.
 * All share a 56px box and the same stroke language so the app reads as one set.
 */

const BOX = 56

interface IllustrationProps {
  className?: string
}

function Svg({
  children,
  className,
}: {
  children: React.ReactNode
  className: string | undefined
}) {
  return (
    <svg
      width={BOX}
      height={BOX}
      viewBox="0 0 56 56"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  )
}

/** Matières (vide) — a small stack of cards / shelf. */
export function SubjectsIllustration({ className }: IllustrationProps) {
  return (
    <Svg className={className}>
      <rect x="12" y="20" width="32" height="24" rx="3" />
      <path d="M16 20v-3a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2v3" opacity={0.55} />
      <path d="M19 14v-2a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2" opacity={0.3} />
      <path d="M20 29h16M20 35h10" />
    </Svg>
  )
}

/** Matière → decks (vide) — an open, empty folder. */
export function DecksIllustration({ className }: IllustrationProps) {
  return (
    <Svg className={className}>
      <path d="M11 20a2 2 0 0 1 2-2h8l3 4h17a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2Z" />
      <path d="M11 27h34" opacity={0.4} />
    </Svg>
  )
}

/** Deck → cartes (vide) — a stylised front/back flashcard. */
export function CardsIllustration({ className }: IllustrationProps) {
  return (
    <Svg className={className}>
      <rect x="10" y="17" width="30" height="22" rx="3" opacity={0.4} />
      <rect x="16" y="21" width="30" height="22" rx="3" />
      <path d="M22 28h18M22 34h11" />
    </Svg>
  )
}

/** Import (vide) — a sheet with an upward arrow. */
export function ImportIllustration({ className }: IllustrationProps) {
  return (
    <Svg className={className}>
      <path d="M18 12h13l9 9v21a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2V14a2 2 0 0 1 2-2Z" opacity={0.55} />
      <path d="M31 12v9h9" opacity={0.55} />
      <path d="M28 40V28" />
      <path d="M23 33l5-5 5 5" />
    </Svg>
  )
}

/** Planning (vide) — a small empty calendar. */
export function PlanningIllustration({ className }: IllustrationProps) {
  return (
    <Svg className={className}>
      <rect x="11" y="15" width="34" height="30" rx="3" />
      <path d="M11 23h34" />
      <path d="M20 12v6M36 12v6" />
      <path d="M18 30h4M26 30h4M34 30h4M18 37h4M26 37h4" opacity={0.5} />
    </Svg>
  )
}

/** Analytics (vide) — flat, low bars. */
export function AnalyticsIllustration({ className }: IllustrationProps) {
  return (
    <Svg className={className}>
      <path d="M13 14v28h30" />
      <path d="M20 42v-6M28 42v-10M36 42v-4" />
      <path d="M18 26c6 0 8-4 12-4s6 3 10 3" opacity={0.4} />
    </Svg>
  )
}

/** Session EMPTY (récompense) — a calm spark / check, the softest of the set. */
export function RewardIllustration({ className }: IllustrationProps) {
  return (
    <Svg className={className}>
      <circle cx="28" cy="28" r="14" opacity={0.4} />
      <path d="M22 28l4 4 8-8" />
      <path d="M42 15l1.4 3.2L46.5 19l-3.1.8L42 23l-1.4-3.2L37.5 19l3.1-.8Z" opacity={0.55} />
    </Svg>
  )
}

/** Welcome (onboarding) — engram's diamond mark, a fresh start. */
export function WelcomeIllustration({ className }: IllustrationProps) {
  return (
    <Svg className={className}>
      <path d="M28 11 44 28 28 45 12 28Z" />
      <path d="M20 28 28 20l8 8-8 8Z" opacity={0.45} />
    </Svg>
  )
}
