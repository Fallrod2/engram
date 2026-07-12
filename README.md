# engram

Dashboard de révision self-hosted : flashcards à répétition espacée (FSRS), import de notes et génération de cartes par IA, planning et analytics de progression.

engram est un outil personnel de révision qui repose sur un vrai moteur de répétition espacée (FSRS v5, via `ts-fsrs`) plutôt qu'une réimplémentation approximative : chaque review nourrit le calcul de la prochaine échéance et alimente les statistiques. Il est pensé d'abord pour un usage EPITA (théorie des langages, anglais, etc.), puis généraliste. Il tourne en **localhost, mono-utilisateur, sans authentification** : toutes les données restent sur la machine.

## Fonctionnalités

- **Matières, decks, cartes** — Organisation en matières (couleur, icône, archivage), decks rattachés à une matière, et cartes recto/verso en Markdown. CRUD complet côté API et UI, avec compteurs de cartes dues affichés dans la barre latérale.
- **Session de révision au clavier** — Écran plein écran, 100 % pilotable au clavier : révéler la carte (Espace), noter de 1 à 4 avec prévisualisation des intervalles FSRS pour chaque note, barre de progression, résumé de fin de session (répartition des notes, temps, taux de réussite). Flip de carte animé, gestion des états pause/inactivité, rendu Markdown assaini.
- **Import MD/PDF + génération IA avec review humaine** — Upload de notes Markdown ou PDF (extraction de texte via `unpdf`), prévisualisation, puis génération de cartes par Claude. Chaque carte proposée passe par une review humaine carte par carte (accepter / éditer / rejeter / annuler) avant insertion réelle en base. La génération est optionnelle : sans clé API, l'import et tout le reste fonctionnent.
- **Planning et examens** — Vue calendrier mois/semaine, charge de révisions projetée par jour (dérivée des cartes dues FSRS), examens datés rattachés à des matières avec compte à rebours, et un panneau « à réviser aujourd'hui ». Les examens proches augmentent la charge suggérée sur les jours qui précèdent.
- **Analytics de progression** — Heatmap d'activité type GitHub, streaks, temps d'étude, volume de reviews et rétention par matière. Graphes Recharts doublés d'une vue tabulaire accessible.

## Stack technique

| Domaine                   | Choix                                                                            |
| ------------------------- | -------------------------------------------------------------------------------- |
| Runtime / tooling / tests | Bun (runtime, package manager, test runner)                                      |
| Backend                   | Hono (REST)                                                                      |
| Base de données           | SQLite via Drizzle ORM (`data/engram.db`), migrations Drizzle                    |
| Répétition espacée        | ts-fsrs (FSRS v5+)                                                               |
| Frontend                  | React 19 + Vite                                                                  |
| Routing / data            | TanStack Router (file-based) + TanStack Query                                    |
| UI                        | Tailwind CSS v4, shadcn/ui, `motion` (animations), Recharts (graphes)            |
| Validation / types        | Zod — schémas partagés dans `packages/shared` (source de vérité unique de l'API) |
| IA                        | API Anthropic côté serveur uniquement (`claude-sonnet-4-6`)                      |
| Extraction PDF            | unpdf                                                                            |

## Démarrage

### Prérequis

- [Bun](https://bun.sh) (le projet a été développé sous Bun 1.3.x)

### Installation

```bash
bun install
```

### Configuration

Copiez le fichier d'exemple d'environnement et renseignez la clé API si vous voulez la génération IA :

```bash
cp .env.example .env
```

- `ANTHROPIC_API_KEY` — **optionnelle**. Sans elle, tout fonctionne (import, sessions, planning, analytics) ; seule la génération de cartes par IA renvoie une erreur propre (503). Renseignez-la pour activer la génération réelle. Ne jamais la committer.
- `ENGRAM_DB_PATH` — override optionnel du chemin de la base SQLite (par défaut `data/engram.db`), surtout utilisé par les tests et l'outillage.

### Base de données

```bash
bun run db:migrate   # applique les migrations Drizzle (crée data/engram.db)
```

### Lancer en développement

```bash
bun run dev          # serveur Hono sur :3001 + web Vite sur :5173 (proxy /api → :3001)
```

L'application est alors accessible sur http://localhost:5173.

### Autres commandes

```bash
bun run check        # typecheck (tsc --noEmit) + lint (eslint) + format check (prettier)
bun run test         # vitest (unitaire + rendu web) puis test:db (intégration SQLite sous bun test)
bun run test:db      # uniquement les tests d'intégration DB (bun test, bun:sqlite)
bun run db:migrate   # migrations Drizzle
bun run db:studio    # Drizzle Studio (exploration de la base)
bun run db:generate  # génère une migration à partir du schéma
```

> Les tests d'intégration base de données tournent sous `bun test` (et non Vitest) car ils utilisent `bun:sqlite`, indisponible sous Node. La commande `bun run test` enchaîne les deux.

## Structure du monorepo

```
engram/
├── apps/
│   ├── server/          # Hono + Drizzle + services (fsrs, import, ai)
│   │   └── src/
│   │       ├── routes/  # subjects, decks, cards, review, notes,
│   │       │            #   generations, exams, study-plan, analytics
│   │       ├── db/      # schéma Drizzle, migrations, mappers FSRS
│   │       ├── ai/      # client Anthropic + prompts versionnés
│   │       ├── services/
│   │       └── http/    # enveloppe d'erreur, validation
│   └── web/             # React 19 + Vite
│       └── src/
│           ├── routes/      # TanStack Router file-based
│           ├── features/    # review, planning, analytics, cards…
│           ├── components/  # shell, ui (shadcn), import…
│           └── lib/
├── packages/shared/     # schémas Zod + types API (contrat unique)
└── data/                # SQLite (engram.db, gitignored)
```

## Raccourcis clavier principaux

Globaux (barre latérale / navigation) :

| Touche               | Action                                |
| -------------------- | ------------------------------------- |
| `⌘K` / `Ctrl+K`      | Ouvrir/fermer la command palette      |
| `⌘1`…`⌘9`            | Aller à l'entrée de navigation n° 1…9 |
| `[`                  | Replier / déplier la barre latérale   |
| `↑` `↓` `Home` `End` | Naviguer dans la barre latérale       |

Session de révision :

| Touche              | Action                                                |
| ------------------- | ----------------------------------------------------- |
| `Espace` / `Entrée` | Révéler le verso                                      |
| `1` – `4`           | Noter la carte (Again / Hard / Good / Easy)           |
| `Échap`             | Quitter la session (confirmation), `q` pour confirmer |
| `r`                 | Rejouer une session (écran de résumé)                 |

Review de génération IA (import) :

| Touche                 | Action                                    |
| ---------------------- | ----------------------------------------- |
| `a`                    | Accepter la carte courante                |
| `Shift+A`              | Accepter toutes les cartes en attente     |
| `r`                    | Rejeter la carte courante                 |
| `e`                    | Éditer la carte courante                  |
| `u`                    | Annuler la décision sur la carte courante |
| `j` / `k` (ou `↑` `↓`) | Naviguer entre les cartes proposées       |
| `⌘Entrée`              | Insérer les cartes acceptées              |

Planning :

| Touche          | Action                                   |
| --------------- | ---------------------------------------- |
| `←` `→` `↑` `↓` | Se déplacer dans la grille du calendrier |
| `m` / `s`       | Basculer en vue Mois / Semaine           |
| `t`             | Revenir à aujourd'hui                    |
| `Entrée`        | Ouvrir le détail du jour sélectionné     |
| `n`             | Créer un examen                          |
| `e`             | Éditer l'examen du jour sélectionné      |

Édition (composers de cartes, formulaires) :

| Touche                    | Action  |
| ------------------------- | ------- |
| `⌘Entrée` / `Ctrl+Entrée` | Valider |
| `Échap`                   | Annuler |

## Notes

- **Localhost uniquement**, application web, **mono-utilisateur, sans authentification** : aucune donnée ne quitte la machine.
- Les données vivent dans `data/engram.db` (SQLite, **gitignored**). Sauvegardez ce fichier pour conserver votre historique.
- La clé `ANTHROPIC_API_KEY` n'est jamais committée ; elle n'est utilisée que côté serveur.
- La construction est jalonnée par des tags git `phase-0` → `phase-5` (fondations, cœur FSRS, session de révision, import + IA, planning, analytics), qui correspondent aux phases du projet.
