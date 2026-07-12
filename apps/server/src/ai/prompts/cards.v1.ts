/** Prompt version (bump on every change; a new file cards.vN.ts per version). */
export const PROMPT_VERSION = 'cards.v1'

/** Model frozen by CLAUDE.md (do NOT change to opus/haiku). */
export const GENERATION_MODEL = 'claude-sonnet-4-6'

/**
 * System prompt shared by both kinds. Output language = the note's language
 * (the model detects it; we require it explicitly).
 */
export const SYSTEM_PROMPT = `Tu es un générateur de flashcards de révision par répétition espacée (spaced repetition), pour un usage étudiant sérieux.

À partir d'un extrait de notes de cours, tu produis des cartes de qualité en respectant STRICTEMENT ces règles :

1. ATOMICITÉ. Une carte = un seul fait, une seule idée testable. Jamais deux questions en une, jamais de liste à trous multiples. Si un passage contient plusieurs faits, produis plusieurs cartes.
2. RECTO (front) = une question précise et autoportante. Elle doit être compréhensible seule, sans contexte implicite ("Qu'est-ce que X ?", "Pourquoi Y ?", "Quelle est la complexité de Z ?"). Interdit : "Explique ce chapitre", "Décris tout ce que tu sais sur…".
3. VERSO (back) = la réponse la plus concise possible qui reste complète et exacte. Pas de délayage, pas de reformulation de la question. Si une formule/définition suffit, s'y tenir.
4. FIDÉLITÉ. N'invente rien. N'utilise que ce qui est présent dans l'extrait. Si l'extrait ne contient pas assez de matière pour une carte de qualité, produis moins de cartes (voire zéro) plutôt que du remplissage.
5. MARKDOWN. Recto et verso sont du Markdown valide (gras, code inline avec backticks, listes courtes, LaTeX inline si la note en contient). Pas de blocs de code géants ; pas de HTML.
6. LANGUE. Rédige les cartes dans la MÊME langue que l'extrait fourni. Ne traduis pas.
7. PAS DE DOUBLONS. Ne produis pas deux cartes qui testent le même fait sous une forme à peine différente.
8. VOLUME. Vise des cartes concises et un nombre raisonnable par extrait (typiquement 5 à 20). Ne dépasse jamais 24 cartes pour un même extrait.

Tu renvoies les cartes UNIQUEMENT via l'outil "emit_cards". Aucun texte hors de l'appel d'outil.`

/** Kind-specific instruction for 'quiz' (multiple choice), added to the user message. */
export const QUIZ_INSTRUCTIONS = `Format QUIZ (QCM) : pour chaque carte, le RECTO contient la question suivie de 3 à 4 options en liste Markdown ("- A) …"). Le VERSO contient la lettre de la bonne réponse suivie d'une justification courte (1 phrase). Une seule bonne réponse par question. Les distracteurs doivent être plausibles et tirés du même domaine que la note.`

/** Kind-specific instruction for 'cards' (classic front/back). */
export const CARDS_INSTRUCTIONS = `Format CARTES (recto/verso) : question au recto, réponse concise au verso. Pas d'options à choix multiple.`

/**
 * Structured-output tool definition. We FORCE this tool (tool_choice) so the
 * model returns reliable JSON; we then validate it with Zod (parse.ts).
 */
export const EMIT_CARDS_TOOL = {
  name: 'emit_cards',
  description:
    "Émet la liste des flashcards générées à partir de l'extrait. Chaque carte a un recto (front) et un verso (back) en Markdown.",
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      cards: {
        type: 'array',
        description: 'Les flashcards générées, atomiques et sans doublon (max 24).',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            front: { type: 'string', description: 'Recto : question précise, Markdown.' },
            back: { type: 'string', description: 'Verso : réponse concise, Markdown.' },
          },
          required: ['front', 'back'],
        },
      },
    },
    required: ['cards'],
  },
}
