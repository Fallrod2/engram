// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { EntityRow, RowActions, entityRowClass } from './entity-row'

afterEach(cleanup)

describe('entityRowClass (spec §1.10)', () => {
  it('encodes hover + keyboard-selection surface and the 2px accent edge bar', () => {
    const cls = entityRowClass()
    expect(cls).toContain('hover:bg-surface-2')
    expect(cls).toContain('data-[active]:bg-surface-2')
    // Accent edge bar mirrors the nav, revealed on keyboard selection.
    expect(cls).toContain('before:bg-accent')
    expect(cls).toContain('data-[active]:before:opacity-100')
    expect(cls).toContain('h-11')
  })

  it('appends caller-provided classes', () => {
    expect(entityRowClass('grid grid-cols-2')).toContain('grid grid-cols-2')
  })
})

describe('<EntityRow> / <RowActions>', () => {
  it('renders its child inside an <li> row container', () => {
    const { container } = render(
      <EntityRow>
        <a href="#">Théorie des langages</a>
      </EntityRow>,
    )
    const li = container.querySelector('li')
    expect(li).not.toBeNull()
    expect(li?.className).toContain('group/row')
    expect(screen.getByText('Théorie des langages')).toBeTruthy()
  })

  it('renders actions hidden until hover/focus (opacity-0 by default)', () => {
    const { container } = render(
      <RowActions>
        <button type="button">⋯</button>
      </RowActions>,
    )
    const slot = container.firstElementChild as HTMLElement
    expect(slot.className).toContain('opacity-0')
    expect(slot.className).toContain('group-hover/row:opacity-100')
  })
})
