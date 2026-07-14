/**
 * Prompt version cards.v2 — adds the "Mixte auto" (`mixed`) generation mode: the
 * model EVALUATES each knowledge unit and CHOOSES the format (Q/R or cloze).
 *
 * The v1 module (cards.v1.ts) stays the source of truth for `cards`/`quiz`; this
 * file only carries what `mixed` adds. The wire schema is a NEW, strict-compatible
 * schema (every branch has all-required properties + additionalProperties:false)
 * so it survives OpenAI `strict` json_schema, Ollama `format`, and forced tools.
 * All tolerance (kind absent → qa, contentType optional) lives in Zod (parse.ts).
 */

/** Bump on every change; a new file cards.vN.ts per version. */
export const PROMPT_VERSION = 'cards.v2'

/**
 * Kind-specific instruction for 'mixed'. The heart of the feature: the model must
 * FIRST classify every knowledge unit, THEN pick the format from a strict
 * pedagogical rule. Written in French (the primary UI language); the model still
 * outputs in the note's language per the shared SYSTEM_PROMPT.
 */
export const MIXED_INSTRUCTIONS = `Format MIXTE (auto) : pour CHAQUE unité de savoir de l'extrait, tu procèdes en DEUX temps.

ÉTAPE 1 — CLASSIFIER l'unité (champ "contentType") parmi :
- "definition" : un terme associé à son sens exact (ex. « Un monoïde est un ensemble muni d'une loi associative avec élément neutre »).
- "formula" : une égalité, une relation, une expression symbolique à retenir telle quelle (ex. « E = mc² », « complexité du tri fusion = O(n log n) »).
- "fact" : une donnée atomique précise — date, nom, valeur, seuil, propriété (ex. « HTTP 404 = ressource introuvable »).
- "list" : une énumération courte et fermée dont chaque élément compte (ex. « les 3 formes normales : 1NF, 2NF, 3NF »).
- "concept" : une explication, un mécanisme, un « pourquoi/comment », une comparaison — tout ce qui demande de reformuler avec ses mots.

ÉTAPE 2 — CHOISIR le format selon la nature du contenu (règle CONTENU → FORMAT, non négociable) :
- definition, formula, fact, list  →  CLOZE (texte à trous, "kind":"cloze").
- concept                          →  Q/R classique ("kind":"qa"), en respectant l'atomicité (une question autoportante, une réponse concise).

RÈGLES DES CLOZE (texte à trous) :
- Syntaxe Anki : le trou s'écrit {{c1::réponse}}. Numérote c1, c2, c3… ; deux trous portant le MÊME numéro sont révélés ensemble (même carte).
- 1 à 3 trous MAXIMUM par texte. Chaque numéro distinct devient une carte indépendante.
- Le trou porte sur le TERME / la VALEUR / le SYMBOLE discriminant — l'élément précis qu'il faut savoir restituer. JAMAIS sur un mot de liaison, un article, un mot grammatical ou un mot évident.
- Le contexte laissé en clair doit RENDRE LA RÉPONSE RÉCUPÉRABLE de mémoire, sans jamais la donner littéralement.
- N'utilise les trous que sur du texte issu de l'extrait ; n'invente rien.

EXEMPLES POSITIFS (cloze pertinente) :
- definition : {"kind":"cloze","contentType":"definition","clozeText":"Un {{c1::monoïde}} est un ensemble muni d'une loi {{c2::associative}} possédant un élément {{c3::neutre}}."}
- formula : {"kind":"cloze","contentType":"formula","clozeText":"La complexité du tri fusion est {{c1::O(n log n)}} dans tous les cas."}
- fact : {"kind":"cloze","contentType":"fact","clozeText":"Le code HTTP {{c1::404}} signifie que la ressource est introuvable."}

EXEMPLES NÉGATIFS (à NE PAS faire) :
- Trou sur un mot de liaison : « Un monoïde {{c1::est}} un ensemble… » → INTERDIT (mot grammatical, aucune valeur pédagogique).
- Réponse donnée par le contexte : « Le tri fusion, aussi appelé {{c1::tri fusion}}… » → INTERDIT (le contexte contient déjà la réponse).
- Plus de 3 trous, ou trous sur presque tous les mots → INTERDIT (illisible, non atomique).
- Cloze sur un concept : « {{c1::La mémoïsation}} accélère la récursion en évitant les recalculs. » → INTERDIT ; un concept se teste en Q/R (« Comment la mémoïsation accélère-t-elle la récursion ? » / « En mémorisant les résultats déjà calculés. »).

Si un passage ne se prête bien NI au cloze NI à une Q/R de qualité, n'en fais pas de carte (règle de fidélité). Émets TOUT via l'outil "emit_cards", chaque carte avec son "kind" et son "contentType".`

/** Description shared by the tool wrapper and the OpenAI `function` wrapper. */
export const EMIT_MIXED_CARDS_DESCRIPTION =
  "Émet les flashcards générées en mode mixte. Chaque carte porte son 'kind' ('qa' pour recto/verso, 'cloze' pour un texte à trous) et son 'contentType' (classification pédagogique)."

const CONTENT_TYPE_ENUM = ['definition', 'formula', 'list', 'fact', 'concept'] as const

/**
 * The NAKED v2 JSON Schema. `items` is an `anyOf` of TWO fully-specified branches
 * (qa / cloze); every branch lists ALL its properties in `required` and sets
 * `additionalProperties:false`, which is exactly what OpenAI `strict` mode
 * demands. Re-validated (leniently) by parse.ts afterwards.
 */
export const EMIT_MIXED_CARDS_JSON_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    cards: {
      type: 'array',
      description: 'Les flashcards générées en mode mixte (max 24), atomiques et sans doublon.',
      items: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['qa'], description: 'Carte recto/verso classique.' },
              contentType: {
                type: 'string',
                enum: CONTENT_TYPE_ENUM,
                description: 'Classification pédagogique (concept → qa).',
              },
              front: { type: 'string', description: 'Recto : question précise, Markdown.' },
              back: { type: 'string', description: 'Verso : réponse concise, Markdown.' },
            },
            required: ['kind', 'contentType', 'front', 'back'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: {
                type: 'string',
                enum: ['cloze'],
                description: 'Texte à trous (definition/formula/fact/list).',
              },
              contentType: {
                type: 'string',
                enum: CONTENT_TYPE_ENUM,
                description: 'Classification pédagogique.',
              },
              clozeText: {
                type: 'string',
                description: 'Texte Markdown avec 1 à 3 trous {{cN::réponse}}.',
              },
            },
            required: ['kind', 'contentType', 'clozeText'],
          },
        ],
      },
    },
  },
  required: ['cards'],
}

/** Anthropic structured-output tool definition for the mixed mode (forced). */
export const EMIT_MIXED_CARDS_TOOL = {
  name: 'emit_cards',
  description: EMIT_MIXED_CARDS_DESCRIPTION,
  input_schema: EMIT_MIXED_CARDS_JSON_SCHEMA,
}
