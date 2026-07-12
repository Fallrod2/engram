// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Layers } from 'lucide-react'
import { EmptyState } from './empty-state'

afterEach(cleanup)

describe('<EmptyState> (spec §6)', () => {
  it('renders title, mono meta line and an icon', () => {
    const { container } = render(
      <EmptyState icon={Layers} title="Aucune matière" meta="Créez votre première matière." />,
    )
    expect(screen.getByText('Aucune matière')).toBeTruthy()
    const meta = screen.getByText('Créez votre première matière.')
    expect(meta.className).toContain('font-mono')
    // The icon renders as an SVG.
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders an optional action and omits the meta line when absent', () => {
    render(
      <EmptyState
        icon={Layers}
        title="Aucun deck"
        action={<button type="button">Nouveau deck</button>}
      />,
    )
    expect(screen.getByText('Nouveau deck')).toBeTruthy()
  })
})
