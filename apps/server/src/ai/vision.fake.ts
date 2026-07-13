import type { VisionExtractArgs, VisionExtractor, VisionExtractResult } from './vision'

/**
 * Test-only deterministic vision extractor (OCR spec §2.2). Wired into the
 * server ONLY when `ENGRAM_FAKE_AI=1` (see `index.ts`), so no real vision API is
 * ever called during the e2e suite.
 *
 * Belt-and-suspenders safety: this module imports NOTHING from any provider SDK
 * and has no network access. Sentinels are carried through the FILENAME
 * (`args.filename`): `__E2E_OCR_FAIL__` → throw, `__E2E_OCR_EMPTY__` → empty.
 */

/** Short latency so the UI's `pending` per-page state is observable in e2e. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const fakeVisionExtractor: VisionExtractor = {
  supportsVision() {
    return true
  },

  async extract(args: VisionExtractArgs): Promise<VisionExtractResult> {
    await sleep(40)
    const name = args.filename ?? ''
    if (name.includes('__E2E_OCR_FAIL__')) {
      throw new Error('fake vision failure (__E2E_OCR_FAIL__)')
    }
    if (name.includes('__E2E_OCR_EMPTY__')) {
      return { markdown: '', promptTokens: 1, completionTokens: 1 }
    }
    // Deterministic Markdown; the `[?]` marker exercises the warnings path.
    const label = name ? `\`${name}\`` : "l'image"
    const markdown = `# Page transcrite\n\nTranscription factice de ${label}.\n\n- premier point\n- second point [?]`
    return { markdown, promptTokens: 12, completionTokens: 8 }
  },
}
