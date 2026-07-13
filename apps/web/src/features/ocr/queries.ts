import { useMutation } from '@tanstack/react-query'
import { extractImageResponseSchema, type ExtractImageResponse } from '@engram/shared'
import { api } from '@/lib/api'
import { downscaleImage } from './downscale'

/**
 * Extract Markdown from ONE photo (OCR spec §3.4). The mutation OWNS the
 * mandatory client downscale (§1.2): it decodes + shrinks the file in-browser,
 * then uploads the ~200–600 KB JPEG to `POST /api/notes/extract-image`. The
 * original filename is preserved so the server can label the note and (in e2e)
 * read the `__E2E_OCR_*` sentinels. Never writes a note — the caller previews
 * and corrects the text before creating one.
 */
export function useExtractImage() {
  return useMutation<ExtractImageResponse, unknown, File>({
    mutationFn: async (file) => {
      const { blob } = await downscaleImage(file)
      const form = new FormData()
      form.set('file', blob, file.name)
      return api.upload('/notes/extract-image', form, extractImageResponseSchema)
    },
  })
}
