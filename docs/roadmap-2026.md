# engram — Roadmap 2026 (post-Phase 7)

_Juge produit — synthèse des trois lentilles (apprentissage / friction / infra) + contexte clawdeck. Priorisation honnête : ROI réel, coût réel, risque réel. Aucune idée gardée « au cas où »._

---

## 0. État du monde (le décor qui cadre tout)

Les 8 phases sont livrées. L'app tourne désormais **sur Vercel serverless + Supabase Postgres cloud** (`engram.alexabriel.com`), plus en localhost. Trois faits changent la donne par rapport à la vision d'origine :

1. **Le « multi-device » est déjà résolu** par le cloud : n'importe quel navigateur connecté voit le même état FSRS. Le seul manque multi-device restant, c'est l'**offline**. Ne pas reconstruire un moteur de sync.
2. **L'app est sur le web public**, protégée uniquement par Vercel Authentication (barrière navigateur/SSO). Ça suffit pour Alex derrière son écran, mais **aucun appelant machine** (cron clawdeck, daemon Obsidian sur le Mac mini) ne peut franchir cette barrière proprement. D'où le besoin d'un **token applicatif** dès qu'on veut intégrer quoi que ce soit.
3. **L'Ollama local de clawdeck est injoignable depuis Vercel** (localhost/Tailscale). Toute la promesse « génération IA gratuite/privée » se heurte à ça. La lentille apprentissage supposait un déploiement localhost — ce n'est plus le cas. Voir arbitrage (a) ci-dessous.

Deux angles morts de fond côté **apprentissage** (le cœur de valeur de l'app), confirmés dans le code : les poids FSRS sont ceux **par défaut** (jamais optimisés sur l'historique d'Alex, `request_retention` figé à 0.9), les cartes sont **front/back Markdown only** (le `kind: 'quiz'` actuel n'est qu'un texte à options, non interactif), et **rien ne régule le flux de cartes neuves** — première cause d'effondrement de rétention après une grosse génération IA.

### Deux décisions à trancher AVANT de coder (ne pas les payer « au cas où »)

- **(a) Où vit engram ?** Rester sur Vercel = confort de déploiement mais Ollama gratuit exclu et pas de watcher FS. Rapatrier sur le Mac mini (à côté de clawdeck) = Ollama gratuit + watcher Obsidian natif, mais on perd le serverless managé. **Recommandation** : rester Vercel ; traiter Ollama et le watcher comme des **daemons côté Mac mini** qui parlent à l'API publique via token. On garde le meilleur des deux mondes sans migration.
- **(b) Engage-t-on vraiment le multi-utilisateur ?** L'auth Supabase « vraie » entraîne une dette schéma lourde (`user_id` sur les 8 tables + RLS). Elle ne sert qu'au partage public v2 et au multi-compte. **Recommandation** : ne PAS coder l'auth tant que le multi-user n'est pas engagé ; un simple token en env suffit en mono-user, et le partage de decks se fait très bien par fichier (v1) sans auth.

---

## 1. Top 5 des prochains chantiers (ordre = priorité réelle)

Fil directeur : **d'abord protéger l'existant** (le pire scénario est irréversible), **puis les leviers d'apprentissage à coût S** (meilleur ratio), **puis les intégrations demandées** (clawdeck cheap, Obsidian plus lourd), **puis le gros levier structurel** (cloze).

---

### Chantier 1 — Filet de sécurité : backup automatique off-site — **P0, effort S–M**

**Pourquoi maintenant.** C'est l'assurance la moins chère du projet et la seule vraie protection contre un désastre irréversible. Perdre l'état FSRS (stability / difficulty / reps / lapses) accumulé sur des mois = catastrophe non rattrapable. Risque **concret et proche** : le free tier Supabase **met un projet en pause après ~1 semaine d'inactivité** et plafonne stockage/lignes — une pause, une purge ou une migration ratée effacerait tout. Toute la logique existe déjà (`backup.service.ts` : export/import JSON versionné, tag de schéma drizzle, 409, atomique) ; elle est juste **déclenchée à la main** dans Réglages.

**Contenu v1.** Planifier l'export (Vercel Cron _ou_ un launchd sur le Mac mini via Tailscale) → pousser le JSON dans un bucket Supabase Storage **et** sur le disque du Mac mini → rotation des N derniers. **Tester une restauration une fois pour de vrai** (un backup jamais restauré n'est pas un backup).

**Dépendances.** Un scheduler + une destination. Le token (chantier 3) si l'export est déclenché par un appel externe.

**Risques & garde-fous.** Faibles. Ne jamais committer les creds de bucket (`.env` / env Vercel). Vérifier que l'export off-site vit **hors** de Supabase (sinon l'assurance ne couvre pas la panne Supabase elle-même).

---

### Chantier 2 — Cœur d'apprentissage : régulation du flux + qualité de la matière — **P0, effort S** (bundle)

Quatre leviers d'apprentissage à effort S chacun, qui améliorent le **quotidien immédiatement** et exploitent des données/algos déjà présents mais dormants. À faire ensemble : ils touchent le même terrain (file de dues + rendu de carte + réglage FSRS).

- **Limite de cartes neuves/jour + pacing (LE levier #1 de rétention).** Sans plafond, importer 200 cartes IA d'un chapitre crée une avalanche de dues 3 jours plus tard → Alex décroche → la rétention s'effondre. Un plafond (15–20 neuves/jour) + un ordre d'introduction (par deck/position) lisse la charge. La file (`review-queue.service.ts`) sépare déjà l'état `New` ; il manque un compteur de neuves introduites aujourd'hui (fuseau local déjà géré par `lib/day.ts`) + un réglage. Se branche au study-plan pour projeter la charge honnêtement.
- **Interleaving (« Réviser toute la matière, mixte »).** Le backend supporte déjà les filtres `deckId`/`subjectId` ; l'UI pousse au blocage (un deck à la fois). Offrir une entrée qui **mélange les dues** de plusieurs decks d'une matière améliore la discrimination entre concepts voisins (effet robuste en algo/maths). ⚠️ Interleaver les **dues**, mais pacer les **neuves** (ne pas casser l'ordre d'introduction).
- **Rendu LaTeX/KaTeX des maths.** EPITA = théorie des langages, complexité, logique. Aujourd'hui `O(n \log n)`, quantificateurs et matrices s'affichent en texte brut → cartes ambiguës. Ajouter `remark-math` + `rehype-katex` au pipeline `markdown.tsx`, autoriser le balisage KaTeX dans la sanitisation (sans rouvrir la surface XSS), self-host la police/CSS KaTeX (CSP/offline OK), lazy-load sur les cartes qui contiennent des maths (budget bundle Phase 7).
- **Rétention-cible réglable (`request_retention`).** Le point de réglage est déjà commenté dans `fsrs.ts`. Exposer un réglage global (puis par matière) laisse Alex arbitrer effort/rétention selon l'enjeu d'un partiel. Effort S ; **indépendant** de l'optimiseur de poids (qui, lui, exige du volume → backlog).

**Dépendances.** Aucune bloquante. **Risques.** Faibles ; le seul point de vigilance est la définition « carte neuve introduite aujourd'hui » (déjà outillée) et la sanitisation KaTeX.

---

### Chantier 3 — Synergies clawdeck réalistes : token API + rappel WhatsApp — **P0/P1, effort S** _(section obligatoire)_

Le meilleur ratio effort/valeur de tout le lot, parce qu'il **réutilise une infra qui existe déjà des deux côtés de la machine d'Alex**. À cadrer honnêtement : ce qui « watch » ou « pushe » ne peut pas vivre dans engram-Vercel — ça vit **côté clawdeck (Mac mini)** et **tire** l'API publique d'engram.

**3a. Token API partagé — prérequis transverse (effort S).** Un `X-Engram-Token` unique (secret en env Vercel + header) sur les routes de mutation et les endpoints exposés aux intégrations. Sans lui, brancher WhatsApp ou Obsidian expose le planning de révision et la capacité d'écriture sur le web public (Vercel Auth ne couvre pas les appelants machine). C'est le déblocage de **3b, du chantier 4 (Obsidian), et de tout futur script**. Middleware Hono + un secret ; les contrats Zod et l'enveloppe d'erreur unique sont déjà propres. Garde-fou : mono-secret = si fuité tout tombe → acceptable en perso, mais ce **n'est pas** de l'auth multi-compte.

**3b. Rappel quotidien WhatsApp (effort S côté engram — l'endpoint existe).** `/api/study-plan/today` calcule déjà dues + retard + boost exams. Un cron côté clawdeck (Mac mini) `GET` cet endpoint (protégé par 3a) → message via le canal WhatsApp d'OpenClaw : « 12 cartes dues, +5 en retard, exam Logique dans 3j ». La rétention meurt de l'oubli d'ouvrir l'app ; WhatsApp est le canal qu'Alex regarde déjà. **Sens de flux correct** : clawdeck **tire** l'API publique (pas engram-Vercel qui pousse dans le Tailscale). Cadence : 1×/jour + veille d'exam, sinon spammy.

**3c. Verdict Ollama — honnête (à ranger, pas à coder maintenant).** L'Ollama local de clawdeck offrirait une génération gratuite/privée, et le générateur est **déjà injectable** (`get/set/resetCardGenerator`) — l'intégration serait triviale. **Mais** une fonction Vercel ne peut pas joindre un Ollama localhost/Tailscale : **bloqué par l'archi actuelle**. Deux voies honnêtes, aucune à faire tant qu'un vrai besoin de coût/offline n'existe pas : (i) exposer Ollama derrière la gateway OpenClaw authentifiée, joignable par Vercel ; (ii) rapatrier engram sur le Mac mini (arbitrage (a)). Tant qu'on est serverless, **c'est un gadget** — voir « Rejetées ».

**3d. Carte de santé engram dans clawdeck (nice-to-have, vit dans le repo clawdeck).** clawdeck est déjà un dashboard de santé self-hosted ; un panneau « engram : X dues, dernier backup, statut API » est cheap et cohérent. Effort S, hors repo engram.

**Dépendances.** 3a d'abord ; gateway OpenClaw joignable pour 3b/3c. **Risques.** Couplage de deux projets perso (dispo de clawdeck), fatigue de notifications si mal cadencé.

---

### Chantier 4 — Intégration Obsidian : import one-way du vault Markdown — **P1, effort L** _(section obligatoire, demandée par Alex)_

**Ce qu'Alex a demandé, et pourquoi c'est un vrai pont.** Alex vit dans ses cours en Markdown. Transformer « mes notes » en « mes cartes » sans re-taper est le pont capture→révision qui manque : aujourd'hui l'import est **one-shot** (upload MD/PDF manuel). Un flux continu depuis le vault colle au workflow réel d'un étudiant.

**Architecture (contrainte non négociable).** engram-Vercel ne peut PAS watcher un système de fichiers. Le composant qui surveille le vault est un **petit daemon local sur le Mac mini** (voisin architectural de clawdeck), qui **pousse** les `.md` changés vers `POST /api/notes` (puis la génération IA existante). C'est le même patron que le rappel WhatsApp : le Mac mini parle à l'API publique.

**Contenu v1 — la tranche mince à livrer (résister au scope creep).**

- **Sens unique Obsidian → engram, point.** La synchro **bidirectionnelle est un piège** (conflits, écrasement de notes, boucles) — hors scope explicite.
- **Un dossier surveillé** (ou un sous-ensemble via tag/frontmatter, ex. `#engram`), déclenché **à la sauvegarde**, pas en temps réel.
- **Dédup / upsert idempotent** par identité stable : `frontmatter.id` (généré si absent) ou chemin normalisé. C'est **le vrai coût** et le vrai risque : sans identité stable, ré-import en boucle et cartes en double. Réutiliser l'infra d'upsert de notes existante.
- **Mapping matière** : frontmatter `subject:` → `subject` engram (création si absent), sinon dossier → matière.
- **Génération IA** : la note importée alimente le pipeline existant (preview + review humaine carte par carte avant insertion — ne jamais insérer aveuglément). Le cloze (chantier 5) rendra cette génération bien plus dense sur les définitions/théorèmes ; bon ordre : Obsidian d'abord (le tuyau), cloze ensuite (le débit).

**Dépendances.** Chantier 3a (token, pour écrire sur l'API publique) ; le daemon vit sur le Mac mini.

**Risques & garde-fous.** Scope creep vers le 2-way = le danger principal → verrouiller la tranche « un dossier, one-way, upsert idempotent ». Doublons si la dédup est faible. **Honnêteté** : c'est le chantier le plus lourd des cinq (L) et sa valeur dépend du fait qu'Alex **vive réellement dans Obsidian** — puisqu'il l'a demandé, on le construit, mais on **valide le format de son vault sur un échantillon réel avant d'industrialiser** le mapping.

---

### Chantier 5 — Cloze deletions (occultation) comme type de carte de première classe — **P1, effort M**

**Pourquoi c'est le gros levier structurel d'apprentissage.** Pour un étudiant EPITA, le cloze est le format le plus rentable sur définitions, énoncés de théorèmes, syntaxes, étapes d'algo, tables de vérité : rappel **actif et atomique dans son contexte**, là où le front/back pousse à des cartes trop grosses. C'est le format le plus utilisé d'Anki pour une raison, et il **débloque une génération IA bien plus dense** à partir des notes (donc synergie directe avec le chantier 4).

**Contenu.** Nouveau champ de carte (`cloze` : texte `{{c1::…}}` + template), parser, rendu (masquer/révéler par index) dans le Markdown existant, et **une carte FSRS par occultation** (c1, c2… = cartes distinctes partageant le texte). Étendre `cardSchema` (front/back) **sans casser l'existant** + migration. La session (Phase 2, machine à états pure) doit gérer « une note-cloze → N cartes ». Le prompt `cards.v1.ts` gagne un mode cloze.

**Dépendances.** Rendu Markdown en place ; idéalement après le chantier 4 (le tuyau) pour en tirer parti immédiatement.

**Risques & garde-fous.** Le **vrai coût est le modèle de données** (partage de texte entre cartes-sœurs) et la migration. Bien cadrer pour ne pas fragiliser l'état FSRS existant.

**Suite naturelle (backlog, pas ici) :** l'**optimisation des poids FSRS sur l'historique d'Alex** — même famille de valeur, mais elle exige ~1000+ reviews pour être fiable (garde-fou « pas d'optim sous N reviews ») et l'optimiseur n'est pas dans ts-fsrs. Donc plus tard, quand le volume sera là.

---

## 2. Backlog priorisé (S / M / L)

Classé par taille, puis par valeur décroissante à l'intérieur. « ROI » = jugement produit honnête.

### Taille S (petits paris, à piocher au fil de l'eau)

| Idée                                                  | Valeur / note honnête                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Dépendances                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **Partage de decks EPITA — v1 « fichier »**           | Vrai différenciateur social à coût minime : export JSON **au niveau deck en retirant l'état FSRS et les review_log** (le recto/verso est partageable, la planification est personnelle). Import = cartes fraîches (`insertFreshCardRow` existe). Zéro compte, zéro schéma. Effet réseau sur une promo au syllabus commun. **Candidat sérieux à monter dans le top 5 si Alex veut mutualiser ses fiches.** ⚠️ Ne JAMAIS exporter l'état de révision (fuite de rythme perso + corruption FSRS chez le destinataire). | Aucune                                                                       |
| **Détection de leeches + réécriture/scission IA**     | `review_log` trace déjà `lapses`. Repérer les cartes à lapses ≥ seuil (souvent mal formulées) et proposer une réécriture IA (le prompt sait exiger l'atomicité). ROI-temps concret.                                                                                                                                                                                                                                                                                                                                | Module IA ; décision « garder l'état FSRS ou repartir neuf » à la réécriture |
| **Garde-fous coûts IA (estimation tokens + plafond)** | Compter les tokens (dispo dans la réponse SDK), afficher un coût estimé/génération + plafond mensuel. Assurance quasi gratuite dès qu'on génère en masse. Légèrement gadget seul.                                                                                                                                                                                                                                                                                                                                  | —                                                                            |

### Taille M (features à part entière, à cadrer)

| Idée                                                              | Valeur / note honnête                                                                                                                                                                                                                                                                                                                            | Dépendances                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| **PWA installable + ergonomie tactile**                           | Réviser dans le métro / entre deux amphis. Manifest + service worker (`vite-plugin-pwa`) + rendre la session **jouable au doigt** (tap = révéler, zones/swipe = rating 1-4, cibles ≥ 44px). **Verrou** de toute promesse « mobile/quotidien ». Non fait aujourd'hui (session 100% clavier). Sérieux candidat top 5 si Alex révise sur téléphone. | Garder le flow clavier intact                 |
| **Vrai QCM noté (retrieval + feedback immédiat)**                 | Remplace le `quiz` gadget actuel : sélection clavier 1-4, correction immédiate, **rating FSRS dérivé de la justesse**. Testing effect avec feedback. ⚠️ Biais de reconnaissance → **entraînement, pas format par défaut**.                                                                                                                       | Session + file de dues                        |
| **Import ICS agenda EPITA → exams auto**                          | Abonnement/upload `.ics` → heuristique événement→`exam`, alimente le boost FSRS déjà codé (`ceil(n/7)`). Supprime la saisie manuelle des échéances. ⚠️ Validation « accepter/ignorer » (un TD n'est pas un exam), pas d'auto-création aveugle.                                                                                                   | Token (3a) ; qualité de l'ICS EPITA           |
| **Quick-capture / Inbox + Share Target mobile**                   | Carte « brute » créable en un geste (deck _Inbox_), triée plus tard ; sur mobile, Web Share Target. Complète Obsidian pour ce qui n'y est pas. ⚠️ L'inbox devient un cimetière si le triage n'est pas rendu agréable (mini-session).                                                                                                             | PWA (share target), token                     |
| **Multi-provider IA cloud (Anthropic + OpenRouter), abstraction** | La **partie abstraction** est peu coûteuse (générateur injectable). Le multi-provider **cloud-only** est faisable partout et prépare le routage cheap/premium. Le volet **Ollama gratuit reste bloqué** par l'archi (cf. chantier 3c / arbitrage a). CLAUDE.md fige `claude-sonnet-4-6` → à débattre avec Alex avant.                            | Décision provider ; chemin réseau pour Ollama |
| **Auth Supabase (enabler, pas une feature)**                      | Valeur directe faible pour Alex seul (Vercel Auth protège déjà). Prérequis du partage v2 et du multi-user. Entraîne la **dette schéma `user_id` + RLS** sur 8 tables. **Ne coder que si le multi-user est engagé** (arbitrage b) — sinon rester Vercel Auth + partage v1.                                                                        | — (mais dette schéma lourde)                  |

### Taille L (gros paris, à besoin confirmé)

| Idée                                                    | Valeur / note honnête                                                                                                                                                                                                                                                                                                                                                                   | Dépendances                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Optimisation des poids FSRS sur l'historique d'Alex** | Le bénéfice central de FSRS que le projet n'exploite pas : ré-optimiser les 21 poids sur _son_ `review_log` réduit le nombre de reviews à rétention égale. Charger les poids depuis une table settings (globale → par matière). ⚠️ Exige ~1000+ reviews (garde-fou anti-surapprentissage) ; optimiseur hors ts-fsrs (`fsrs-rs` wasm ou job offline). Suite du chantier 5.               | Volume de `review_log`                                       |
| **Mode « examen blanc » chronométré, exam-aware**       | Échantillon pondéré par matière d'un exam, **sans feedback carte par carte**, chronométré, bilan par matière, ratés re-planifiés. Testing sous conditions proches du réel. Se déclenche depuis le compte à rebours d'exam existant. ⚠️ Taguer ces reviews dans `review_log` (source) pour ne pas polluer les analytics de rétention « spontanée ».                                      | Session + `exam`/`study-plan`                                |
| **Révision offline (file de reviews rejouée)**          | Le seul « multi-device » qui reste à gagner (le sync cloud est déjà fait). `review_log` append-only → conflits quasi nuls ; le piège est le **rejeu séquentiel ordonné** côté serveur (FSRS est stateful) + **review-id générés client** pour l'idempotence. **À ne lancer qu'APRÈS la PWA validée en usage réel** — sinon on optimise un écran que personne n'ouvre encore sur mobile. | PWA ; `POST /review` idempotent + endpoint de replay ordonné |
| **Partage de decks — v2 registre public**               | Lien public en lecture seule / registre de decks de promo. Attend une **preuve d'usage de la v1 fichier** avant d'investir.                                                                                                                                                                                                                                                             | Auth (multi-user)                                            |

---

## 3. Idées rejetées (avec la raison)

| Idée                                                             | Verdict                                            | Raison                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ollama comme provider IA _dans le déploiement Vercel actuel_** | **Rejeté tant qu'on est serverless**               | Une fonction Vercel ne peut pas joindre un Ollama localhost/Tailscale. « Gratuit/privé » n'existe que si engram tourne _à côté_ d'Ollama (Mac mini) ou via un relais gateway authentifié. Ranger jusqu'à un vrai besoin coût/offline + arbitrage (a) tranché. L'abstraction multi-provider **cloud**, elle, reste en backlog. |
| **Web Push « Réviser maintenant » (VAPID + Vercel Cron)**        | **Rejeté (redondant)**                             | Marginal une fois le rappel WhatsApp en place ; fiabilité push iOS médiocre (iOS 16.4+ requis) ; double notification. À reconsidérer seulement si Alex veut couper la dépendance à clawdeck.                                                                                                                                  |
| **Mode `quiz` actuel (options en texte, non notées)**            | **Rejeté en l'état**                               | C'est un flip-card déguisé : aucun retrieval interactif, aucun rating dérivé. Soit on le remplace par le **vrai QCM noté** (backlog M), soit on le retire. Ne pas le laisser tel quel.                                                                                                                                        |
| **Synchro Obsidian bidirectionnelle (2-way)**                    | **Rejeté (piège)**                                 | Conflits, écrasement de notes, boucles d'import. Le chantier 4 est strictement **one-way**. Hors scope explicite.                                                                                                                                                                                                             |
| **Auth Supabase « au cas où » / registre public v2 anticipé**    | **Rejeté tant que le multi-user n'est pas engagé** | Dette schéma `user_id` + RLS sur 8 tables pour une valeur directe nulle en mono-user. Payer l'auth spéculativement est le contraire d'une priorisation honnête. Voir arbitrage (b).                                                                                                                                           |
| **Gamification / streaks supplémentaires, animations en plus**   | **Rejeté (confond confort et apprentissage)**      | Au-delà de l'existant (StreakPill, flip de carte), rien de ça n'améliore la mémorisation. Ne pas confondre delight cosmétique et efficacité d'apprentissage.                                                                                                                                                                  |
| **Provider « agent OpenClaw » exotique pour la génération**      | **Rejeté (gadget)**                                | Mentionné dans le README clawdeck comme piste « exotique ». Aucun gain de qualité vs `claude-sonnet-4-6` ; complexité de couplage sans valeur.                                                                                                                                                                                |
| **Reconstruire un moteur de sync multi-device**                  | **Rejeté (déjà résolu)**                           | Vercel + Supabase cloud donne déjà l'état partagé entre navigateurs. Le seul manque réel est l'offline (backlog L).                                                                                                                                                                                                           |

---

## 4. Ordre d'attaque recommandé

1. **Chantier 1** (backup auto) — protéger l'existant avant tout.
2. **Chantier 2** (limite neuves + interleaving + KaTeX + rétention-cible) — meilleur ROI d'apprentissage, effort S, améliore le quotidien tout de suite.
3. **Chantier 3** (token + WhatsApp) — cheap, exploite l'infra existante des deux côtés ; le token débloque la suite.
4. **Chantier 4** (Obsidian one-way) — la demande d'Alex ; le tuyau capture→révision.
5. **Chantier 5** (cloze) — le gros levier de format, qui donne du débit au tuyau Obsidian.

Puis, selon usage réel : **partage de decks v1** (S, différenciateur social) et **PWA tactile** (M, verrou mobile) sont les deux premiers à remonter du backlog. L'**optim des poids FSRS** attend le volume ; l'**offline** attend que le mobile soit réellement utilisé.
