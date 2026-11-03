<!--
  EnvelopeListRow — eine Zeile der Umschlag-Liste (ADR-0005).

  Der Saldo steht gross und farbig rechts, daneben der Trend der letzten
  3 Monate: Er ist die Hauptzahl eines virtuellen Kontos. Was darunter steht,
  haengt vom Anwendungsfall ab:
  - Laufende Ausgaben: Ausgaben und Zuteilung der Periode, Balken am Verfuegbaren
  - Fixkosten und Ruecklagen: nur die Zuteilung — ein Balken saehe bei einer
    Miete am 1. den ganzen Monat alarmierend aus
  - Mit Sparziel: Fortschritt zum Ziel, egal in welcher Gruppe
  Details, Verlauf und Aktionen liegen auf der Detailseite, auf die die ganze
  Zeile verlinkt.

  Slot `actions`: Platz fuer Zeilen-Aktionen (Umbuchen) NEBEN dem Link —
  ein Button innerhalb eines <a> waere ungueltiges HTML und wuerde die
  Navigation mit ausloesen.
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { EnvelopeItem } from '~/types/envelope'

const props = defineProps<{
  envelope: EnvelopeItem
  formatMoney: (cents: number) => string
  /** Name des Ziels bei geschlossenen Umschlaegen. */
  targetName?: string | null
}>()

const balance = computed(() => props.envelope.balance.balance)
// Stichtag erreicht: Der Endsaldo steckt bereits im Ziel (ADR-0005),
// also neutral statt gruen/rot. Ein Stichtag in der Zukunft ist noch offen.
const isClosed = computed(() => !isEnvelopeOpenOn(props.envelope))
const period = computed(() => props.envelope.currentPeriod)
const isRunning = computed(() => props.envelope.group === 'RUNNING')
const targetPercent = computed(() => {
  const target = props.envelope.targetAmount
  return target ? Math.max(0, balance.value / target) * 100 : null
})
const periodLabel = computed(() =>
  period.value ? formatEnvelopePeriodLabel(props.envelope.frequency, period.value.start, period.value.end) : null,
)
</script>

<template>
  <div class="envelope-row" :class="{ 'envelope-row--closed': isClosed }">
    <NuxtLink :to="`/budgeting/envelopes/${envelope.id}`" class="envelope-row__link">
      <div class="envelope-row__main">
        <span class="envelope-row__name">{{ envelope.name }}</span>
        <span class="envelope-row__sub">
          <span v-if="envelope.allocationSource !== 'NONE'" class="envelope-row__tag">{{ frequencyLabel(envelope.frequency) }}</span>
          <span v-if="isClosed" class="envelope-row__closed">
            geschlossen → {{ targetName ?? 'Zu verteilen' }}
          </span>
          <span v-else-if="envelope.closedAt" class="envelope-row__closed">
            schließt am {{ formatPlanningDate(envelope.closedAt) }} → {{ targetName ?? 'Zu verteilen' }}
          </span>
          <span v-if="!isClosed && period && isRunning" class="envelope-row__period">
            {{ periodLabel }}: {{ formatMoney(period.spent) }} ausgegeben, {{ formatMoney(period.allocation) }} zugeteilt
          </span>
          <span v-else-if="!isClosed && period" class="envelope-row__period">
            {{ periodLabel }}: {{ formatMoney(period.allocation) }} zugeteilt
          </span>
          <span v-if="!isClosed && envelope.targetAmount" class="envelope-row__period">
            {{ formatMoney(balance) }} von {{ formatMoney(envelope.targetAmount) }}
          </span>
          <span v-if="!isClosed && envelope.reserved > 0" class="envelope-row__period">
            +{{ formatMoney(envelope.reserved) }} kommen bis Monatsende
          </span>
        </span>
        <ListProgressBar
          v-if="!isClosed && period && isRunning"
          class="envelope-row__progress"
          :percent="period.percentUsed"
          :tone="envelope.severity"
        />
        <ListProgressBar
          v-if="!isClosed && targetPercent !== null"
          class="envelope-row__progress"
          :percent="Math.min(100, targetPercent)"
          :tone="targetPercent >= 100 ? 'ok' : 'accent'"
        />
      </div>
      <div class="envelope-row__aside">
        <span
          class="envelope-row__balance"
          :class="{ 'is-negative': balance < 0 && !isClosed, 'is-closed': isClosed }"
          :title="isClosed ? 'Endsaldo — steckt bereits im Ziel' : undefined"
        >{{ formatMoney(balance) }}</span>
        <EnvelopeBalanceSparkline :values="envelope.balanceTrend" :width="64" :height="18" />
      </div>
      <i class="pi pi-chevron-right envelope-row__chevron" aria-hidden="true" />
    </NuxtLink>
    <slot name="actions" />
  </div>
</template>

<style scoped>
.envelope-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-right: 0.5rem;
  background: var(--color-bg-panel-soft);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg, 12px);
  min-width: 0;
}

.envelope-row:hover {
  border-color: var(--color-border-default);
}

.envelope-row__link {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.3rem 0.7rem 0.8rem;
  color: inherit;
  text-decoration: none;
  min-width: 0;
  border-radius: inherit;
}

.envelope-row__link:hover .envelope-row__name {
  color: var(--color-accent-primary-text);
}

.envelope-row__link:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}

.envelope-row--closed {
  opacity: 0.75;
}

.envelope-row__main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.envelope-row__name {
  font-weight: 600;
  font-size: 0.92rem;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.envelope-row__sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 0.76rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.envelope-row__tag {
  padding: 1px 7px;
  background: var(--color-accent-primary-soft);
  color: var(--color-accent-primary-text);
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-radius: 4px;
}

.envelope-row__closed {
  padding: 1px 7px;
  background: rgba(148, 163, 184, 0.16);
  color: var(--color-text-secondary);
  font-size: 0.7rem;
  font-weight: 600;
  border-radius: 4px;
}

.envelope-row__progress {
  max-width: 220px;
}

.envelope-row__aside {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
  flex-shrink: 0;
}

.envelope-row__balance {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-accent-success-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.envelope-row__balance.is-negative {
  color: var(--color-accent-danger-text);
}

.envelope-row__balance.is-closed {
  color: var(--color-text-secondary);
}

.envelope-row__chevron {
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}
</style>
