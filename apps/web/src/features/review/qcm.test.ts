import { describe, expect, it } from 'vitest'
import { parseQcm, type ParsedQcm, type QcmOption } from './qcm'

/** Options lettered A, B, C… from their texts — the only shape we accept. */
function options(...texts: readonly string[]): QcmOption[] {
  return texts.map((text, index) => ({ letter: String.fromCharCode(65 + index), text }))
}

type ParseCase = readonly [label: string, front: string, back: string, expected: ParsedQcm]
type RejectCase = readonly [label: string, front: string, back: string]

const CAPITAL = 'Quelle est la capitale du Pérou ?'

const PARSED: readonly ParseCase[] = [
  [
    'the nominal shape asked for by the generation prompt',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
    'B) Lima — siège du gouvernement depuis 1535.',
    {
      question: CAPITAL,
      options: options('Cusco', 'Lima', 'Arequipa'),
      answerIndex: 1,
      explanation: 'Lima — siège du gouvernement depuis 1535.',
    },
  ],
  [
    'four options',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa\n- D) Trujillo`,
    'D) Trujillo est la capitale historique du nord.',
    {
      question: CAPITAL,
      options: options('Cusco', 'Lima', 'Arequipa', 'Trujillo'),
      answerIndex: 3,
      explanation: 'Trujillo est la capitale historique du nord.',
    },
  ],
  [
    'options without a Markdown list marker',
    `${CAPITAL}\n\nA) Cusco\nB) Lima\nC) Arequipa`,
    'B) Siège du gouvernement.',
    {
      question: CAPITAL,
      options: options('Cusco', 'Lima', 'Arequipa'),
      answerIndex: 1,
      explanation: 'Siège du gouvernement.',
    },
  ],
  [
    // The `.` separator stays legitimate on the FRONT, where the options block
    // is structurally constrained — it is only banned on the back.
    'a `.` separator instead of `)` on the option lines',
    `${CAPITAL}\n\n- A. Cusco\n- B. Lima\n- C. Arequipa`,
    'B) Siège du gouvernement.',
    {
      question: CAPITAL,
      options: options('Cusco', 'Lima', 'Arequipa'),
      answerIndex: 1,
      explanation: 'Siège du gouvernement.',
    },
  ],
  [
    'lowercase letters in the source, uppercased in the result',
    `${CAPITAL}\n\n- a) Cusco\n- b) Lima\n- c) Arequipa`,
    'b) Siège du gouvernement.',
    {
      question: CAPITAL,
      options: options('Cusco', 'Lima', 'Arequipa'),
      answerIndex: 1,
      explanation: 'Siège du gouvernement.',
    },
  ],
  [
    'a multi-line question above the options',
    'Soit $L = \\{a^n b^n\\}$.\n\nÀ quelle classe appartient $L$ ?\n\n- A) Rationnel\n- B) Algébrique\n- C) Contextuel',
    'B) Il est reconnu par un automate à pile.',
    {
      question: 'Soit $L = \\{a^n b^n\\}$.\n\nÀ quelle classe appartient $L$ ?',
      options: options('Rationnel', 'Algébrique', 'Contextuel'),
      answerIndex: 1,
      explanation: 'Il est reconnu par un automate à pile.',
    },
  ],
  [
    'a back reduced to the letter and its separator',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
    'B)',
    {
      question: CAPITAL,
      options: options('Cusco', 'Lima', 'Arequipa'),
      answerIndex: 1,
      explanation: '',
    },
  ],
  [
    'a back reduced to the bare letter',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
    'C',
    {
      question: CAPITAL,
      options: options('Cusco', 'Lima', 'Arequipa'),
      answerIndex: 2,
      explanation: '',
    },
  ],
  [
    'a blank line between two options',
    `${CAPITAL}\n\n- A) Cusco\n\n- B) Lima\n\n- C) Arequipa`,
    'B) Siège du gouvernement.',
    {
      question: CAPITAL,
      options: options('Cusco', 'Lima', 'Arequipa'),
      answerIndex: 1,
      explanation: 'Siège du gouvernement.',
    },
  ],
  [
    'trailing blank lines after the options block',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa\n\n  \n`,
    '  \n\n  A) Cusco fut la capitale inca.\n',
    {
      question: CAPITAL,
      options: options('Cusco', 'Lima', 'Arequipa'),
      answerIndex: 0,
      explanation: 'Cusco fut la capitale inca.',
    },
  ],
  [
    'a parenthesised answer letter on the back',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
    '(B) Siège du gouvernement.',
    {
      question: CAPITAL,
      options: options('Cusco', 'Lima', 'Arequipa'),
      answerIndex: 1,
      explanation: 'Siège du gouvernement.',
    },
  ],
  [
    'a bare answer letter on its own line, justified underneath',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
    'B\n\nSiège du gouvernement depuis 1535.',
    {
      question: CAPITAL,
      options: options('Cusco', 'Lima', 'Arequipa'),
      answerIndex: 1,
      explanation: 'Siège du gouvernement depuis 1535.',
    },
  ],
  [
    'a parenthesised answer letter on its own line, justified underneath',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
    '(B)\nSiège du gouvernement.',
    {
      question: CAPITAL,
      options: options('Cusco', 'Lima', 'Arequipa'),
      answerIndex: 1,
      explanation: 'Siège du gouvernement.',
    },
  ],
]

const REJECTED: readonly RejectCase[] = [
  ['an ordinary front/back card', CAPITAL, 'Lima.'],
  ['a plain bullet list, no letters', `${CAPITAL}\n\n- Cusco\n- Lima\n- Arequipa`, 'Lima.'],
  [
    'a numbered list — digits would collide with the 1-4 rating keys',
    `${CAPITAL}\n\n1. Cusco\n2. Lima\n3. Arequipa`,
    '2. Lima.',
  ],
  ['a single option', `${CAPITAL}\n\n- A) Lima`, 'A) Lima.'],
  [
    'non-consecutive letters (A, B, D)',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- D) Arequipa`,
    'B) Lima.',
  ],
  [
    'letters not starting at A (B, C, D)',
    `${CAPITAL}\n\n- B) Cusco\n- C) Lima\n- D) Arequipa`,
    'C) Lima.',
  ],
  [
    'duplicated letters (A, B, B)',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- B) Arequipa`,
    'B) Lima.',
  ],
  [
    'a non-blank line after the options block',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa\n\nRéfléchis avant de retourner la carte.`,
    'B) Lima.',
  ],
  ['an empty question — the front is only the list', '- A) Cusco\n- B) Lima\n- C) Arequipa', 'B)'],
  [
    'an answer letter absent from the options',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
    'D) Aucune de ces réponses.',
  ],
  [
    'a back that does not start with a letter marker',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
    'La bonne réponse est la deuxième.',
  ],
  [
    'a front containing a code fence',
    'Que vaut `x` ?\n\n```ts\nconst x = 1\n```\n\n- A) 0\n- B) 1\n- C) 2',
    'B) La constante vaut 1.',
  ],
  [
    'a front containing a `~~~` fence',
    'Que vaut x ?\n\n~~~\nx = 1\n~~~\n\n- A) 0\n- B) 1\n- C) 2',
    'B) La constante vaut 1.',
  ],
  ['an empty front', '', 'B) Lima.'],
  ['a whitespace-only front', '   \n\t\n  ', 'B) Lima.'],
  ['an empty back', `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`, ''],
  ['a whitespace-only back', `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`, '  \n\t '],
  [
    // The false positive this module exists to avoid: a space is not a
    // separator, so this back must NOT be read as "the answer is A".
    'a back opening on a lone letter followed by prose ("A priori, …")',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
    'A priori, on croirait Cusco, mais la capitale est Lima.',
  ],
  [
    'a back whose first word merely starts with an option letter',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
    'Oui, c’est Lima.',
  ],
  [
    // `.` is not an answer separator on the back: the French "c'est-à-dire"
    // abbreviation would otherwise assert answer C on a card whose answer is A.
    'a back opening on the abbreviation "c.-à-d."',
    'Que signifie HTTP ?\n\n- A) HyperText Transfer Protocol\n- B) High Transfer Text Protocol\n- C) HyperText Transport Program',
    'c.-à-d. HyperText Transfer Protocol, le protocole de transfert du web.',
  ],
  [
    // Author initials, just as common in a justification.
    'a back opening on an author initial ("A. Aho …")',
    'Quelles classes ?\n\n- A) Rationnel\n- B) Algébrique\n- C) Contextuel',
    'A. Aho et J. Ullman distinguent ces trois catégories.',
  ],
  [
    'another author initial ("N. Wirth …")',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
    'N. Wirth a conçu Pascal.',
  ],
  [
    // The assumed cost of banning `.`: a legitimate back written this way now
    // falls back to the plain Markdown rendering rather than risk lying.
    'a back using a `.` after the answer letter',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
    'B. Lima — siège du gouvernement depuis 1535.',
  ],
  [
    'five options — E would collide with the session edit shortcut',
    `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa\n- D) Trujillo\n- E) Iquitos`,
    'B) Siège du gouvernement.',
  ],
  [
    'an option line with no text after its letter',
    `${CAPITAL}\n\n- A)\n- B) Lima\n- C) Arequipa`,
    'B) Siège du gouvernement.',
  ],
]

describe('parseQcm — recognised', () => {
  it.each(PARSED)('parses %s', (_label, front, back, expected) => {
    expect(parseQcm(front, back)).toEqual(expected)
  })
})

describe('parseQcm — rejected (the caller falls back to plain Markdown)', () => {
  it.each(REJECTED)('rejects %s', (_label, front, back) => {
    expect(parseQcm(front, back)).toBeNull()
  })
})

describe('parseQcm — details', () => {
  it('keeps the option text as Markdown, marker stripped', () => {
    const parsed = parseQcm(
      'Quel opérateur ?\n\n- A) `map`\n- B) **fold**\n- C) $\\circ$',
      'B) Il replie la structure.',
    )
    expect(parsed?.options).toEqual(options('`map`', '**fold**', '$\\circ$'))
  })

  it('keeps an explanation that repeats the option text', () => {
    const parsed = parseQcm(
      `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
      'B) Lima — siège du gouvernement depuis 1535.',
    )
    expect(parsed?.explanation).toBe('Lima — siège du gouvernement depuis 1535.')
  })

  it('accepts a `:` after the answer letter, with or without the French space', () => {
    const spaced = parseQcm(
      `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
      'B : siège du gouvernement.',
    )
    expect(spaced?.answerIndex).toBe(1)
    expect(spaced?.explanation).toBe('siège du gouvernement.')

    const tight = parseQcm(
      `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
      'B: Lima, siège du gouvernement.',
    )
    expect(tight?.answerIndex).toBe(1)
    expect(tight?.explanation).toBe('Lima, siège du gouvernement.')
  })

  it('tolerates CRLF line endings', () => {
    const parsed = parseQcm(
      `${CAPITAL}\r\n\r\n- A) Cusco\r\n- B) Lima\r\n- C) Arequipa`,
      'B) Siège du gouvernement.',
    )
    expect(parsed).toEqual({
      question: CAPITAL,
      options: options('Cusco', 'Lima', 'Arequipa'),
      answerIndex: 1,
      explanation: 'Siège du gouvernement.',
    })
  })
})
