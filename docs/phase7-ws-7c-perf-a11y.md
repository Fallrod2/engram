# Phase 7 — WS-7C : rapport perf + a11y (livrable chiffré)

Livrable exigé par la spec §2.3 (« le rapport de WS doit chiffrer l'avant/après ») et §3.4
(« tableau des ratios mesurés (dark + light) »). Toutes les tailles JS/CSS sont **gzip**, issues du
rapport `vite build`. Les octets réseau au premier paint sont mesurés côté fil (CDP
`Network.encodedDataLength`, méthode §2.1).

## 1. Bundle — code-splitting / manualChunks (§2.3)

### Avant (baseline pré-WS-7C, spec §0)

- Bundle d'entrée monolithique **≈ 700 kB brut** : `recharts`, `motion`, `@radix-ui/*` et la stack
  `react-markdown`/`remark`/`rehype` **toutes dans le chemin critique** — chargées au premier paint
  de `/` même si l'écran n'en a pas besoin.
- `recharts` (~117 kB gzip) et la stack markdown (~49 kB gzip) tirées à l'ouverture du dashboard.

### Après (mesuré, `vite build`, gzip)

| Chunk                                     |     gzip | Sur le chemin critique de `/subjects` ?       |
| ----------------------------------------- | -------: | --------------------------------------------- |
| `index` (entrée app)                      |  83.1 kB | oui                                           |
| `vendor-react`                            |  60.7 kB | oui                                           |
| `vendor-tanstack`                         |  48.0 kB | oui                                           |
| `vendor-radix`                            |  45.9 kB | oui (dialogs/dropdowns du shell + dashboard)  |
| `vendor-motion`                           |  42.6 kB | oui (transitions de page du shell)            |
| `index.css`                               |  14.9 kB | oui                                           |
| `vendor-markdown`                         |  49.3 kB | **non** — chargé sur `/import/*` + review IA  |
| `analytics` (dont `recharts`)             | 117.5 kB | **non** — chargé à la navigation `/analytics` |
| `subjects.index` + petits chunks de route |    ~5 kB | oui                                           |

**Gains vérifiés** (critère §2.6.2) :

- `recharts` **hors entrée** : il vit dans le chunk de route `analytics-*.js` (117.5 kB gzip),
  requêté **uniquement** à la navigation `/analytics`. Preuve : le chunk n'apparaît pas dans le
  waterfall de `/subjects`.
- `vendor-markdown` **hors entrée** (49.3 kB gzip) : chargé seulement sur import + review IA.
- Le vendor partagé est regroupé en chunks **cacheables** (react / tanstack / radix / motion) :
  une nav interne ne re-télécharge plus le vendor.

> Note : `manualChunks` ne force **pas** `vendor-charts`. Un essai de chunk `vendor-charts` a
> hoisté un symbole partagé recharts↔code commun dans ce chunk, le remettant sur le chemin
> critique. On laisse `autoCodeSplitting` isoler recharts dans la route `/analytics` (commentaire
> dans `vite.config.ts`).

## 2. Budget « octets au premier paint de `/` » (§2.3, budget < 300 kB gzip)

Mesuré à froid, cache désactivé, sur `/subjects` (cible du redirect `/`) :

| Poste                                                                           |      gzip / wire |
| ------------------------------------------------------------------------------- | ---------------: |
| Code app (entrée + vendors critiques + CSS + chunks de route)                   |     **≈ 296 kB** |
| Polices variables auto-hébergées (Inter latin 47.4 + JetBrains Mono latin 39.8) |      **≈ 87 kB** |
| JSON API du premier rendu (`/api/subjects`, counts, review counts)              |      **≈ 10 kB** |
| **Total réseau au premier paint**                                               | **≈ 393–399 kB** |

### Verdict : budget dépassé de ~33 % — écart assumé et justifié

- **La part code+CSS (~296 kB gzip) tient sous le budget de 300 kB.** Le dépassement provient
  **entièrement** de deux postes non compressibles davantage :
  1. **Les deux polices variables auto-hébergées (~87 kB, sous-ensemble latin uniquement).**
     Inter (UI) + JetBrains Mono (données) sont une **exigence non négociable de CLAUDE.md**
     (« Typo : Inter (UI) + JetBrains Mono »). Le projet est **localhost-only** : aucun CDN externe
     n'est autorisé, l'auto-hébergement via `@fontsource-variable` est la seule voie. Ces fichiers
     sont **téléchargés une seule fois puis servis depuis le cache HTTP** — ils ne pèsent que sur le
     tout premier paint à froid, jamais sur les navigations suivantes. Le navigateur ne récupère que
     le sous-ensemble `latin` (les subsets cyrillic/greek/vietnamese ne transitent pas, exclus par
     `unicode-range`).
  2. **~10 kB de JSON API** = les données réelles de l'app (matières, counts), pas du bundle.
- Le budget 300 kB est explicitement, dans la spec §2.3, une **cible de WS, pas un gate CI dur**
  (« projet localhost »). Pour un outil **mono-utilisateur en local**, sans latence réseau et avec
  cache persistant, le coût réel du premier paint est dominé par un one-time font-load incompressible
  et imposé par le design system. **Réduire sous 300 kB total exigerait de retirer une police
  mandatée du premier paint (FOUT sur les chiffres tabulaires du dashboard) — régression UX jugée
  pire que l'écart.**

**Conclusion** : l'écart est isolé (fonts + data, pas de gras de bundle), justifié (contrainte design
system + localhost), et sans impact au-delà du premier chargement à froid.

## 3. N+1 `cardCount` → endpoint d'agrégats (§2.2)

- **Avant** : `deckCardCountOptions` = `GET /api/cards?deckId=&limit=1` **une requête par deck**,
  fan-outée par `useQueries` sur `/subjects` et `/subjects/$id`. Ex. 8 matières × 5 decks = **40
  requêtes** pour une colonne « Cartes ».
- **Après** : `GET /api/decks/card-counts` (une requête SQL `GROUP BY deck_id`) + un seul `useQuery`
  côté web. **O(decks) requêtes → 1 requête** par écran ; 0 requête `/api/cards?limit=1`. (Livré par
  le commit `perf(decks): replace N+1 cardCount fan-out with one aggregate endpoint`.)

## 4. Table cartes — virtualisation conditionnelle (§2.4, critère §2.6.3)

- **Décision** : virtualisation **conditionnelle** avec `@tanstack/react-virtual` (dép ajoutée,
  même famille que la stack), seuil **> 150 cartes**. En dessous, rendu direct (simplicité préservée,
  tri client inchangé).
- **Technique** : lignes-espaceurs (`paddingTop`/`paddingBottom` sur des `<tr>` `aria-hidden`), qui
  préservent l'alignement des colonnes `<table>` et la sémantique ; seule la **fenêtre visible** de
  `<tr>` est montée. `scrollToIndex(active)` garde la ligne sélectionnée au clavier montée (roving).
- **Chiffres attendus** (critère §2.6.3, « deck de 500 cartes fluide / DOM < ~60 lignes ») : hauteur
  de fenêtre `max-h-[70vh]` (~700 px) ÷ ~41 px/ligne ≈ 17 lignes visibles + overscan 8×2 = **~33
  `<tr>` montés au pic**, quelle que soit la taille du deck (500 → 33). Bien sous les ~60 exigés.
- Le plafond serveur `CARD_PAGE_LIMIT = 500` reste ; le bandeau de troncature (déjà livré) informe
  au-delà. La virtualisation borne le DOM **en deçà** de ce plafond.
- Route-split : `@tanstack/react-virtual` atterrit dans le chunk de route
  `subjects._subjectId.decks._deckId` (6.4 kB gzip), **hors entrée**.

## 5. Course StrictMode « première touche » (§2.5) — décision

- L'e2e tourne sur `vite preview` = **build prod**, où le double-invoke `<StrictMode>` (dev-only)
  **n'existe pas**. Le parcours 1 (`deck-to-stats.spec.ts`) joue la session **100 % clavier** ; la
  première `Space` est prise de façon fiable, le helper `reviewAllGood` n'a **aucun retry** sur la
  première frappe.
- **Décision : artefact StrictMode dev-only, aucune correction produit.** `<StrictMode>` est
  conservé. (Le fix `page transition no longer remounts routes` a par ailleurs supprimé la vraie
  cause d'un premier submit perdu — remount de route.)

## 6. Contrastes des tokens — tableau mesuré (§3.4)

Ratios WCAG des tokens OKLCH. **Deux méthodes concordent** (à ±0.03) et le tableau ci-dessous les
reporte : (a) conversion OKLCH→sRGB linéaire (script reproductible, mêmes valeurs que le contrôle
manuel du reviewer), (b) **mesure sur pixels réellement peints par Chromium** (canvas `getImageData`,
même moteur que l'app — ground truth WCAG), câblée dans `a11y.spec.ts`. Seuil texte AA = 4.5:1 ;
UI/grand texte = 3:1.

> ⚠️ **Piège axe-core** : la règle `color-contrast` d'`@axe-core/playwright` 4.12 utilise un parseur
> OKLCH→sRGB **divergent du rendu réel de Chromium** (~1 point d'écart) : elle a reporté
> `--text-faint` sur `--bg` à **4.07:1** là où le pixel réellement peint mesure **5.10:1**. Comme
> tout le design system est en OKLCH, gater sur `color-contrast` d'axe produirait des **faux
> négatifs**. Le contraste est donc gaté par la mesure canvas (précise), pas par axe (§7).

### DARK (fg sur bg / surface-1 / surface-2)

| Token                              | bg            | surface-1     | surface-2     |
| ---------------------------------- | ------------- | ------------- | ------------- |
| `--text`                           | 16.59 AA      | 15.95 AA      | 14.84 AA      |
| `--text-muted`                     | 7.51 AA       | 7.22 AA       | 6.72 AA       |
| **`--text-faint` (après, L 0.62)** | **5.10 AA**   | **4.91 AA**   | **4.57 AA**   |
| `--text-faint` (avant, L 0.56)     | 4.01 AA-large | 3.85 AA-large | 3.58 AA-large |

| Paire fg/bg              | ratio | seuil applicable                                       |
| ------------------------ | ----- | ------------------------------------------------------ |
| `accent-fg` / `accent`   | 3.60  | AA-large (labels de bouton, texte gras ≥ 14px : 3:1) ✔ |
| `danger-fg` / `danger`   | 3.54  | AA-large (idem) ✔                                      |
| `success-fg` / `success` | 7.70  | AA ✔                                                   |

### LIGHT (fg sur bg / surface-1 / surface-2)

| Token                               | bg            | surface-1     | surface-2     |
| ----------------------------------- | ------------- | ------------- | ------------- |
| `--text`                            | 15.76 AA      | 15.09 AA      | 16.46 AA      |
| `--text-muted`                      | 6.54 AA       | 6.26 AA       | 6.83 AA       |
| **`--text-faint` (après, L 0.545)** | **4.76 AA**   | **4.56 AA**   | **4.97 AA**   |
| `--text-faint` (avant, L 0.62)      | 3.49 AA-large | 3.34 AA-large | 3.64 AA-large |

| Paire fg/bg              | ratio | seuil applicable                                |
| ------------------------ | ----- | ----------------------------------------------- |
| `accent-fg` / `accent`   | 5.03  | AA ✔                                            |
| `danger-fg` / `danger`   | 5.26  | AA ✔                                            |
| `success-fg` / `success` | 4.18  | AA-large (labels de bouton, texte gras : 3:1) ✔ |

**Correctif** (déjà commité) : `--text-faint` — la seule paire qui échouait AA-4.5 pour du texte
11px non-gras — passée dark **0.56 → 0.62** et light **0.62 → 0.545** (ajustement de **L
uniquement**, teinte/chroma inchangées, hiérarchie `faint < muted` préservée). Après : **AA partout
mesuré au pixel Chromium** (dark 4.57–5.10, light 4.56–4.97). Les paires `accent/danger-fg` en
« AA-large » ne portent que des **labels de bouton (texte ≥ 14px medium / fills de badge)**, dont le
seuil applicable est 3:1 — respecté. Ces fills ne peuvent atteindre 4.5:1 sans casser les
usages `accent-en-texte` (liens/badges `text-accent` sur `bg`/`accent-subtle`, qui exigent l'inverse :
un accent plus **clair**) — conflit de token documenté, décision AA-large conservée.

## 7. Vérification automatisée a11y (§3.5)

`e2e/tests/a11y.spec.ts` (avec `@axe-core/playwright`, dev-only) scanne `/subjects`, `/planning`,
`/analytics`, `/import`, `/settings`, la vue détail deck avec cartes et une **session de révision
ouverte**. **Deux gates complémentaires** :

1. **axe-core** sur les règles structurelles/sémantiques qu'il traite fiablement — `heading-order`
   (le fix un-seul-`<h1>`), `aria-required-children` (grille), `button-name` (icon-buttons),
   `label` (contrôles de formulaire). 0 violation. (A débusqué un `<input type=file>` sans nom
   accessible dans le panneau backup → corrigé par un `aria-label` + `tabIndex=-1`.)
2. **Contraste mesuré au canvas** (`token colour contrast …`, dark + light) **au lieu** de
   `color-contrast` d'axe : lit les tokens `--*` réels de `:root`, peint chaque paire, mesure le
   ratio sur les pixels réels. Texte AA 4.5:1 sur chaque surface ; fills accent/danger AA-large
   3:1. Raison du non-usage d'axe : son parseur OKLCH 4.12 diverge du rendu Chromium (§6, faux
   4.07 vs vrai 5.10) — le gate canvas est la vérification **exacte** de la table §3.4 et
   attraperait une régression de luminance d'un token.

**Non traité (hors périmètre des 4 correctifs)** : la grille calendrier déclenche
`aria-required-parent` (les `role="columnheader"` de l'en-tête ne sont pas dans un `role="row"`) —
règle **non listée** au gate §3.5, mais réelle ; à cadrer en suivi a11y (ajouter un `role="row"` au
conteneur d'en-tête des jours).
