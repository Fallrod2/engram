import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PROVIDER_ORDER } from '@/features/ai/providers'

/**
 * ═══ LANDING CLAIM ↔ SOURCE — the guards that read a source FILE ═══
 *
 * Companion to the render guards in `landing-page.test.tsx`. Those mount the
 * page; these do not, because what they check is a declaration in a module the
 * landing must never import.
 *
 * Node environment on purpose: `import.meta.url` is a real `file:` URL here,
 * which it is not under jsdom.
 */

/** Read a source file of the web app, relative to this test. */
function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

describe('landing claim: the AI providers cover OCR too', () => {
  /**
   * Réglages has TWO provider selectors — card generation and photo OCR — and the
   * landing covers both in ONE sentence (`landing.providers.body`, reworded
   * 01/08/2026; before that it spoke only of generation and undersold the app by
   * a whole selector). That sentence is true only while the OCR list IS the
   * generation list, and the place someone would narrow it is the settings file,
   * not the landing. So the guard reads the settings file.
   *
   * ═══ WHY TEXT AND NOT AN IMPORT, AND WHAT THAT COSTS ═══
   *
   * `OCR_PROVIDER_ORDER` is not exported, and importing `ai-settings-card.tsx`
   * to reach it would drag the whole settings surface (sonner, alert dialogs,
   * the queries layer) into a test whose entire question is "does this one line
   * still say `= PROVIDER_ORDER`". Exporting the constant purely to be tested
   * would edit a file the landing is supposed to follow, not steer.
   *
   * So this checks the DECLARATION, and the limit is exactly that: a filter
   * written INTO the declaration is caught, a filter applied further down the
   * component is not. It catches the change someone would actually make — "OCR
   * can't use provider X, drop it from the list" — which is the failure that
   * would make the landing lie.
   */
  it('declares the OCR provider list as the generation list, verbatim', () => {
    const source = readSource('../ai/ai-settings-card.tsx')
    expect(
      source,
      'The OCR selector no longer offers the generation providers. `landing.providers.body` ' +
        '(dict.fr.ts / dict.en.ts) claims one list covers generation AND photo reading: ' +
        'split that copy, or render two lists on the landing.',
    ).toContain('const OCR_PROVIDER_ORDER: AiProviderId[] = PROVIDER_ORDER')
  })

  /**
   * T-057, arbitrated by Alex on 01/08/2026: the chips are UNCONDITIONAL and
   * COMPLETE — a capability list, experimental entries included — and no server
   * flag may thin them out. The render test next door proves the page shows one
   * chip per `PROVIDER_ORDER` entry; this proves the list it maps over is not
   * itself pre-filtered, which a render test cannot see (a filtered list renders
   * perfectly, it is just shorter).
   */
  it('renders the provider chips from an unfiltered list', () => {
    const source = readSource('./landing-page.tsx')
    expect(source).toContain('PROVIDER_ORDER.map')
    expect(
      source,
      'The chips are filtered. T-057: the landing lists what engram CAN talk to, ' +
        'including the experimental ChatGPT route — availability is disclosed in prose ' +
        '(`landing.providers.codexNote`), never by hiding an entry.',
    ).not.toMatch(/PROVIDER_ORDER\s*\.\s*filter/)
  })

  /** The experimental entry is in the shared table, so the chips carry it. */
  it('keeps the experimental ChatGPT route in the table the chips come from', () => {
    expect(PROVIDER_ORDER).toContain('openai-codex')
  })
})
