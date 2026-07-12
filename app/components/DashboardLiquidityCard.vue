<!--
  DashboardLiquidityCard — die "Wieviel Geld ist gerade da?"-Antwort.

  Issue #57: User muss aktuell aus zwei Stellen (Sparziele + freies
  Restbudget) eine konsolidierte Liquiditäts-Zahl ableiten. Diese
  Komponente beantwortet genau die eine Frage, prominent und mit
  optionaler Aufschluesselung.

  Formel:
    totalSavings  = Summe aller SavingsGoal.currentAmount (Töpfe)
    freeBudget    = Summe aller ok-Budgets.remainingAmount
    totalLiquid   = totalSavings + freeBudget

  Empty-Verhalten: wenn beide null/0 sind, wird die ganze Karte
  ausgeblendet (kein leerer Container). Das ist explizit AC — die
  Sektion soll nicht da sein, wenn sie nichts zu sagen hat.

  Klickbarkeit: Optional, per NuxtLink gewrappt, fuehrt auf
  /budgeting/savings (Spartopf-Detail). Disabled-Optik nur, wenn
  ueberhaupt keine Daten da sind (in dem Fall wird die Karte
  ja schon ausgeblendet — die props stellen das sicher).
-->
<script setup lang="ts">
const props = defineProps<{
  savingsGoals: Array<{
    id: string
    name: string
    currentAmount: number
  }>
  budgetAlerts: Array<{
    budgetId: string
    remainingAmount: number
    severity: 'ok' | 'warning' | 'over'
  }>
  /**
   * Currency-aware money-formatter. Erwartet Cent-Amounts als Input.
   */
  formatMoney: (cents: number) => string
}>()

// Spar-Topf-Summe (Ist). Defensive: undefined/null currentAmount
// wird als 0 behandelt, damit ein Server-Schema-Mismatch nicht den
// ganzen Block sprengt.
const totalSavings = computed(() =>
  props.savingsGoals.reduce((sum, goal) => sum + (goal.currentAmount ?? 0), 0),
)

// Freies Restbudget ueber alle "ok"-Budgets. warning/over-Budgets
// zaehlen NICHT dazu, weil dort das Restbudget schon abgebaut /
// negativ ist — das wuerde die Liquiditaet kuenstlich aufblasen.
const freeBudgetTotal = computed(() =>
  props.budgetAlerts
    .filter((alert) => alert.severity === 'ok')
    .reduce((sum, alert) => sum + alert.remainingAmount, 0),
)

const totalLiquidity = computed(() => totalSavings.value + freeBudgetTotal.value)

// Empty-Guard: Karte komplett ausblenden, wenn nichts zu berichten ist.
// Vermeidet leere Cards, die visuell nach "es fehlt was" aussehen.
const hasAnyLiquidity = computed(
  () => totalSavings.value > 0 || freeBudgetTotal.value > 0,
)

// Welche Teile der Aufschluesselung zeigen wir? Wir blenden
// "Davon in Töpfen: 0 €" und "Davon frei in Budgets: 0 €" aus,
// damit die zweite Zeile nur die nichtleeren Komponenten nennt.
const showSavingsPart = computed(() => totalSavings.value > 0)
const showFreeBudgetPart = computed(() => freeBudgetTotal.value > 0)
</script>

<template>
  <NuxtLink
    v-if="hasAnyLiquidity"
    to="/budgeting/savings"
    class="liquidity"
    aria-label="Zur Sparziele-Übersicht"
  >
    <div class="liquidity__head">
      <span class="liquidity__label">Liquidität diesen Monat</span>
      <i class="pi pi-arrow-right liquidity__chevron" aria-hidden="true" />
    </div>
    <div class="liquidity__value">{{ formatMoney(totalLiquidity) }}</div>
    <div v-if="showSavingsPart || showFreeBudgetPart" class="liquidity__breakdown">
      <template v-if="showSavingsPart">
        <span class="liquidity__part">
          <i class="pi pi-wallet liquidity__part-icon" aria-hidden="true" />
          {{ formatMoney(totalSavings) }} in Töpfen
        </span>
      </template>
      <template v-if="showSavingsPart && showFreeBudgetPart">
        <span class="liquidity__sep" aria-hidden="true">·</span>
      </template>
      <template v-if="showFreeBudgetPart">
        <span class="liquidity__part">
          <i class="pi pi-check-circle liquidity__part-icon" aria-hidden="true" />
          {{ formatMoney(freeBudgetTotal) }} frei in Budgets
        </span>
      </template>
    </div>
  </NuxtLink>
</template>

<style scoped>
.liquidity {
  display: block;
  padding: 1rem 1.2rem;
  margin-bottom: 1.25rem;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.14), rgba(16, 185, 129, 0.10));
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 16px;
  text-decoration: none;
  color: inherit;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.liquidity:hover {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.20), rgba(16, 185, 129, 0.14));
  border-color: rgba(96, 165, 250, 0.34);
  transform: translateY(-1px);
}

.liquidity__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.35rem;
}

.liquidity__label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted, #94a3b8);
}

.liquidity__chevron {
  font-size: 0.85rem;
  color: var(--color-text-muted, #94a3b8);
  opacity: 0.7;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.liquidity:hover .liquidity__chevron {
  opacity: 1;
  transform: translateX(2px);
}

.liquidity__value {
  font-size: 1.65rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--color-text-primary, #f1f5f9);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.liquidity__breakdown {
  margin-top: 0.55rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.7rem;
  font-size: 0.8rem;
  color: var(--color-text-secondary, #cbd5e1);
  font-variant-numeric: tabular-nums;
}

.liquidity__part {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.liquidity__part-icon {
  font-size: 0.78rem;
  color: var(--color-accent-primary-text, #93c5fd);
}

.liquidity__sep {
  color: var(--color-text-muted, #94a3b8);
}

@media (max-width: 640px) {
  .liquidity {
    padding: 0.9rem 1rem;
  }
  .liquidity__value {
    font-size: 1.4rem;
  }
  .liquidity__breakdown {
    font-size: 0.78rem;
  }
}
</style>
