/*
 * useBookingDialog — Composable für den "Buchung erfassen"-Dialog eines
 * Sparziels (issue #38).
 *
 * Verwaltet:
 *   - open/close des FormDialog
 *   - welches Goal gebucht wird + Richtung (deposit vs. withdraw)
 *   - Form-State (Betrag, Datum, Notiz)
 *   - Submit + Validierung
 *
 * Der Caller verkabelt:
 *   - `householdId` (aus useHousehold)
 *   - `getGoal(id)`   — Lookup, der das Goal aus der aktuellen Liste
 *                       zurückgibt. Darf reaktive Refs lesen; das
 *                       `goal`-Computed trackt sie automatisch.
 *   - `formatDate`   — Date → YYYY-MM-DD-Formatter (z. B. `formatDateInput`)
 *   - `onSuccess`    — Callback nach erfolgreicher Buchung. Bekommt
 *                       Direction + Goal-Name, damit die Page ihren
 *                       Notice-Toast bauen und `loadPlanning()` triggern kann.
 *   - `onError?`     — optionaler Callback bei Validierungs-/API-Fehler
 *                       (z. B. für globale Tracking-Events).
 *
 * Was diese Composable NICHT macht:
 *   - Liste der Goals verwalten (gehört in useHousehold)
 *   - Erfolgs-Toast anzeigen (gehört in die Page, via onSuccess)
 *   - Globale API-Fehler behandeln außer dem lokalen `error`-Ref
 *
 * Bewusst KEIN useState() mit globalem Key — der Dialog-State ist
 * page-lokal, weil er nur während der Buchung relevant ist. Beim
 * Schließen wird der State verworfen (close() setzt alle Refs zurück).
 */
import { computed, ref, type Ref } from 'vue'
import {
  useSavingsExecutions,
  type BookExecutionResult,
  type ExecutionDirection,
} from './useSavingsExecutions'

/** Form-Shape, die der Dialog nach außen anbietet. */
export type BookingFormValue = {
  /** Betrag in EUR (positiv). Vorzeichen wird intern je nach direction gesetzt. */
  amount: number | null
  /** Datum als Date-Objekt; wird vor dem POST via `formatDate` zu YYYY-MM-DD. */
  date: Date | null
  /** Optionale Notiz, max 500 Zeichen (vom Server validiert). */
  note: string
}

/** Goal-Subset, das die Composable braucht. Page darf größeres Objekt reichen. */
export type BookableGoal = {
  id: string
  name: string
}

/** Payload für onSuccess — genug für Page, um Notice + Reload zu triggern. */
export type BookingSuccessContext = {
  result: BookExecutionResult
  direction: ExecutionDirection
  goalName: string
  goalId: string
}

export type UseBookingDialogOptions<G extends BookableGoal> = {
  householdId: Ref<string | null | undefined>
  getGoal: (goalId: string) => G | null | undefined
  formatDate: (date: Date) => string
  onSuccess: (context: BookingSuccessContext) => void
  onError?: (message: string) => void
}

export function useBookingDialog<G extends BookableGoal = BookableGoal>(
  options: UseBookingDialogOptions<G>,
) {
  const {
    bookExecution,
    error: apiError,
    clearError: clearApiError,
    posting,
  } = useSavingsExecutions()

  const dialogOpen = ref(false)
  const goalId = ref<string | null>(null)
  const direction = ref<ExecutionDirection>('deposit')
  const form = ref<BookingFormValue>({
    amount: null,
    date: null,
    note: '',
  })
  const localError = ref<string | null>(null)

  // Reagiert auf goalId-Änderung UND auf jede reaktive State-Änderung,
  // die `options.getGoal` liest. Vue's computed trackt das automatisch.
  const goal = computed<G | null>(() =>
    goalId.value ? options.getGoal(goalId.value) ?? null : null,
  )

  const isValid = computed(() => {
    const amount = form.value.amount
    return (
      Number.isFinite(amount)
      && amount !== null
      && amount !== 0
      && form.value.date !== null
    )
  })

  function open(newGoalId: string, newDirection: ExecutionDirection) {
    goalId.value = newGoalId
    direction.value = newDirection
    form.value = { amount: null, date: new Date(), note: '' }
    localError.value = null
    clearApiError()
    dialogOpen.value = true
  }

  function close() {
    dialogOpen.value = false
    goalId.value = null
    localError.value = null
  }

  async function submit(): Promise<void> {
    localError.value = null

    if (!goalId.value || !options.householdId.value) {
      localError.value = 'Sparziel oder Haushalt fehlt.'
      options.onError?.(localError.value)
      return
    }
    if (!isValid.value) {
      localError.value = 'Betrag muss ungleich 0 sein, Datum ist erforderlich.'
      options.onError?.(localError.value)
      return
    }
    const foundGoal = goal.value
    if (!foundGoal) {
      localError.value = 'Sparziel nicht gefunden.'
      options.onError?.(localError.value)
      return
    }

    const dateIso = options.formatDate(form.value.date!)
    const result = await bookExecution(
      options.householdId.value,
      goalId.value,
      direction.value,
      {
        amount: Math.abs(form.value.amount!),
        date: dateIso,
        note: form.value.note?.trim() || undefined,
      },
    )

    if (!result) {
      localError.value = apiError.value ?? 'Buchung fehlgeschlagen.'
      options.onError?.(localError.value)
      return
    }

    options.onSuccess({
      result,
      direction: direction.value,
      goalName: foundGoal.name,
      goalId: goalId.value,
    })
    close()
  }

  return {
    dialogOpen,
    goal,
    direction,
    form,
    posting,
    error: localError,
    isValid,
    open,
    close,
    submit,
  }
}
