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
    'a `.` separator instead of `)`',
    `${CAPITAL}\n\n- A. Cusco\n- B. Lima\n- C. Arequipa`,
    'B. Siège du gouvernement.',
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

  it('accepts a `:` after the answer letter', () => {
    const parsed = parseQcm(
      `${CAPITAL}\n\n- A) Cusco\n- B) Lima\n- C) Arequipa`,
      'B : siège du gouvernement.',
    )
    expect(parsed?.answerIndex).toBe(1)
    expect(parsed?.explanation).toBe('siège du gouvernement.')
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
