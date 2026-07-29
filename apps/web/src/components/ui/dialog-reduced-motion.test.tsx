// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from './alert-dialog'

/**
 * ═══ De quoi dépend la disparition d'un dialogue fermé (T-051).
 *
 * `Dialog` et `AlertDialog` passent tous deux par `Presence`
 * (@radix-ui/react-presence), qui SUSPEND le démontage d'un overlay fermé
 * jusqu'à recevoir `animationend` sur le nœud. Tant que cet événement n'arrive
 * pas, la boîte reste montée et visible — `data-state="closed"`, opacité 1 — et
 * l'utilisateur n'a plus que le rechargement de page. C'est le mécanisme qui
 * rendrait un réglage d'accessibilité (« réduire les animations ») hostile aux
 * seules personnes qui l'ont demandé.
 *
 * ─────────────────────── CE QUE CE FICHIER PROUVE, ET CE QU'IL NE PROUVE PAS
 *
 * jsdom n'a AUCUN moteur d'animation : `getComputedStyle(n).animationName` y vaut
 * toujours `''`, donc `Presence` prend son court-circuit « pas d'animation » et
 * démonte tout de suite. Un test qui se bornerait à ouvrir puis fermer un
 * dialogue serait donc vert QUOI QU'IL ARRIVE, y compris dans le cas qu'on veut
 * attraper : il ne prouverait rien. On ne l'écrit pas.
 *
 * Ce fichier fait autre chose : il installe à la main ce que jsdom ne fournit
 * pas (un `animationName` non vide, un `animationend`) pour forcer `Presence` sur
 * sa branche ANIMÉE, puis montre les deux issues — sans l'événement le dialogue
 * fermé reste à l'écran, avec l'événement il disparaît. Il établit donc *ce dont
 * le composant dépend*. Il n'établit RIEN sur ce que fait un vrai navigateur :
 * qu'une animation ramenée à `0.01ms` émette bien son `animationend` est un fait
 * de moteur, mesuré à part et figé par `src/styles-reduced-motion.test.ts`.
 *
 * Les deux ensemble couvrent le défaut : celui-ci ne peut naître que d'une règle
 * CSS qui suspend ou diffère l'animation de sortie (§ garde CSS), et il se
 * manifeste par la branche « toujours monté » ci-dessous (§ ce fichier).
 *
 * Vérification en vrai navigateur faite pour T-051 (Chrome et Chromium,
 * préférence système ET émulée, harnais isolé ET application réelle) : avec la
 * règle actuelle, tous les dialogues se démontent. Le défaut rapporté ne se
 * reproduit pas ; ces tests existent pour qu'il ne devienne pas vrai.
 */

/** `AnimationEvent` : absent de jsdom, attendu par `Presence`. */
class FakeAnimationEvent extends Event {
  animationName: string
  constructor(type: string, init: { animationName: string }) {
    super(type, { bubbles: true })
    this.animationName = init.animationName
  }
}

/**
 * Fait croire à `Presence` qu'une animation est déclarée, comme dans un navigateur :
 * `enter` tant que le nœud est ouvert, `exit` une fois fermé. La lecture est FAITE
 * DANS LE GETTER — `Presence` conserve la `CSSStyleDeclaration` obtenue au montage
 * et la relit plus tard, en comptant sur son caractère vivant ; un instantané figé
 * lui ferait croire que rien n'a changé, et il démonterait sans attendre (ce qui
 * ferait passer ce test pour de mauvaises raisons).
 *
 * Seuls les nœuds Radix (`data-state`) sont truqués : `react-remove-scroll` et les
 * autres continuent de lire les vrais styles calculés.
 */
function installAnimatedComputedStyle() {
  const real = window.getComputedStyle.bind(window)
  window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
    const styles = real(el, pseudo ?? undefined)
    if (!(el instanceof HTMLElement) || !el.hasAttribute('data-state')) return styles
    return new Proxy(styles, {
      get: (target, prop, receiver) =>
        prop === 'animationName'
          ? el.dataset.state === 'closed'
            ? 'exit'
            : 'enter'
          : Reflect.get(target, prop, receiver),
    })
  }) as typeof window.getComputedStyle
  return () => {
    window.getComputedStyle = real
  }
}

let restore = () => {}
beforeAll(() => {
  // `Presence` appelle `CSS.escape` en recevant l'événement — jsdom ne l'a pas.
  ;(globalThis as unknown as { CSS: { escape(v: string): string } }).CSS = {
    escape: (v: string) => v,
  }
  restore = installAnimatedComputedStyle()
})
afterAll(() => restore())
afterEach(cleanup)

/** Un dialogue ordinaire (formulaire) et une confirmation destructive. */
const CASES = [
  {
    name: '<Dialog> — formulaire',
    role: 'dialog',
    ui: (open: boolean) => (
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle matière</DialogTitle>
          </DialogHeader>
          <input aria-label="Nom" />
        </DialogContent>
      </Dialog>
    ),
  },
  {
    name: '<AlertDialog> — confirmation de suppression',
    role: 'alertdialog',
    ui: (open: boolean) => (
      <AlertDialog open={open} onOpenChange={() => {}}>
        <AlertDialogContent>
          <AlertDialogTitle>Supprimer le deck ?</AlertDialogTitle>
          <AlertDialogDescription>Cette action est irréversible.</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>
    ),
  },
] as const

describe.each(CASES)('$name — sortie suspendue puis démontage', ({ role, ui }) => {
  function openThenClose() {
    const { rerender } = render(ui(true))
    const content = screen.getByRole(role)
    rerender(ui(false))
    return content
  }

  it('reste monté tant que `animationend` n’arrive pas — le défaut, rendu visible', () => {
    const content = openThenClose()
    expect(content.dataset.state).toBe('closed')
    expect(screen.queryByRole(role)).not.toBeNull()
  })

  it('disparaît dès que l’animation de sortie se termine', () => {
    const content = openThenClose()
    fireEvent(content, new FakeAnimationEvent('animationend', { animationName: 'exit' }))
    expect(screen.queryByRole(role)).toBeNull()
  })

  it('ignore la fin d’animation d’un enfant — seule celle du panneau compte', () => {
    const content = openThenClose()
    const child = content.querySelector('input, p, h2') as HTMLElement
    fireEvent(child, new FakeAnimationEvent('animationend', { animationName: 'exit' }))
    expect(screen.queryByRole(role)).not.toBeNull()
    fireEvent(content, new FakeAnimationEvent('animationend', { animationName: 'exit' }))
    expect(screen.queryByRole(role)).toBeNull()
  })
})
