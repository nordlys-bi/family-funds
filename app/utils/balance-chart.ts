/**
 * Geometrie fuer den Budget-Saldo-Verlauf (ADR-0004): Skalierung und
 * SVG-Pfade fuer `BudgetBalanceChart.vue` und `BudgetBalanceSparkline.vue`.
 *
 * Reine Funktionen, damit die Rechnerei ohne DOM testbar ist — die
 * Komponenten zeichnen nur noch. Bewusst keine Chart-Library: zwei kleine
 * Stufenlinien rechtfertigen keine zusaetzliche Abhaengigkeit (gleiche
 * Linie wie BudgetPeriodRing.vue).
 */

export type BalancePoint = { date: string; balance: number }
export type ChartPadding = { top: number; right: number; bottom: number; left: number }
export type ChartCoord = { x: number; y: number }

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Tag (YYYY-MM-DD) als fortlaufende Tageszahl. UTC statt lokaler Zeit,
 * damit die Zeitumstellung keine 23-/25-Stunden-Tage in die x-Achse bringt.
 */
export function dayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return Math.round(Date.UTC(year!, (month ?? 1) - 1, day ?? 1) / DAY_MS)
}

/**
 * Wertebereich der y-Achse: enthaelt immer die Nulllinie (sonst waere
 * "ueber/unter null" nicht ablesbar) und etwas Luft, damit die Linie nicht
 * am Rand klebt. Eine flache Linie bekommt einen kuenstlichen Bereich.
 */
export function balanceDomain(values: number[], headroom = 0.1): { min: number; max: number } {
  let min = Math.min(0, ...values)
  let max = Math.max(0, ...values)
  if (min === max) {
    max = min + 100
  }
  const pad = (max - min) * headroom
  if (min < 0) min -= pad
  if (max > 0) max += pad
  return { min, max }
}

export type BalanceChartGeometry = {
  width: number
  height: number
  plot: { left: number; right: number; top: number; bottom: number }
  domain: { min: number; max: number }
  xOfDate: (date: string) => number
  yOfValue: (value: number) => number
  zeroY: number
  coords: ChartCoord[]
  linePath: string
  areaPath: string
}

/**
 * Skalierung und Pfade fuer die Stufenlinie. x linear ueber die Tage
 * zwischen erstem und letztem Punkt (bzw. `range`), y ueber `balanceDomain`.
 */
export function buildBalanceChartGeometry(options: {
  points: BalancePoint[]
  width: number
  height: number
  padding: ChartPadding
  range?: { from: string; to: string }
}): BalanceChartGeometry {
  const { points, width, height, padding } = options
  const plot = {
    left: padding.left,
    right: Math.max(padding.left + 1, width - padding.right),
    top: padding.top,
    bottom: Math.max(padding.top + 1, height - padding.bottom),
  }
  const firstDay = dayNumber(options.range?.from ?? points[0]?.date ?? '1970-01-01')
  const lastDay = dayNumber(options.range?.to ?? points.at(-1)?.date ?? '1970-01-01')
  const span = Math.max(1, lastDay - firstDay)
  const domain = balanceDomain(points.map((point) => point.balance))

  const xOfDate = (date: string) => plot.left + ((dayNumber(date) - firstDay) / span) * (plot.right - plot.left)
  const yOfValue = (value: number) =>
    plot.bottom - ((value - domain.min) / (domain.max - domain.min)) * (plot.bottom - plot.top)

  const coords = points.map((point) => ({ x: xOfDate(point.date), y: yOfValue(point.balance) }))
  const zeroY = yOfValue(0)

  return {
    width,
    height,
    plot,
    domain,
    xOfDate,
    yOfValue,
    zeroY,
    coords,
    linePath: buildStepPath(coords),
    areaPath: buildStepAreaPath(coords, zeroY),
  }
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * Stufenlinie "step-after": Der Saldo bleibt bis zum naechsten Ereignis
 * stehen und springt dann — so wie ein Kontostand, nicht wie eine
 * interpolierte Kurve.
 */
export function buildStepPath(coords: ChartCoord[]): string {
  if (coords.length === 0) return ''
  const [first, ...rest] = coords
  let path = `M${round(first!.x)} ${round(first!.y)}`
  let previous = first!
  for (const coord of rest) {
    if (coord.x !== previous.x) path += ` H${round(coord.x)}`
    if (coord.y !== previous.y) path += ` V${round(coord.y)}`
    previous = coord
  }
  return path
}

/**
 * Flaeche zwischen Stufenlinie und Nulllinie. Ueber Clip-Pfade ober- und
 * unterhalb der Nulllinie getrennt eingefaerbt, damit negative Abschnitte
 * auffallen, ohne die Linie an jeder Nullstelle zerschneiden zu muessen.
 */
export function buildStepAreaPath(coords: ChartCoord[], baselineY: number): string {
  if (coords.length === 0) return ''
  const first = coords[0]!
  const base = round(baselineY)
  // Von der Nulllinie hoch zum ersten Punkt, der Stufenlinie entlang und
  // am Ende senkrecht zurueck auf die Nulllinie.
  const steps = buildStepPath(coords).replace(/^M\S+ \S+/, '')
  return `M${round(first.x)} ${base} V${round(first.y)}${steps} V${base} Z`
}

/**
 * Sparkline ohne Achsen: gleichmaessig verteilte Stichproben (Wochenraster
 * vom Dashboard), y wie im grossen Chart inkl. Nulllinie.
 */
export function buildSparklineGeometry(values: number[], width: number, height: number, inset = 1.5) {
  const domain = balanceDomain(values, 0.05)
  const plotHeight = Math.max(1, height - inset * 2)
  const step = values.length > 1 ? (width - inset * 2) / (values.length - 1) : 0
  const yOfValue = (value: number) => inset + plotHeight - ((value - domain.min) / (domain.max - domain.min)) * plotHeight
  const coords = values.map((value, index) => ({ x: inset + index * step, y: yOfValue(value) }))
  const zeroY = yOfValue(0)
  return {
    zeroY,
    coords,
    linePath: buildStepPath(coords),
    areaPath: buildStepAreaPath(coords, zeroY),
    hasNegative: values.some((value) => value < 0),
  }
}

/**
 * Wenige "runde" Beschriftungswerte fuer die y-Achse (in Cent). Immer
 * inklusive 0, plus Minimum/Maximum auf eine glatte Stufe gerundet.
 */
export function balanceAxisTicks(domain: { min: number; max: number }): number[] {
  const span = domain.max - domain.min
  const rawStep = span / 3
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, rawStep)))
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rawStep) ?? rawStep
  const ticks = new Set<number>([0])
  for (let value = step; value <= domain.max; value += step) ticks.add(value)
  for (let value = -step; value >= domain.min; value -= step) ticks.add(value)
  return [...ticks].sort((left, right) => left - right)
}

/**
 * Achsenbeschriftung ohne ",00": Die Ticks sind runde Betraege, und die
 * Nachkommastellen kosten in der schmalen linken Spalte nur Platz.
 * Arbeitet auf dem fertig formatierten String, damit Waehrung und Locale
 * vom Haushalt kommen wie ueberall sonst.
 */
export function compactMoneyLabel(formatted: string): string {
  return formatted.replace(/[.,]00(?=\D*$)/, '')
}
