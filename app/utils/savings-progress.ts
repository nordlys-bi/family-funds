/**
 * Balken-Darstellung der Sparziel-Zeile (issue #100).
 *
 * Zugeklappt fuehrt die Zeile mit dem Fortschritt: `aktuell / Ziel` plus
 * Balken. Dieses Mapping entscheidet, wie der Balken aussieht:
 *  - Blau ("accent") = unterwegs, Gruen ("ok") = Ziel erreicht.
 *  - Der Balken ist bei 100 % gedeckelt. Mehr gespart als geplant ist bei
 *    Sparzielen kein Fehler und darf deshalb NICHT als roter Overflow
 *    erscheinen (das macht ListProgressBar ab > 100 %).
 *  - Der Balken kennt keinen negativen Wert (Entnahmen ueber dem Stand),
 *    das Label zeigt aber den echten Prozentwert.
 */

export type GoalProgressInput = {
  targetAmount: number
  currentAmount?: number | null
  progressPercent?: number | null
}

export type GoalProgressDisplay = {
  /** Ziel erreicht (aktueller Stand >= Zielbetrag > 0). */
  reached: boolean
  /** Fuellstand des Balkens, 0-100. */
  percent: number
  tone: 'ok' | 'accent'
  /** Text neben dem Balken: "Erreicht" oder der Prozentwert. */
  label: string
}

export function goalProgressDisplay(goal: GoalProgressInput): GoalProgressDisplay {
  const current = goal.currentAmount ?? 0
  const rawPercent = goal.progressPercent ?? 0
  const reached = goal.targetAmount > 0 && current >= goal.targetAmount

  return {
    reached,
    percent: Math.min(Math.max(rawPercent, 0), 100),
    tone: reached ? 'ok' : 'accent',
    label: reached ? 'Erreicht' : `${rawPercent}%`,
  }
}
