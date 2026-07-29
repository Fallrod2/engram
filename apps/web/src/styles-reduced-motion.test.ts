import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * ═══ Le bloc `prefers-reduced-motion` écourte les animations. Il ne les fige pas.
 *
 * POURQUOI CETTE GARDE EXISTE (T-051).
 *
 * `Presence` (@radix-ui/react-presence — sous `dialog`, `alert-dialog`, `sheet`,
 * `select`, `popover`, `dropdown-menu`, `tooltip`) ne démonte un overlay fermé
 * qu'après avoir reçu `animationend` sur son nœud. Une règle CSS qui empêche
 * l'animation de SORTIE de se terminer laisse donc la boîte montée et visible —
 * `data-state="closed"`, opacité 1, pleine hauteur — sans autre issue que
 * recharger la page. Le bloc ci-dessous est le seul endroit de l'app d'où une
 * telle règle peut venir, et il s'applique à `*` : une ligne suffirait à casser
 * toutes les boîtes de dialogue à la fois, pour les seuls utilisateurs qui ont
 * demandé moins de mouvement.
 *
 * CE QUE CE TEST ÉTABLIT — ET CE QU'IL N'ÉTABLIT PAS. Il ne fait pas tourner de
 * moteur d'animation : il fige le résultat d'une MESURE faite dans Chrome, sur
 * les dialogues réels de l'app, préférence système `prefers-reduced-motion` active
 * (fermeture par Échap, DOM relevé 1,5 s après) :
 *
 *   animation-duration: 0.01ms   → animationstart + animationend → démonté   ✓
 *   animation-duration: 0s       → animationstart + animationend → démonté   ✓
 *   animation: none              → Presence court-circuite       → démonté   ✓
 *   animation-name: none         → idem                          → démonté   ✓
 *   animation-play-state: paused → animationstart SEUL   → reste 295 px      ✗
 *   animation-delay: 10s         → animationcancel SEUL  → reste 295 px      ✗
 *
 * Autrement dit : la forme actuelle (`0.01ms`) est saine — c'est même sa raison
 * d'être, `0.01ms` plutôt que `0` étant la formule canonique précisément parce
 * qu'elle laisse partir les événements JS. Les deux formes qui cassent tout sont
 * celles qui *suspendent* ou *diffèrent* l'animation. Ce test interdit ces deux-là.
 *
 * Le pendant côté composant est `components/ui/dialog-reduced-motion.test.tsx`,
 * qui rend exécutable la dépendance de Radix à `animationend`.
 */

const STYLES = fileURLToPath(new URL('./styles.css', import.meta.url))

/** Le bloc `@media (prefers-reduced-motion: reduce) { … }`, accolades appariées. */
function reducedMotionBlock(css: string): string {
  const at = css.indexOf('@media (prefers-reduced-motion: reduce)')
  expect(at, 'styles.css doit toujours honorer prefers-reduced-motion').toBeGreaterThan(-1)
  let depth = 0
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(at, i + 1)
  }
  throw new Error('accolades non appariées dans le bloc prefers-reduced-motion')
}

/** Déclarations seules : le commentaire du bloc CITE les formes interdites. */
function declarations(block: string): string {
  return block.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('styles.css — bloc prefers-reduced-motion (T-051)', () => {
  let decls = ''
  beforeAll(() => {
    decls = declarations(reducedMotionBlock(readFileSync(STYLES, 'utf8')))
  })

  it('écourte bien la durée des animations (la forme mesurée comme sûre)', () => {
    expect(decls).toMatch(/animation-duration:\s*0?\.01ms\s*!important/)
  })

  it('ne met jamais les animations en pause — `animationend` n’arriverait plus', () => {
    expect(decls).not.toMatch(/animation-play-state/)
  })

  it('ne diffère jamais les animations — un délai non nul bloque la sortie', () => {
    const delays = decls.match(/animation-delay:\s*[^;!}]+/g) ?? []
    for (const d of delays) expect(d.trim()).toMatch(/:\s*0(m?s)?$/)
  })

  it('ne passe pas par le raccourci `animation:` — il rendrait la garde aveugle', () => {
    // `animation: none 0s …` réécrit name/duration/delay d'un coup : les trois
    // assertions ci-dessus ne verraient plus rien passer.
    expect(decls).not.toMatch(/[;{\s]animation:\s/)
  })

  it('laisse les transitions écourtées, elles aussi (rien ne doit les figer)', () => {
    expect(decls).toMatch(/transition-duration:\s*0?\.01ms\s*!important/)
    expect(decls).not.toMatch(/transition-delay:\s*(?!0(m?s)?[;\s!}])/)
  })
})
