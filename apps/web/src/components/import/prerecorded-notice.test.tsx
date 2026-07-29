// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { GenerationOrigin } from '@engram/shared'
import { GenerationReviewFrame, PrerecordedBadge, PrerecordedNotice } from './prerecorded-notice'

/**
 * The disclosure of the demo's pre-recorded generation (T-031).
 *
 * The rule Alex set is not "show a banner somewhere": a staged result presented
 * as a real generation is a lie to the visitor. So what is asserted here is that
 * the disclosure CANNOT GO MISSING — on any branch of the review screen — and
 * that it cannot be mistaken for an error, which would make the demo look broken
 * instead of honest.
 */

afterEach(cleanup)

const ORIGINS: GenerationOrigin[] = ['live', 'prerecorded']

/** Language-independent handle on the notice: it is the only `role="note"` here. */
const notice = () => screen.queryByRole('note')

describe('<PrerecordedNotice> carries all three facts', () => {
  it('says the cards were written in advance and shipped with the demo', () => {
    render(<PrerecordedNotice />)
    expect(notice()!.textContent).toMatch(/écrites à l’avance|written in advance/)
    expect(notice()!.textContent).toMatch(/démonstration|demo/i)
  })

  it('says nothing was generated and nothing was billed', () => {
    render(<PrerecordedNotice />)
    const text = notice()!.textContent!
    expect(text).toMatch(/aucune génération|no generation/i)
    expect(text).toMatch(/aucun crédit|no credit/i)
  })

  it('says the review itself is real', () => {
    render(<PrerecordedNotice />)
    const text = notice()!.textContent!
    expect(text).toMatch(/réelle|is real/i)
    // …and names what "real" means, so it is a claim and not a reassurance.
    expect(text).toMatch(/deck/i)
  })
})

describe('<PrerecordedNotice> is a provenance note, not an error', () => {
  it('never announces itself as an alert', () => {
    render(<PrerecordedNotice />)
    // `role="alert"` would make a screen reader interrupt the visitor to report a
    // problem. Nothing is wrong here; something is being declared.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(notice()).not.toBeNull()
  })

  it('does not borrow the warning hue reserved for "no provider configured"', () => {
    render(<PrerecordedNotice />)
    const cls = notice()!.className
    expect(cls).not.toMatch(/warning|danger/)
    expect(cls).toMatch(/info/)
  })
})

describe('<PrerecordedBadge> marks the row before it is opened', () => {
  it('names the staging in the list, not just an opaque symbol', () => {
    render(<PrerecordedBadge />)
    expect(screen.getByText(/pré-écrit|pre-written/i)).toBeTruthy()
  })
})

/**
 * THE invariant. The review screen has four branches (pending / failed /
 * succeeded-empty / succeeded-with-items); a `prerecorded` run must be disclosed
 * on every one of them, and a `live` run must never be marked.
 */
describe('a prerecorded generation is never rendered without its notice', () => {
  const BRANCHES = {
    pending: <p>en cours</p>,
    failed: <p>échec</p>,
    'succeeded, no item': <p>aucune carte</p>,
    'succeeded, with items': <p>la revue</p>,
  }

  for (const [branch, child] of Object.entries(BRANCHES)) {
    for (const origin of ORIGINS) {
      it(`${branch} · origin=${origin}`, () => {
        render(
          <GenerationReviewFrame origin={origin} header={<h1>Cartes</h1>}>
            {child}
          </GenerationReviewFrame>,
        )
        // The branch content and the header still render either way…
        expect(screen.getByRole('heading', { name: 'Cartes' })).toBeTruthy()
        expect(screen.getByText(child.props.children as string)).toBeTruthy()
        // …and the notice appears exactly when the row claims it should.
        expect(notice() !== null).toBe(origin === 'prerecorded')
      })
    }
  }
})

/**
 * Source guard, in the house style of `lib/motion-guard.test.ts`. The runtime
 * tests above prove the FRAME discloses; this one proves nothing bypasses the
 * frame. A fifth branch added with its own `<div className="mx-auto …">` would
 * render a staged generation with no notice and pass every test above.
 */
describe('the review route renders nothing outside that frame', () => {
  // `import.meta.url` is an http URL under jsdom, so resolve from the vitest
  // root (the repo) instead. The length guard keeps a wrong path from reading as
  // "no violation found".
  const route = readFileSync(
    resolve(process.cwd(), 'apps/web/src/routes/import.$noteId.generations.$generationId.tsx'),
    'utf8',
  )

  it('actually read the route (a missing file must not pass silently)', () => {
    expect(route).toContain('function GenerationReviewPage()')
  })

  it('never builds the page wrapper itself', () => {
    // The one legitimate occurrence is the pending SKELETON, which renders before
    // any generation is known (there is no origin to disclose yet).
    const wrappers = route.match(/mx-auto max-w-\[900px\]/g) ?? []
    expect(wrappers.length).toBe(1)
    expect(route).toMatch(/function PendingSkeleton\(\)[\s\S]{0,200}mx-auto max-w-\[900px\]/)
  })

  it('routes every branch of the page through the frame', () => {
    const page = route.slice(
      route.indexOf('function GenerationReviewPage()'),
      route.indexOf('function ReviewHeader('),
    )
    const returns = page.match(/return \(/g) ?? []
    const frames = page.match(/<GenerationReviewFrame /g) ?? []
    expect(returns.length).toBeGreaterThanOrEqual(4)
    expect(frames.length).toBe(returns.length)
  })
})
