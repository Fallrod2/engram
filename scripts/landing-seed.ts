/**
 * Deterministic dataset behind the landing product captures. Emits a v1 `Backup`
 * payload (`POST /api/backup/import`) so `scripts/generate-landing-shots.ts`
 * always photographs the same state. Pure — no I/O beyond reading the migration
 * journal and the server version — so it is reproducible.
 *
 * THIS FILE IS THE SHOP WINDOW. Every figure the landing shows comes from here,
 * and a thin dataset photographs as a thin product: the previous version held 16
 * cards and ~150 review logs, which rendered as a dashboard with 9 cards due and
 * half a screen of empty space, a heatmap lit for two months of the year, and a
 * sidebar where every subject showed a single small number. It is now built to
 * exercise the things the UI actually has to say:
 *
 *  - A BACKLOG THAT IS DISTINCT FROM TODAY'S LOAD. `dueCounts` splits the due
 *    total at local midnight (`review-queue.service.ts`), and the sidebar prints
 *    the two halves as `12+5` when both are non-zero. That split is invisible
 *    unless the data has both, so due dates are declared per card as one of four
 *    buckets (`overdue` / `today` / `later` / `new`) instead of being scattered
 *    by a modulo, and the per-subject totals below are chosen, not emergent.
 *  - MULTIPLE-CHOICE CARDS. A QCM has no structured representation: a card
 *    renders as a quiz when its Markdown matches `parseQcm` (see
 *    `packages/shared/src/qcm.ts`). Six of the cards here follow that contract.
 *  - ~220 DAYS OF HISTORY, with real gaps. The analytics heatmap is a calendar
 *    YEAR; sixty days of logs leave ten months blank. The generator lights the
 *    year up to today, keeps a few 1-3 day holes so "record" means something,
 *    and guarantees an unbroken current streak.
 *  - A FIRST CARD WORTH PHOTOGRAPHING. The review capture reveals whatever
 *    `dueQueue` hands out first (ordered by `due`, then `created_at`), so one
 *    card is given the oldest due date in the set and an answer with actual
 *    structure — a list, emphasis and math — instead of a one-line definition
 *    floating in a large empty card.
 *
 * `now` is injected so callers can freeze the clock; the capture script passes
 * `new Date()` so "today" is always populated. Day boundaries are computed with
 * the LOCAL getters, matching `apps/server/src/lib/day.ts` — the server does its
 * day bucketing in its own timezone, never in UTC, and the capture script runs
 * both processes in `Europe/Paris`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Backup } from '@engram/shared'

const DAY = 86_400_000
const HOUR = 3_600_000

/** Last drizzle migration tag — the import 409-guards on a schema mismatch. */
function currentSchemaTag(): string {
  const journalPath = fileURLToPath(
    new URL('../apps/server/drizzle/meta/_journal.json', import.meta.url),
  )
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] }
  const tag = journal.entries.at(-1)?.tag
  if (!tag) throw new Error('no migration entries in drizzle journal')
  return tag
}

function serverAppVersion(): string {
  const pkgPath = fileURLToPath(new URL('../apps/server/package.json', import.meta.url))
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
  return pkg.version ?? '0.0.0'
}

/** Tiny deterministic PRNG (mulberry32) so the dataset never drifts. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * When a card is due, relative to local midnight of the capture day. This is the
 * one property the landing's numbers hang on, so it is authored per card:
 *
 *   `overdue` — due BEFORE local midnight ⇒ counts in `overdueCount` (the `12`)
 *   `today`   — due just after local midnight ⇒ `todayCount` (the `5`), and it
 *               is due at any wall-clock time the capture runs at
 *   `later`   — due in the next fortnight ⇒ out of the queue, in the planning
 *               forecast
 *   `new`     — never seen (`state = 0`), released today, subject to the daily
 *               new-card budget in `dueQueue`
 */
type DueBucket = 'overdue' | 'today' | 'later' | 'new'

interface SeedCardSpec {
  front: string
  back: string
  due: DueBucket
  /**
   * Force the oldest due date in the whole set, so `dueQueue` (due ASC, then
   * created_at ASC) hands this card out first and the review capture is
   * predictable. Exactly one card carries it.
   */
  first?: true
}

interface SeedDeckSpec {
  id: string
  name: string
  description: string
  cards: SeedCardSpec[]
}

interface SeedSubjectSpec {
  id: string
  name: string
  /**
   * A hex from the app's own pigment palette (`apps/web/src/lib/pigments.ts`).
   * Off-palette values used to be used here; `pigmentSlotForHex` returns null for
   * those, so the tinted UI (load bars, retention series) silently fell back to a
   * raw hex and the captures were slightly off-brand.
   */
  color: string
  /** A lucide export name from `SUBJECT_ICONS` — lowercase ids fall back to BookOpen. */
  icon: string
  decks: SeedDeckSpec[]
}

/* ------------------------------------------------------------------ content -- */

const AUTOMATES: SeedCardSpec[] = [
  {
    // The card the review capture photographs (see `first`).
    due: 'overdue',
    first: true,
    front: 'Que dit le lemme de l’étoile, et à quoi sert-il ?',
    back: [
      'Pour tout langage régulier $L$, il existe un entier $p \\ge 1$ tel que tout mot $w \\in L$ de longueur $|w| \\ge p$ se décompose en $w = xyz$ avec :',
      '',
      '- $|xy| \\le p$',
      '- $|y| \\ge 1$',
      '- $xy^i z \\in L$ pour tout $i \\ge 0$',
      '',
      'On ne s’en sert jamais pour montrer qu’un langage **est** régulier — seulement **par contraposée**, pour montrer qu’il ne l’est pas.',
    ].join('\n'),
  },
  {
    due: 'overdue',
    front: 'Qu’est-ce qu’un automate fini déterministe ?',
    back: 'Un quintuplet $(Q, \\Sigma, \\delta, q_0, F)$ où $\\delta : Q \\times \\Sigma \\to Q$ est une fonction **totale** : un seul état atteignable par symbole lu, jamais zéro, jamais deux.',
  },
  {
    due: 'overdue',
    front: 'Différence entre AFD et AFN ?',
    back: 'L’AFN autorise plusieurs transitions pour un même symbole, et des ε-transitions. Même **expressivité** que l’AFD, mais un AFN peut être exponentiellement plus compact.',
  },
  {
    due: 'overdue',
    front: 'Que dit le théorème de Kleene ?',
    back: 'Trois définitions coïncident : langages réguliers = langages reconnus par un automate fini = langages décrits par une expression rationnelle.',
  },
  {
    due: 'overdue',
    front: 'Comment déterminiser un AFN ?',
    back: 'Construction des **sous-ensembles** : un état de l’AFD est un ensemble d’états de l’AFN, d’où au pire $2^{|Q|}$ états. On part de la clôture epsilon de $q_0$.',
  },
  {
    due: 'overdue',
    front: 'Que dit le théorème de Myhill-Nerode ?',
    back: 'Un langage est régulier **ssi** son nombre de classes d’équivalence à droite est fini. Ce nombre est exactement la taille de l’AFD minimal.',
  },
  {
    due: 'later',
    front: 'Comment obtenir le complémentaire d’un langage régulier ?',
    back: 'On déterminise, on **complète** la fonction de transition (état puits), puis on échange états finaux et non finaux. Sans la complétion, le résultat est faux.',
  },
  {
    due: 'overdue',
    front: [
      'Que fait une ε-transition dans un automate fini non déterministe ?',
      '',
      '- A) Elle consomme un symbole de l’entrée',
      '- B) Elle change d’état sans lire de symbole',
      '- C) Elle interdit tout retour en arrière',
      '- D) Elle force le passage par un état final',
    ].join('\n'),
    back: 'B) Elle change d’état sans consommer de symbole ; on l’élimine par clôture epsilon lors de la déterminisation.',
  },
  {
    due: 'today',
    front: 'Principe de la minimisation d’un AFD (Moore) ?',
    back: 'On part de la partition {finaux, non-finaux} et on raffine tant que deux états d’une même classe mènent à des classes différentes. Le point fixe est l’AFD minimal, unique à renommage près.',
  },
  {
    due: 'today',
    front: [
      'Par quelles opérations la classe des langages réguliers est-elle close ?',
      '',
      '- A) L’union uniquement',
      '- B) L’union et la concaténation uniquement',
      '- C) L’union, l’intersection et le complément',
    ].join('\n'),
    back: 'C) Les réguliers forment une algèbre de Boole : union, intersection et complément restent réguliers — ce qui n’est pas le cas des hors-contexte.',
  },
  {
    due: 'later',
    front: 'Construction de Thompson : à quoi sert-elle ?',
    back: 'À traduire une expression rationnelle en AFN avec ε-transitions, de façon compositionnelle : un fragment par opérateur, un seul état initial et un seul état final par fragment.',
  },
  {
    due: 'later',
    front: 'Comment construire l’intersection de deux langages réguliers ?',
    back: 'Automate **produit** : les états sont les couples $(p, q)$, la transition lit le même symbole des deux côtés, et l’état est final si les deux composantes le sont.',
  },
  {
    due: 'later',
    front: 'Que reconnaît exactement un automate fini ?',
    back: 'L’ensemble des mots menant de l’état initial à un état final. Sa mémoire est bornée par $|Q|$ : il ne sait pas compter au-delà d’une constante.',
  },
]

const GRAMMAIRES: SeedCardSpec[] = [
  {
    due: 'overdue',
    front: 'Qu’est-ce qu’une grammaire hors-contexte ?',
    back: 'Un ensemble de règles $A \\to \\alpha$ avec $A$ non-terminal et $\\alpha \\in (V \\cup \\Sigma)^*$ : le membre gauche ne dépend d’aucun contexte.',
  },
  {
    due: 'overdue',
    front: 'Qu’est-ce que la forme normale de Chomsky ?',
    back: 'Toute règle est $A \\to BC$ ou $A \\to a$, plus $S \\to \\varepsilon$ si le langage contient le mot vide. Toute GHC s’y ramène — c’est le préalable à CYK.',
  },
  {
    due: 'overdue',
    front: 'Quand une grammaire est-elle ambiguë ?',
    back: 'Quand un même mot admet **au moins deux** arbres de dérivation distincts. L’ambiguïté est une propriété de la grammaire, pas du langage.',
  },
  {
    due: 'overdue',
    front: 'Que reconnaît un automate à pile ?',
    back: 'Exactement les langages hors-contexte : la pile mémorise un contexte non borné, ce qu’un automate fini ne sait pas faire.',
  },
  {
    due: 'overdue',
    front: 'Hiérarchie de Chomsky, du plus général au plus restreint ?',
    back: 'Type 0 (récursivement énumérables) ⊃ type 1 (contextuels) ⊃ type 2 (hors-contexte) ⊃ type 3 (réguliers).',
  },
  {
    due: 'today',
    front: 'Que contient $FIRST(\\alpha)$ ?',
    back: 'Les terminaux qui peuvent commencer un mot dérivé de $\\alpha$, plus $\\varepsilon$ si $\\alpha$ se dérive en $\\varepsilon$.',
  },
  {
    due: 'today',
    front: 'Que contient $FOLLOW(A)$ ?',
    back: 'Les terminaux qui peuvent suivre immédiatement $A$ dans une dérivation depuis l’axiome, plus $\\$$ si $A$ peut terminer un mot.',
  },
  {
    due: 'today',
    front: [
      'Pourquoi une grammaire récursive à gauche bloque-t-elle un analyseur descendant ?',
      '',
      '- A) Elle engendre un langage vide',
      '- B) L’analyseur boucle sans consommer de symbole',
      '- C) Elle devient nécessairement ambiguë',
    ].join('\n'),
    back: 'B) La règle $A \\to A\\alpha$ se réapplique indéfiniment avant toute consommation de l’entrée. On la rend récursive à droite.',
  },
  {
    due: 'later',
    front: 'Condition pour qu’une grammaire soit LL(1) ?',
    back: 'Pour deux règles $A \\to \\alpha \\mid \\beta$ : $FIRST(\\alpha) \\cap FIRST(\\beta) = \\emptyset$, et si $\\beta$ dérive $\\varepsilon$, alors $FIRST(\\alpha) \\cap FOLLOW(A) = \\emptyset$.',
  },
  {
    due: 'later',
    front: 'Comment éliminer la récursivité à gauche de $A \\to A\\alpha \\mid \\beta$ ?',
    back: "On la rend droite : $A \\to \\beta A'$ et $A' \\to \\alpha A' \\mid \\varepsilon$.",
  },
  {
    due: 'later',
    front: 'Dérivation gauche et arbre de dérivation : quel lien ?',
    back: 'Un arbre de dérivation correspond à **exactement une** dérivation gauche. Deux dérivations gauches distinctes ⇒ deux arbres ⇒ grammaire ambiguë.',
  },
]

const PIPELINE: SeedCardSpec[] = [
  {
    due: 'overdue',
    front: 'Quels sont les cinq étages du pipeline RISC classique ?',
    back: '**IF** (fetch) → **ID** (decode) → **EX** (execute) → **MEM** (accès mémoire) → **WB** (write-back).',
  },
  {
    due: 'overdue',
    front: 'Qu’est-ce qu’un aléa de données RAW ?',
    back: 'Read After Write : une instruction lit un registre qu’une instruction précédente n’a pas encore écrit. C’est le seul vrai aléa de données sur un pipeline en ordre.',
  },
  {
    due: 'overdue',
    front: 'À quoi sert le forwarding (bypass) ?',
    back: 'À court-circuiter le banc de registres : le résultat est repris en sortie d’EX ou de MEM et réinjecté à l’entrée d’EX, ce qui élimine la plupart des bulles RAW.',
  },
  {
    due: 'overdue',
    front: 'Qu’est-ce qu’un aléa de contrôle ?',
    back: 'Un branchement dont l’issue n’est connue qu’en EX : les instructions déjà chargées derrière lui peuvent être les mauvaises, et doivent être annulées (flush).',
  },
  {
    due: 'overdue',
    front: 'Quel aléa le forwarding ne peut-il PAS supprimer ?',
    back: 'Le `load-use` : la donnée sort de MEM alors que l’instruction suivante en a besoin en EX. Une bulle d’un cycle reste nécessaire.',
  },
  {
    due: 'overdue',
    front: 'Formule du speedup idéal d’un pipeline à $k$ étages ?',
    back: 'Au mieux $k$, atteint seulement si les étages sont équilibrés et sans aléa. En pratique $CPI = 1 + \\text{bulles par instruction}$.',
  },
  {
    due: 'today',
    front: 'Comment fonctionne un prédicteur de branchement à 2 bits ?',
    back: 'Un compteur saturant par branchement : il faut **deux** erreurs consécutives pour changer de prédiction, ce qui absorbe la dernière itération d’une boucle.',
  },
  {
    due: 'today',
    front: 'Qu’est-ce qu’un aléa structurel ?',
    back: 'Deux étages réclament la même ressource matérielle au même cycle (typiquement un port mémoire unique). Se résout en dupliquant la ressource, pas en réordonnant.',
  },
  {
    due: 'later',
    front: [
      'Que permet l’exécution dans le désordre ?',
      '',
      '- A) De supprimer tous les aléas de contrôle',
      '- B) D’exécuter une instruction dès que ses opérandes sont prêts',
      '- C) De réduire le nombre d’étages du pipeline',
    ].join('\n'),
    back: 'B) L’instruction part dès que ses opérandes sont disponibles ; la validation reste dans l’ordre du programme (commit en ordre).',
  },
]

const MEMOIRE: SeedCardSpec[] = [
  {
    due: 'today',
    front: 'Localité spatiale et localité temporelle ?',
    back: '**Temporelle** : une adresse accédée récemment le sera bientôt à nouveau. **Spatiale** : ses voisines aussi. Toute la hiérarchie mémoire est un pari sur ces deux hypothèses.',
  },
  {
    due: 'today',
    front: 'Write-back ou write-through : quelle différence ?',
    back: '`write-through` écrit en mémoire à chaque écriture ; `write-back` n’écrit qu’à l’éviction d’une ligne marquée *dirty*. Moins de trafic, mais une cohérence plus délicate.',
  },
  {
    due: 'later',
    front: 'Cache associatif par ensembles : le compromis ?',
    back: 'Chaque bloc peut aller dans $N$ voies d’un ensemble donné. Entre le direct-mapped (rapide, beaucoup de conflits) et le pleinement associatif (coûteux en comparateurs).',
  },
  {
    due: 'later',
    front: 'Quelles sont les « 3 C » des défauts de cache ?',
    back: '**Compulsory** (premier accès, inévitable), **Capacity** (le cache est trop petit), **Conflict** (l’associativité est trop faible).',
  },
  {
    due: 'later',
    front: 'À quoi sert la TLB ?',
    back: 'À mettre en cache la traduction adresse virtuelle → adresse physique. Sans elle, chaque accès mémoire paierait un parcours complet de la table des pages.',
  },
  {
    due: 'later',
    front: 'Pourquoi LRU est-il rarement implémenté exactement ?',
    back: 'Le coût matériel croît avec l’associativité. On approxime : pseudo-LRU arborescent, ou bit de référence à la seconde chance.',
  },
  {
    due: 'later',
    front: 'Pourquoi une ligne de cache fait-elle 64 octets, et pas 4 ?',
    back: 'Pour amortir la latence DRAM sur la localité spatiale. Trop grande, elle gaspille de la bande passante et augmente les défauts de conflit.',
  },
  {
    due: 'later',
    front: 'Ordre de grandeur des latences L1 / L3 / DRAM ?',
    back: 'L1 ≈ 4 cycles, L3 ≈ 40 cycles, DRAM ≈ 200 cycles. C’est le facteur 50 entre L1 et DRAM qui justifie toute la hiérarchie.',
  },
]

const COMPLEXITE: SeedCardSpec[] = [
  {
    due: 'overdue',
    front: 'Que signifie exactement $f(n) = O(g(n))$ ?',
    back: 'Il existe $c > 0$ et $n_0$ tels que $f(n) \\le c \\cdot g(n)$ pour tout $n \\ge n_0$. C’est une borne **supérieure** asymptotique, pas une estimation.',
  },
  {
    due: 'overdue',
    front: 'Différence entre $O$, $\\Omega$ et $\\Theta$ ?',
    back: '$O$ majore, $\\Omega$ minore, $\\Theta$ encadre. $\\Theta$ est le seul des trois qui décrive vraiment le coût d’un algorithme.',
  },
  {
    due: 'today',
    front: 'Que dit le master theorem pour $T(n) = a\\,T(n/b) + f(n)$ ?',
    back: 'On compare $f(n)$ à $n^{\\log_b a}$ : si $f$ est dominée, $T = \\Theta(n^{\\log_b a})$ ; si elle domine (et régularité), $T = \\Theta(f(n))$ ; à égalité, un facteur $\\log n$ s’ajoute.',
  },
  {
    due: 'today',
    front: 'Pourquoi le tri rapide est-il préféré au tri fusion en pratique ?',
    back: 'Même $\\Theta(n \\log n)$ en moyenne, mais en place et avec une bien meilleure localité de cache. Son pire cas $\\Theta(n^2)$ se neutralise par un pivot aléatoire.',
  },
  {
    due: 'later',
    front: 'Que signifie « P = NP ? »',
    back: 'P : décidable en temps polynomial. NP : **vérifiable** en temps polynomial. La question est de savoir si vérifier une solution est aussi facile que la trouver.',
  },
  {
    due: 'later',
    front: 'Que faut-il pour prouver qu’un problème est NP-complet ?',
    back: 'Deux choses : montrer qu’il est dans NP, et réduire en temps polynomial un problème NP-complet connu **vers** lui. Le sens de la réduction est l’erreur classique.',
  },
  {
    due: 'later',
    front: 'Qu’est-ce que la complexité amortie ?',
    back: 'Le coût moyen par opération sur une **séquence** d’opérations, dans le pire cas. Un `push` sur tableau dynamique est $O(1)$ amorti, malgré des recopies $O(n)$.',
  },
  {
    due: 'new',
    front: 'Pourquoi $\\text{mid} = (\\text{lo} + \\text{hi})/2$ est-il un bug ?',
    back: 'La somme peut déborder. On écrit $\\text{lo} + (\\text{hi} - \\text{lo})/2$. Le bug est resté vingt ans dans la dichotomie de la bibliothèque standard Java.',
  },
]

const GRAPHES: SeedCardSpec[] = [
  {
    due: 'overdue',
    front: 'BFS ou DFS : lequel donne le plus court chemin ?',
    back: 'BFS, et **uniquement** sur un graphe non pondéré : il explore par couches, donc la première fois qu’il atteint un sommet, c’est par un chemin minimal en nombre d’arêtes.',
  },
  {
    due: 'today',
    front: 'Quelle est la limite de l’algorithme de Dijkstra ?',
    back: 'Il suppose des poids **positifs ou nuls**. Une arête négative peut améliorer un chemin déjà figé, et l’invariant de l’algorithme tombe.',
  },
  {
    due: 'today',
    front: 'Que fait Bellman-Ford de plus que Dijkstra ?',
    back: 'Il accepte les poids négatifs et **détecte** les cycles absorbants, au prix d’un $O(VE)$ contre $O((V+E)\\log V)$.',
  },
  {
    due: 'later',
    front: 'À quelle condition un tri topologique existe-t-il ?',
    back: 'Le graphe doit être orienté et **acyclique** (DAG). L’algorithme de Kahn produit l’ordre et détecte l’absence de DAG dans le même parcours.',
  },
  {
    due: 'later',
    front: 'Kruskal ou Prim : quand choisir lequel ?',
    back: 'Kruskal trie les arêtes et utilise une union-find : bon sur les graphes creux. Prim fait croître un seul arbre avec une file de priorité : bon sur les graphes denses.',
  },
  {
    due: 'later',
    front: 'Qu’est-ce qu’une composante fortement connexe ?',
    back: 'Un ensemble maximal de sommets deux à deux atteignables. Tarjan les trouve en un seul DFS, en $O(V+E)$, via les indices de découverte et les *lowlinks*.',
  },
  {
    due: 'later',
    front: 'Matrice d’adjacence ou listes d’adjacence ?',
    back: 'Matrice : $O(1)$ pour tester une arête, mais $\\Theta(V^2)$ en mémoire. Listes : $\\Theta(V+E)$, et c’est le bon choix dès que le graphe est creux.',
  },
  {
    due: 'new',
    front: 'Comment détecter un cycle dans un graphe orienté ?',
    back: 'Un DFS avec trois couleurs : croiser une arête vers un sommet **gris** (en cours d’exploration) est exactement une arête arrière, donc un cycle.',
  },
]

const IRREGULARS: SeedCardSpec[] = [
  { due: 'today', front: 'to think', back: 'thought / thought — *penser*' },
  { due: 'today', front: 'to seek', back: 'sought / sought — *chercher, rechercher*' },
  { due: 'today', front: 'to arise', back: 'arose / arisen — *survenir, se présenter*' },
  { due: 'today', front: 'to forbid', back: 'forbade / forbidden — *interdire*' },
  { due: 'later', front: 'to withdraw', back: 'withdrew / withdrawn — *retirer, se retirer*' },
  { due: 'later', front: 'to strive', back: 'strove / striven — *s’efforcer de*' },
  { due: 'new', front: 'to forsake', back: 'forsook / forsaken — *abandonner, délaisser*' },
  { due: 'new', front: 'to weave', back: 'wove / woven — *tisser*' },
]

const ACADEMIC: SeedCardSpec[] = [
  {
    due: 'later',
    front: 'a caveat',
    back: 'une réserve, une mise en garde — *“One caveat: the sample was small.”*',
  },
  {
    due: 'later',
    front: 'to substantiate a claim',
    back: 'étayer une affirmation (par des preuves). Plus fort que *to support*, plus faible que *to prove*.',
  },
  {
    due: 'later',
    front: 'notwithstanding',
    back: 'malgré, nonobstant. Se place avant **ou** après son complément : *“notwithstanding these results”*.',
  },
  {
    due: 'later',
    front: '“Furthermore” ou “moreover” : une différence ?',
    back: 'Aucune en pratique — les deux ajoutent un argument de même nature. *Furthermore* est légèrement plus formel ; on n’en met qu’un par paragraphe.',
  },
  {
    due: 'later',
    front: 'Pourquoi écrire “the data suggest” plutôt que “the data prove” ?',
    back: 'C’est du *hedging* : un article n’affirme que ce que ses données soutiennent. `prove` est réservé aux démonstrations formelles. Note aussi le pluriel : *data* prend un verbe pluriel.',
  },
  {
    due: 'new',
    front: [
      'Which verb collocates with “deadline”?',
      '',
      '- A) to meet',
      '- B) to gather',
      '- C) to overcome',
      '- D) to enhance',
    ].join('\n'),
    back: 'A) You *meet* a deadline — the other three verbs never take it as an object.',
  },
  {
    due: 'new',
    front: [
      'Which phrase hedges a finding most cautiously?',
      '',
      '- A) The results demonstrate that…',
      '- B) The results appear to indicate that…',
      '- C) The results confirm that…',
    ].join('\n'),
    back: 'B) *Appear to indicate* stacks two hedges; *demonstrate* and *confirm* both assert the finding outright.',
  },
]

/**
 * Four subjects rather than three: the sidebar, the dashboard breakdown and the
 * retention chart all render one row per subject, and three rows read as a demo.
 * Per-subject due targets (what the captures print):
 *
 *   Théorie des langages  12 en retard + 5 aujourd'hui  → the `12+5` badge
 *   Architecture           6 en retard + 4 aujourd'hui
 *   Algorithmique          3 en retard + 4 aujourd'hui + 2 nouvelles
 *   Anglais                0 en retard + 4 aujourd'hui + 4 nouvelles → a plain
 *                          single number, so the split reads as a signal and not
 *                          as a format every row happens to use
 */
const SEED: SeedSubjectSpec[] = [
  {
    id: 'sub-tdl',
    name: 'Théorie des langages',
    color: '#7999f5',
    icon: 'Binary',
    decks: [
      {
        id: 'deck-automates',
        name: 'Automates finis',
        description: 'AFD, AFN, déterminisation, minimisation.',
        cards: AUTOMATES,
      },
      {
        id: 'deck-grammaires',
        name: 'Grammaires & analyse',
        description: 'Hors-contexte, FIRST/FOLLOW, LL(1).',
        cards: GRAMMAIRES,
      },
    ],
  },
  {
    id: 'sub-archi',
    name: 'Architecture des ordinateurs',
    color: '#00b6be',
    icon: 'Cpu',
    decks: [
      {
        id: 'deck-pipeline',
        name: 'Pipeline & aléas',
        description: 'Étages, forwarding, prédiction de branchement.',
        cards: PIPELINE,
      },
      {
        id: 'deck-memoire',
        name: 'Hiérarchie mémoire',
        description: 'Caches, TLB, politiques de remplacement.',
        cards: MEMOIRE,
      },
    ],
  },
  {
    id: 'sub-algo',
    name: 'Algorithmique',
    color: '#3fbe90',
    icon: 'Network',
    decks: [
      {
        id: 'deck-complexite',
        name: 'Complexité',
        description: 'Bornes asymptotiques, master theorem, NP.',
        cards: COMPLEXITE,
      },
      {
        id: 'deck-graphes',
        name: 'Graphes',
        description: 'Parcours, plus courts chemins, connexité.',
        cards: GRAPHES,
      },
    ],
  },
  {
    id: 'sub-anglais',
    name: 'Anglais',
    color: '#d1b64a',
    icon: 'Languages',
    decks: [
      {
        id: 'deck-irregulars',
        name: 'Irregular verbs',
        description: 'Prétérit et participe passé.',
        cards: IRREGULARS,
      },
      {
        id: 'deck-academic',
        name: 'Academic writing',
        description: 'Lexique et tournures d’un article scientifique.',
        cards: ACADEMIC,
      },
    ],
  },
]

/* ---------------------------------------------------------------- generation -- */

/** Local midnight of `d`'s calendar day — same convention as the server. */
function localMidnight(d: Date): number {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  return m.getTime()
}

/**
 * History window. It has to be a calendar-year scale because the analytics
 * heatmap is a year: 220 days back from any capture date lights January onward,
 * which is the most a mid-year capture can show.
 */
const HISTORY_DAYS = 220

/**
 * The activity calendar, pinned rather than sampled.
 *
 * Leaving the rest days to the PRNG produced a run where the current streak, the
 * record and the due total were all `44` — three unrelated figures printing the
 * same number on one screen, which reads as a placeholder even though it was
 * genuine. So the two boundaries that decide both streak figures are declared:
 *
 *   days 0-30    active   → the CURRENT streak is 31
 *   day 31       rest     → what ends it
 *   days 32-70   active   → a 39-day run, so the RECORD is 39 and is visibly a
 *                           past achievement rather than a copy of the current
 *   day 71       rest     → what ended that one
 *   days 72+     sampled  → ordinary life, ~78% of days
 */
const STREAK_DAYS = 31
const STREAK_BREAK = 31
const RECORD_RUN_END = 70
const RECORD_BREAK = 71
/** Probability a day beyond the pinned window is a rest day. */
const REST_CHANCE = 0.22

/** Whether the day `daysAgo` before today carries reviews. */
function isActiveDay(daysAgo: number, rand: () => number): boolean {
  if (daysAgo < STREAK_DAYS) return true
  if (daysAgo === STREAK_BREAK || daysAgo === RECORD_BREAK) return false
  if (daysAgo <= RECORD_RUN_END) return true
  return rand() > REST_CHANCE
}

export function buildSeedBackup(now: Date = new Date()): Backup {
  const rand = rng(20260729)
  const iso = (t: number) => new Date(t).toISOString()
  const t0 = now.getTime()
  const midnight = localMidnight(now)

  const subject: Backup['tables']['subject'] = []
  const deck: Backup['tables']['deck'] = []
  const card: Backup['tables']['card'] = []

  /** Cards eligible to carry review history (never-seen ones have none). */
  const reviewable: string[] = []

  let cardIndex = 0
  SEED.forEach((s, si) => {
    subject.push({
      id: s.id,
      name: s.name,
      color: s.color,
      icon: s.icon,
      position: si,
      archived: false,
      createdAt: iso(t0 - (HISTORY_DAYS + 10) * DAY),
      updatedAt: iso(t0 - (HISTORY_DAYS + 10) * DAY),
    })
    s.decks.forEach((d, di) => {
      deck.push({
        id: d.id,
        subjectId: s.id,
        name: d.name,
        description: d.description,
        position: di,
        createdAt: iso(t0 - (HISTORY_DAYS + 8) * DAY),
        updatedAt: iso(t0 - (HISTORY_DAYS + 8) * DAY),
      })
      d.cards.forEach((c, ci) => {
        const id = `card-${d.id}-${ci}`
        // Creation order is the tie-break `dueQueue` applies after `due`, so it
        // is made strictly increasing rather than left to a shared timestamp.
        const createdAt = t0 - (HISTORY_DAYS + 5) * DAY + cardIndex * 60_000
        cardIndex += 1

        if (c.due === 'new') {
          card.push({
            id,
            deckId: d.id,
            front: c.front,
            back: c.back,
            // Released today: a never-seen card only enters `dueQueue` when it is
            // due, and the daily new-card budget caps how many actually appear.
            due: iso(midnight + 60_000),
            stability: 0,
            difficulty: 0,
            elapsedDays: 0,
            scheduledDays: 0,
            learningSteps: 0,
            reps: 0,
            lapses: 0,
            state: 0, // New
            lastReview: null,
            createdAt: iso(createdAt),
            updatedAt: iso(createdAt),
          })
          return
        }

        const due = c.first
          ? // The oldest due in the set, by a wide margin, so this card is
            // unambiguously the one the review capture reveals.
            midnight - 21 * DAY + 8 * HOUR
          : c.due === 'overdue'
            ? midnight - (1 + Math.floor(rand() * 9)) * DAY + 9 * HOUR
            : c.due === 'today'
              ? midnight + 60_000
              : midnight + (1 + Math.floor(rand() * 17)) * DAY + 9 * HOUR

        // A spread of FSRS states, so the difficulty gauge and the "hardest
        // cards" panel have something to grade. Mostly Review (2), with a few
        // Learning (1) and Relearning (3) — the states a real deck actually holds.
        const roll = rand()
        const state = roll < 0.08 ? 1 : roll < 0.16 ? 3 : 2
        const lapses = state === 3 ? 1 + Math.floor(rand() * 3) : Math.floor(rand() * 2)
        const reps = 3 + Math.floor(rand() * 14)
        const lastReviewT = t0 - (1 + Math.floor(rand() * 6)) * DAY - Math.floor(rand() * 8) * HOUR

        card.push({
          id,
          deckId: d.id,
          front: c.front,
          back: c.back,
          due: iso(due),
          stability: state === 2 ? 4 + rand() * 80 : 0.5 + rand() * 3,
          // 2.8 → 9.4 covers the readable range of the difficulty gauge end to end.
          difficulty: 2.8 + rand() * 6.6,
          elapsedDays: 1 + Math.floor(rand() * 9),
          scheduledDays: 1 + Math.floor(rand() * 30),
          learningSteps: state === 2 ? 0 : Math.floor(rand() * 2),
          reps,
          lapses,
          state,
          lastReview: iso(lastReviewT),
          createdAt: iso(createdAt),
          updatedAt: iso(lastReviewT),
        })
        reviewable.push(id)
      })
    })
  })

  /* -- Review history -------------------------------------------------------
   * One pass per day over the window; `isActiveDay` owns the calendar (and with
   * it both streak figures). Within an active day the reviews are scattered over
   * waking hours so the study-time curve is not a comb of identical spikes. */
  const reviewLog: Backup['tables']['reviewLog'] = []
  let logN = 0
  for (let daysAgo = 0; daysAgo < HISTORY_DAYS; daysAgo++) {
    if (!isActiveDay(daysAgo, rand)) continue
    const dayStart = midnight - daysAgo * DAY
    // Heavier days near an exam / lighter ones further back — enough variance for
    // the volume bars and the heatmap to have relief instead of a flat wash.
    const count = 6 + Math.floor(rand() * 16) + (daysAgo < 14 ? 4 : 0)
    for (let k = 0; k < count; k++) {
      const cardId = reviewable[Math.floor(rand() * reviewable.length)]!
      // 08:00 → 23:00, the hours somebody actually revises.
      const reviewT = dayStart + 8 * HOUR + Math.floor(rand() * 15 * HOUR)
      if (reviewT > t0) continue
      // ~12% Again — a retention around 88%, believable rather than flattering.
      const r = rand()
      const rating = r < 0.12 ? 1 : r < 0.26 ? 2 : r < 0.88 ? 3 : 4
      const scheduledDays = 1 + Math.floor(rand() * 30)
      reviewLog.push({
        id: `log-${logN++}`,
        cardId,
        rating,
        state: 2,
        due: iso(reviewT + scheduledDays * DAY),
        stability: 2 + rand() * 60,
        difficulty: 2.8 + rand() * 6.6,
        elapsedDays: Math.floor(rand() * 20),
        lastElapsedDays: Math.floor(rand() * 20),
        scheduledDays,
        learningSteps: 0,
        review: iso(reviewT),
        // 4 s → 26 s. The study-time chart is the integral of this, so a too-tight
        // range flattens it into a straight line.
        durationMs: 4_000 + Math.floor(rand() * 22_000),
        createdAt: iso(reviewT),
      })
    }
  }
  reviewLog.sort((a, b) => a.review.localeCompare(b.review))

  /* -- Notes, generations, exams -------------------------------------------- */

  const note: Backup['tables']['note'] = [
    {
      id: 'note-automates',
      subjectId: 'sub-tdl',
      title: 'Automates finis — chapitre 3',
      sourceType: 'md',
      originalFilename: 'automates-ch3.md',
      content: [
        '# Automates finis',
        '',
        'Un **automate fini déterministe** (AFD) est un quintuplet $(Q, \\Sigma, \\delta, q_0, F)$.',
        '',
        '## Déterminisation',
        '',
        'Construction des sous-ensembles : un état de l’AFD est un ensemble d’états de l’AFN.',
        'La clôture epsilon de $q_0$ donne l’état initial.',
        '',
        '## Minimisation',
        '',
        'On raffine la partition {finaux, non-finaux} jusqu’au point fixe (Moore), ou par',
        'fusion des classes indistinguables (Hopcroft, $O(n \\log n)$).',
      ].join('\n'),
      createdAt: iso(t0 - 5 * DAY),
      updatedAt: iso(t0 - 5 * DAY),
    },
    {
      id: 'note-graphes',
      subjectId: 'sub-algo',
      title: 'Graphes — notes manuscrites du TD 4',
      // The photo-OCR path (`POST /api/notes/extract-image`) is a shipped
      // feature; the import screen should show a note that came through it.
      sourceType: 'image',
      originalFilename: 'td4-graphes.jpg',
      content: [
        '# TD 4 — plus courts chemins',
        '',
        'Dijkstra : file de priorité, poids ≥ 0. Complexité $O((V+E)\\log V)$ avec un tas binaire.',
        '',
        'Bellman-Ford : $V-1$ relaxations de toutes les arêtes, puis une passe de détection',
        'de cycle absorbant. Accepte les poids négatifs.',
        '',
        'A\\* : Dijkstra + heuristique admissible $h$. Si $h$ est de plus consistante,',
        'aucun sommet n’est rouvert.',
      ].join('\n'),
      createdAt: iso(t0 - 2 * DAY),
      updatedAt: iso(t0 - 2 * DAY),
    },
  ]

  const generation: Backup['tables']['generation'] = [
    {
      id: 'gen-1',
      noteId: 'note-automates',
      deckId: 'deck-automates',
      kind: 'cards',
      status: 'succeeded',
      model: 'claude-sonnet-4-6',
      items: [
        {
          id: 'gi-1',
          front: 'Qu’est-ce qu’un automate fini déterministe ?',
          back: 'Un quintuplet (Q, Σ, δ, q₀, F) avec δ totale.',
          status: 'accepted',
          cardId: 'card-deck-automates-1',
        },
        {
          id: 'gi-2',
          front: 'Comment déterminiser un AFN ?',
          back: 'Construction des sous-ensembles.',
          status: 'accepted',
          cardId: 'card-deck-automates-4',
        },
        {
          id: 'gi-3',
          front: 'Principe de la minimisation d’un AFD (Moore) ?',
          back: 'Raffinement de partition jusqu’au point fixe.',
          status: 'accepted',
          cardId: 'card-deck-automates-8',
        },
        { id: 'gi-4', front: 'Qu’est-ce qu’un état ?', back: '…', status: 'rejected' },
      ],
      promptTokens: 1_840,
      completionTokens: 620,
      error: null,
      createdAt: iso(t0 - 4 * HOUR),
      updatedAt: iso(t0 - 4 * HOUR),
    },
    {
      id: 'gen-2',
      noteId: 'note-automates',
      deckId: 'deck-grammaires',
      kind: 'quiz',
      status: 'succeeded',
      model: 'claude-sonnet-4-6',
      items: [
        {
          id: 'gq-1',
          front:
            'Pourquoi une grammaire récursive à gauche bloque-t-elle un analyseur descendant ?',
          back: 'B) L’analyseur boucle sans consommer de symbole.',
          status: 'accepted',
          cardId: 'card-deck-grammaires-7',
        },
        {
          id: 'gq-2',
          front: 'Que contient FOLLOW(A) ?',
          back: 'Les terminaux pouvant suivre A.',
          status: 'accepted',
          cardId: 'card-deck-grammaires-6',
        },
      ],
      promptTokens: 1_120,
      completionTokens: 340,
      error: null,
      createdAt: iso(t0 - 27 * HOUR),
      updatedAt: iso(t0 - 27 * HOUR),
    },
    {
      id: 'gen-3',
      noteId: 'note-graphes',
      deckId: 'deck-graphes',
      kind: 'cards',
      status: 'succeeded',
      model: 'claude-sonnet-4-6',
      items: [
        {
          id: 'gg-1',
          front: 'Quelle est la limite de l’algorithme de Dijkstra ?',
          back: 'Il suppose des poids positifs ou nuls.',
          status: 'accepted',
          cardId: 'card-deck-graphes-1',
        },
        {
          id: 'gg-2',
          front: 'Que fait Bellman-Ford de plus que Dijkstra ?',
          back: 'Poids négatifs + détection de cycle absorbant.',
          status: 'accepted',
          cardId: 'card-deck-graphes-2',
        },
      ],
      promptTokens: 780,
      completionTokens: 210,
      error: null,
      createdAt: iso(t0 - 2 * DAY - 3 * HOUR),
      updatedAt: iso(t0 - 2 * DAY - 3 * HOUR),
    },
  ]

  const exam: Backup['tables']['exam'] = [
    {
      id: 'exam-partiel',
      title: 'Partiel Théorie des langages',
      date: iso(midnight + 6 * DAY + 8 * HOUR),
      notes: null,
      createdAt: iso(t0 - 24 * DAY),
      updatedAt: iso(t0 - 24 * DAY),
    },
    {
      id: 'exam-archi',
      title: 'DS Architecture',
      date: iso(midnight + 13 * DAY + 13 * HOUR),
      notes: null,
      createdAt: iso(t0 - 24 * DAY),
      updatedAt: iso(t0 - 24 * DAY),
    },
    {
      id: 'exam-oral',
      title: 'Oral d’anglais',
      date: iso(midnight + 22 * DAY + 10 * HOUR),
      notes: null,
      createdAt: iso(t0 - 12 * DAY),
      updatedAt: iso(t0 - 12 * DAY),
    },
  ]

  const examSubject = [
    { examId: 'exam-partiel', subjectId: 'sub-tdl' },
    { examId: 'exam-archi', subjectId: 'sub-archi' },
    { examId: 'exam-oral', subjectId: 'sub-anglais' },
  ]

  return {
    engramBackup: 1,
    exportedAt: iso(t0),
    appVersion: serverAppVersion(),
    schema: currentSchemaTag(),
    tables: { subject, deck, card, reviewLog, note, generation, exam, examSubject },
  }
}
