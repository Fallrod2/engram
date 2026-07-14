# Proposition de grille tarifaire — engram

> **Statut : proposition pour décision d'Alex (étude du 14/07/2026). Rien d'implémenté.** Chiffres API vérifiés (juillet 2026), chiffres concurrence issus de recherches web — à revalider avant lancement.

## 1. Benchmark concurrence (prix constatés juillet 2026)

| Produit                                | Prix                                                                           | Ce qui est gaté                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| **Anki** (desktop/Android/AnkiWeb)     | Gratuit                                                                        | Rien — référence absolue du « gratuit puissant »                   |
| **AnkiMobile** (iOS)                   | **24,99 $ une fois**                                                           | L'app iOS elle-même (finance tout l'écosystème)                    |
| **Quizlet Plus**                       | 7,99 $/mois ou **35,99 $/an (~3 $/mois)**                                      | Learn illimité, practice tests, sans pub                           |
| **Quizlet Plus Unlimited**             | 9,99 $/mois ou 44,99 $/an                                                      | Tout illimité                                                      |
| **RemNote Pro**                        | 10 $/mois, **8 $/mois en annuel** ; **-25 % EDU** (~6 $/mois) ; lifetime 395 $ | Sync illimité, PDF, images ; l'IA est un tier séparé (Pro+AI)      |
| **Mochi**                              | **5 $/mois**                                                                   | Sync + mobile (desktop gratuit)                                    |
| **SuperMemo.com**                      | ~9,90 €/mois                                                                   | Cours + plateforme                                                 |
| **Traverse**                           | **15 $/mois**                                                                  | Maps/notes/uploads illimités                                       |
| **Knowt** (concurrent AI-first direct) | Freemium généreux ; **Premium 5 $/mois (35 $/an)** ; Ultra 9,99 $/mois         | Free : PDF→cartes, transcription. Ultra : tuteur IA, photo→réponse |

**Lecture.** Le marché étudiant s'ancre entre **3 et 10 $/mois**, point de gravité à **~5 $/mois / ~36 $/an** (Quizlet annuel, Mochi, Knowt Premium). Au-dessus de 10 €/mois = territoire « outil pro ». Le gratuit doit rester réellement utilisable (barre mise haut par Anki et Knowt) — le BYOK d'engram permet un free tier complet sans coût IA.

Sources : Quizlet (aistudymaster.com/quizlet-plus-cost, quizlet.com/upgrade), RemNote (remnote.com/pricing + help EDU), Mochi (mochi.cards), AnkiMobile (flashrecall.app/blog/anki-ios-price), Traverse (traverse.link/pricing), SuperMemo (supermemo.com/en/premium-subscription), Knowt & co (studyglen.com/guides/best-ai-flashcard-generator).

## 2. Coût API réel d'un utilisateur actif (clé plateforme)

Prix API vérifiés : **claude-sonnet-4-6 = 3 $/M tokens input, 15 $/M output**. **Mistral OCR 4 = 4 $/1 000 pages** (2 $/1 000 en batch) — mistral.ai/pricing.

### 1 génération de cartes (note de ~2 000 mots)

| Poste                                     | Optimiste           | Médian              | Pessimiste          |
| ----------------------------------------- | ------------------- | ------------------- | ------------------- |
| Note 2 000 mots (FR ≈ 1,4-1,6 tok/mot)    | 2 800 tok           | 3 000 tok           | 3 200 tok           |
| Prompt système + instructions + schéma    | 800 tok             | 1 500 tok           | 2 000 tok           |
| **Input total** × 3 $/M                   | 3 600 tok → 0,011 $ | 4 500 tok → 0,014 $ | 5 200 tok → 0,016 $ |
| Output : 15-25 cartes × 80-120 tok + JSON | 1 500 tok           | 2 500 tok           | 4 500 tok           |
| **Output total** × 15 $/M                 | 0,023 $             | 0,038 $             | 0,068 $             |
| **Total / génération**                    | **0,033 $**         | **0,051 $**         | **0,084 $**         |

Le coût est dominé par l'**output** (les cartes générées). Levier n°1 : borner le nombre de cartes par génération (ex. 25 max) et garder un format de sortie compact.

### Facture mensuelle par utilisateur actif (40 générations + 30 OCR)

| Poste                                                | Optimiste  | Médian     | Pessimiste |
| ---------------------------------------------------- | ---------- | ---------- | ---------- |
| 40 générations Sonnet                                | 1,33 $     | 2,05 $     | 3,36 $     |
| 30 OCR Mistral (1-2 pages/photo)                     | 0,12 $     | 0,18 $     | 0,24 $     |
| Post-traitement OCR éventuel (Haiku 4.5, 1 $/5 $ /M) | 0 $        | 0,15 $     | 0,30 $     |
| **Total / utilisateur actif / mois**                 | **~1,5 $** | **~2,4 $** | **~3,9 $** |

Soit **≈ 1,4 à 3,6 €/mois** par payant actif. Un **power user à 10× l'usage coûterait 15-39 $/mois** — LE risque à borner par quota, pas un cas théorique.

Leviers en réserve : prompt caching (~10 % de l'input ici), Haiku 4.5 pour les tâches simples (3× moins cher), Batch API -50 % (inadapté au flux interactif). Sonnet 5 : prix d'intro 2 $/10 $ jusqu'au 31/08/2026 mais tokenizer ~30 % plus gourmand — coût effectif quasi identique.

## 3. Proposition : 2 formules (+1 optionnelle plus tard)

### Formule A — **Free (BYOK)** : 0 €

- Tout engram : FSRS illimité, decks/cartes illimités, planning, analytics, import MD/PDF.
- IA (génération + OCR) **avec la clé API de l'utilisateur** (ou son abonnement lié, si le chantier Codex aboutit), stockée write-only côté serveur, jamais loggée.
- Coût plateforme ≈ 0. Tier d'acquisition — doit rester vraiment bon, à la Anki/Knowt.

### Formule B — **Plus** : **4,99 €/mois ou 39 €/an** (≈ 3,25 €/mois)

- Prix de lancement / EPITA : **2,99 €/mois ou 29 €/an** (email `@epita.fr`), à remonter vers le prix cible après ~100 payants.
- Clé plateforme incluse : **60 générations + 60 OCR/mois** (quota dur, reset mensuel — couvre 1,5× l'usage actif estimé, borne le pire cas à ~5 $ de coût API).
- Économie unitaire (mensuel 4,99 €) : − Stripe 0,32 € → net 4,67 € ; − coût API médian 2,2 € → **marge brute ~2,4 €/mois (~50 %)** ; en pessimiste ~23 %. L'annuel à 39 € est tendu (marge ~25 % médian, quasi nulle pessimiste) → **pour de la sécurité : annuel 44-49 €**.
- Rationale : pile sur l'ancre marché (Mochi/Knowt 5 $, Quizlet annuel ~3 $/mois) ; argument de vente simple : « pas besoin de clé API ».

### Formule C (plus tard, si demande avérée) — **Pro** : 9,99 €/mois ou 79 €/an

- Quotas ×4, génération prioritaire, éventuellement modèle supérieur. Ne pas lancer au jour 1. Alternative plus simple aux dépassements : **packs de recharge** (+50 générations = 2,50 €).

### Lifetime : uniquement en mode BYOK

Lifetime avec clé plateforme = bombe à retardement (coût récurrent vs revenu unique). En revanche **« Lifetime unlock » 49-59 € débloquant les features Plus mais IA restant BYOK** (modèle Mochi/AnkiMobile) : viable, coût marginal ~0, très attractif pour le public anti-abonnement. Option de lancement, pas produit principal.

**Recommandation : lancer avec Free (BYOK) + Plus uniquement.**

## 4. Risques et points d'attention

1. **Abus de la clé plateforme** (risque principal) : quotas durs par compte/mois, plafond de taille de note (ex. 10 000 mots), rate limiting par compte et IP, workspace Anthropic dédié avec budget/alertes, tracking du spend par user en DB (logger `input_tokens`/`output_tokens` sur chaque `generation` — à implémenter AVANT la clé plateforme).
2. **Coût fixe caché** : le **Hobby plan Vercel interdit l'usage commercial** → Vercel Pro (20 $/mois) dès la monétisation ; Supabase Pro (25 $/mois) vite nécessaire (le free tier pause après inactivité). Plancher ~45 $/mois → **~15-20 abonnés Plus pour le break-even**. Les 6 premiers mois seront probablement déficitaires.
3. **Churn saisonnier étudiant** : 30-50 % en juin-août. Parades : pousser l'annuel, **pause d'abonnement**, réactivation à la rentrée/avant partiels.
4. **TVA / fees** : micro-entrepreneur = franchise TVA jusqu'à 37 500 € de CA services (seuils 2026 inchangés — autoentrepreneur.urssaf.fr). Seuil OSS 10 000 € pour le B2C UE hors France. Stripe UE : 1,5 % + 0,25 € (le fixe pèse 6,5 % sur 4,99 € → encore un argument pour l'annuel). Alternative : Paddle/Lemon Squeezy en Merchant of Record (5 % + 0,50 $, TVA gérée) — plus cher, zéro paperasse internationale.
5. **Incertitudes assumées** : tokens/génération estimés (à mesurer sur les vraies notes — logger les tokens), prix concurrents de sources secondaires, conversion ~1 $ ≈ 0,92 €, et le taux d'« actifs » réel parmi les payants améliorera probablement la marge.

---

**Synthèse : Free BYOK complet + Plus à 4,99 €/mois / 39-44 €/an (lancement EPITA 2,99 €) avec quota 60 générations + 60 OCR, marge brute ~50 % au médian, lifetime réservé au BYOK, et comptes + tracking de tokens à livrer avant toute clé plateforme.**
