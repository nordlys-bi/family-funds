import { describe, expect, it } from 'vitest'
import { goalProgressDisplay } from '../savings-progress'

describe('goalProgressDisplay', () => {
  it('zeigt ein Ziel unterwegs blau mit Prozentwert', () => {
    expect(goalProgressDisplay({ targetAmount: 1_000_000, currentAmount: 27_900, progressPercent: 2.8 })).toEqual({
      reached: false,
      percent: 2.8,
      tone: 'accent',
      label: '2.8%',
    })
  })

  it('zeigt ein erreichtes Ziel gruen mit "Erreicht"', () => {
    expect(goalProgressDisplay({ targetAmount: 500_000, currentAmount: 500_000, progressPercent: 100 })).toEqual({
      reached: true,
      percent: 100,
      tone: 'ok',
      label: 'Erreicht',
    })
  })

  it('deckelt den Balken bei 100 %, wenn mehr gespart wurde als geplant', () => {
    const display = goalProgressDisplay({ targetAmount: 100_000, currentAmount: 130_000, progressPercent: 130 })
    expect(display.percent).toBe(100)
    expect(display.reached).toBe(true)
    expect(display.tone).toBe('ok')
  })

  it('setzt den Balken bei negativem Fortschritt auf 0, das Label zeigt den echten Wert', () => {
    const display = goalProgressDisplay({ targetAmount: 100_000, currentAmount: -5_000, progressPercent: -5 })
    expect(display.percent).toBe(0)
    expect(display.reached).toBe(false)
    expect(display.label).toBe('-5%')
  })

  it('behandelt fehlende Werte als 0 (Backend liefert sie nicht immer)', () => {
    expect(goalProgressDisplay({ targetAmount: 100_000 })).toEqual({
      reached: false,
      percent: 0,
      tone: 'accent',
      label: '0%',
    })
  })

  it('gilt ein Ziel ohne Zielbetrag nie als erreicht', () => {
    const display = goalProgressDisplay({ targetAmount: 0, currentAmount: 0, progressPercent: 0 })
    expect(display.reached).toBe(false)
    expect(display.tone).toBe('accent')
  })
})
