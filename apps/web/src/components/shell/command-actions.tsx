import { localDayKey } from '@/lib/calendar'
import { useCreateSubject } from '@/features/subjects/queries'
import { useCreateDeck } from '@/features/decks/queries'
import { useCreateExam } from '@/features/planning/queries'
import { SubjectFormDialog } from '@/features/subjects/subject-form-dialog'
import { DeckFormDialog } from '@/features/decks/deck-form-dialog'
import { ExamFormDialog } from '@/features/planning/exam-form-dialog'
import { useShell } from './shell-context'

/**
 * Global create host (spec §4.3). Mounts the existing create dialogs at the
 * shell level so the palette's "Nouvelle matière / deck / examen" can open them
 * from any route. The dialogs reuse the existing mutations (optimistic + toasts
 * + cache invalidation) — nothing about the data layer is re-implemented. This
 * is a distinct instance from the in-route dialogs; two are never open at once.
 */
export function CreateHost() {
  const { createRequest, closeCreate } = useShell()

  // `useCreateDeck` only needs the subjectId to build its cache key; an empty
  // string is harmless when no deck request is pending.
  const deckSubjectId = createRequest?.kind === 'deck' ? (createRequest.subjectId ?? '') : ''

  const createSubject = useCreateSubject()
  const createDeck = useCreateDeck(deckSubjectId)
  const createExam = useCreateExam()

  return (
    <>
      <SubjectFormDialog
        open={createRequest?.kind === 'subject'}
        onOpenChange={(o) => !o && closeCreate()}
        onSubmit={(values) => {
          createSubject.mutate(values)
          closeCreate()
        }}
      />
      <DeckFormDialog
        open={createRequest?.kind === 'deck'}
        onOpenChange={(o) => !o && closeCreate()}
        onSubmit={(values) => {
          if (deckSubjectId) createDeck.mutate({ subjectId: deckSubjectId, ...values })
          closeCreate()
        }}
      />
      <ExamFormDialog
        open={createRequest?.kind === 'exam'}
        onOpenChange={(o) => !o && closeCreate()}
        defaultDateKey={localDayKey(new Date())}
        onCreate={(input) => {
          createExam.mutate(input)
          closeCreate()
        }}
        onUpdate={() => {}}
      />
    </>
  )
}
