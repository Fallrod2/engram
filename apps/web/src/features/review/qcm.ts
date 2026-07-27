/**
 * Recognise a multiple-choice card from its Markdown, at render time.
 *
 * A QCM card has NO structured representation in the database: it is a plain
 * card whose `front`/`back` happen to follow the shape asked for by the
 * generation prompt (`cards.v1.ts`, QUIZ_INSTRUCTIONS):
 *
 *   front: the question, then 3-4 options as a Markdown list ("- A) …")
 *   back:  the letter of the single correct answer, then a short justification
 *
 * Parsing at render time (rather than migrating) makes every card already in
 * the database retroactively interactive. The caller falls back to the plain
 * Markdown rendering whenever this returns `null`, so `null` is always a safe
 * answer: a false negative costs a nicer UI, a FALSE POSITIVE lies to the user
 * about what the right answer is. Every rule below is biased accordingly.
 */

export interface QcmOption {
  /** Uppercase letter as authored: 'A', 'B', … */
  letter: string
  /** The option text, Markdown, without its letter marker. */
  text: string
}

export interface ParsedQcm {
  /** Everything above the options block — Markdown, may be multi-line. */
  question: string
  options: QcmOption[]
  /** Index into `options` of the single correct answer. */
  answerIndex: number
  /** What the back says beyond the answer letter. May be empty. */
  explanation: string
}

/**
 * One option line. The Markdown list marker is OPTIONAL — the model does not
 * always emit it — and the separator is `)` or `.`.
 *
 * The letter class is `[A-Za-z]` and never `\d`: numbered options (`1.`, `2.`)
 * would collide with the 1-4 rating keys of the review session, so a numbered
 * list must NOT be recognised as a QCM. This is a product constraint, not a
 * parsing shortcut.
 */
const OPTION_LINE = /^[ \t]{0,3}(?:[-*+][ \t]+)?([A-Za-z])[).][ \t]+(.+)$/

/**
 * Punctuated answer marker, at the head of the back's first non-blank line: an
 * optional opening paren, the letter, then `)`, `.` or `:` IMMEDIATELY after it
 * — this is what the generation prompt emits (`B)`, `B.`, `B :`). The colon may
 * be preceded by a single space, as French typography requires.
 *
 * Whitespace is deliberately NOT a separator of its own: a back such as
 * "A priori, on croirait Cusco, mais la capitale est Lima." would otherwise be
 * read as "the answer is A", and the UI would assert a wrong answer. That is
 * the false positive this module exists to avoid.
 */
const BACK_PUNCTUATED_ANSWER = /^\(?([A-Za-z])(?:\)|\.|[ \t]?:)/

/**
 * Bare answer letter, matched against the back's first non-blank line once
 * trimmed: the whole line must be the letter, optionally parenthesised (`B`,
 * `(B)`). Anything else on the line makes it prose, not a marker.
 */
const BACK_BARE_ANSWER = /^(?:([A-Za-z])|\(([A-Za-z])\))$/

/** Any code fence anywhere in the front disqualifies the card (see `parseQcm`). */
const CODE_FENCE = /```|~~~/

/** Minimum number of options for the card to be a question and not a list. */
const MIN_OPTIONS = 2

/**
 * Maximum number of options. A product constraint, not a parsing one: the
 * review session maps the keys A to D onto the options, and the next letters
 * are already taken by its own shortcuts — `E` edits the card, `S` skips it,
 * `U` undoes the last review (see `lib/keymap.ts`). A 5-option QCM would make
 * its option `E` collide with card editing. The generation prompt asks for 3 to
 * 4 options anyway; beyond that, falling back to the Markdown rendering is the
 * safe behaviour.
 */
const MAX_OPTIONS = 4

const LETTER_A = 'A'.charCodeAt(0)

interface BackAnswer {
  /** The answer letter as authored, not yet uppercased. */
  letter: string
  /** Everything the back says beyond the marker, trimmed. */
  explanation: string
}

/**
 * Read the answer marker off the back, or return `null` when the back does not
 * open with one of the two recognised forms.
 */
function parseBackAnswer(back: string): BackAnswer | null {
  const lines = back.split('\n')
  const firstIndex = lines.findIndex((line) => line.trim() !== '')
  if (firstIndex === -1) return null

  const firstLine = (lines[firstIndex] ?? '').trim()
  const rest = lines.slice(firstIndex + 1)

  const bare = BACK_BARE_ANSWER.exec(firstLine)
  if (bare !== null) {
    return { letter: bare[1] ?? bare[2] ?? '', explanation: rest.join('\n').trim() }
  }

  const punctuated = BACK_PUNCTUATED_ANSWER.exec(firstLine)
  if (punctuated === null) return null
  return {
    letter: punctuated[1] ?? '',
    explanation: [firstLine.slice(punctuated[0].length), ...rest].join('\n').trim(),
  }
}

/**
 * Parse a QCM out of a card's `front`/`back`, or return `null` when the card is
 * not recognisably a QCM.
 *
 * Front — the options block must be the LAST block of the front:
 *  - between 2 and 4 option lines (see `MAX_OPTIONS`);
 *  - their letters, uppercased, must be distinct, consecutive AND start at A
 *    (A, B, C…). `A, B, D` or `B, C` return `null`; this is what keeps an
 *    ordinary bullet list from being mistaken for a question;
 *  - letters only, never digits (see `OPTION_LINE`);
 *  - the question is everything above the first option line, trimmed; an empty
 *    question returns `null` (a card that is only a list is not a question);
 *  - no non-blank line may follow the options block;
 *  - blank lines *inside* the block are ignored;
 *  - a front containing a code fence returns `null` outright, rather than
 *    risking parsing options out of a code block.
 *
 * Back — the first non-blank line must carry the answer letter, in one of two
 * forms and no other (see `BACK_PUNCTUATED_ANSWER`, `BACK_BARE_ANSWER`):
 *  - the letter punctuated by `)`, `.` or `:`, optionally parenthesised;
 *  - the letter alone on that line, optionally parenthesised;
 *  - that letter must be one of the options, otherwise `null`;
 *  - `explanation` is whatever follows the marker, trimmed, kept as authored —
 *    including when the model repeats the option text.
 */
export function parseQcm(front: string, back: string): ParsedQcm | null {
  if (CODE_FENCE.test(front)) return null

  const lines = front.replace(/\r\n?/g, '\n').split('\n')

  // Walk up from the bottom for as long as every non-blank line is an option.
  // A non-blank line that is not an option ends the walk, so trailing prose
  // leaves `start` at -1 and disqualifies the card.
  let start = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? ''
    if (line.trim() === '') continue
    if (!OPTION_LINE.test(line)) break
    start = i
  }
  if (start === -1) return null

  const options: QcmOption[] = []
  for (const line of lines.slice(start)) {
    const match = OPTION_LINE.exec(line)
    if (match === null) continue // blank line inside the block
    const [, letter = '', text = ''] = match
    options.push({ letter: letter.toUpperCase(), text: text.trim() })
  }

  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) return null
  const consecutiveFromA = options.every(
    (option, index) => option.letter.charCodeAt(0) === LETTER_A + index,
  )
  if (!consecutiveFromA) return null

  const question = lines.slice(0, start).join('\n').trim()
  if (question === '') return null

  const answer = parseBackAnswer(back.replace(/\r\n?/g, '\n'))
  if (answer === null) return null
  const answerLetter = answer.letter.toUpperCase()
  const answerIndex = options.findIndex((option) => option.letter === answerLetter)
  if (answerIndex === -1) return null

  return { question, options, answerIndex, explanation: answer.explanation }
}
