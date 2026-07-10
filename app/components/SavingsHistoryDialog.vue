<!--
  SavingsHistoryDialog — Bewegungs-History pro Sparziel (issue #39).

  Verwendung:
  <SavingsHistoryDialog
    v-model:visible="historyDialogOpen"
    :goal="selectedGoal"
    :household-id="activeHouseholdId"
  />

  Verhalten:
  - Oeffnet einen Dialog mit der Liste aller Spar-Executions fuer das
    uebergebene Goal, neueste zuerst.
  - Pagination: Initial 20, "Mehr laden" holt die naechsten 20.
  - Pro Eintrag: Datum, Betrag (positiv gruen, negativ rot), optionale Notiz.
  - Empty-State, wenn noch keine Buchungen existieren.
  - Loading-Spinner waerend der initialen Page.
  - Error-Banner, wenn der Server fehlschlaegt.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSavingsExecutionHistory, type ExecutionHistoryItem } from '~/composables/useSavingsExecutionHistory'

type SavingsGoalLike = {
  id: string
  name: string
  targetAmount: number
}

const props = defineProps<{
  visible: boolean
  goal: SavingsGoalLike | null
  householdId: string | null
  currency?: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const currencyCode = computed(() => props.currency ?? 'EUR')
const moneyFormatter = computed(
  () => new Intl.NumberFormat('de-DE', { style: 'currency', currency: currencyCode.value }),
)
const formatMoney = (value: number) => moneyFormatter.value.format(value / 100)

const dateFormatter = computed(
  () => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }),
)
const formatDate = (value: string) => dateFormatter.value.format(new Date(value))

const history = useSavingsExecutionHistory(
  () => props.householdId,
  () => props.goal?.id ?? null,
)

const showEmpty = computed(() => history.loaded.value && history.items.value.length === 0)

watch(
  () => [props.visible, props.goal?.id] as const,
  async ([visible, goalId]) => {
    if (visible && goalId) {
      history.reset()
      await history.load()
    } else if (!visible) {
      history.reset()
    }
  },
  { immediate: false },
)

function close() {
  emit('update:visible', false)
}

function reload() {
  return history.refresh()
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="goal ? `Bewegungen: ${goal.name}` : 'Bewegungen'"
    :style="{ width: 'min(44rem, 94vw)' }"
    :dismissable-mask="true"
    @update:visible="(v) => emit('update:visible', v)"
    @hide="close"
  >
    <!-- Loading: erster Page-Load, noch nichts da. -->
    <div v-if="history.loading.value && history.items.value.length === 0" class="history-loading">
      <i class="pi pi-spin pi-spinner" aria-hidden="true" />
      <span>Bewegungen werden geladen …</span>
    </div>

    <!-- Error-Banner -->
    <Message
      v-if="history.error.value"
      severity="error"
      variant="simple"
      class="history-error"
    >
      {{ history.error.value }}
      <template #end>
        <Button
          label="Erneut versuchen"
          icon="pi pi-refresh"
          size="small"
          severity="secondary"
          text
          @click="reload()"
        />
      </template>
    </Message>

    <!-- Empty-State: keine Buchungen fuer dieses Goal. -->
    <div v-if="showEmpty" class="history-empty">
      <i class="pi pi-inbox history-empty__icon" aria-hidden="true" />
      <p class="history-empty__headline">Noch keine Buchungen</p>
      <p class="history-empty__sub">
        Leg deine erste Einzahlung an, um die Bewegungen hier zu sehen.
      </p>
    </div>

    <!-- Liste der Buchungen -->
    <ul v-if="history.items.value.length > 0" class="history-list">
      <li
        v-for="item in history.items.value"
        :key="item.id"
        class="history-item"
        :class="{
          'history-item--deposit': item.amount > 0,
          'history-item--withdraw': item.amount < 0,
        }"
      >
        <div class="history-item__date">{{ formatDate(item.date) }}</div>
        <div class="history-item__amount">
          <span class="history-item__sign" aria-hidden="true">
            {{ item.amount > 0 ? '+' : '−' }}
          </span>
          {{ formatMoney(Math.abs(item.amount)) }}
        </div>
        <div v-if="item.note" class="history-item__note">{{ item.note }}</div>
        <div v-else class="history-item__note history-item__note--muted">
          (keine Notiz)
        </div>
      </li>
    </ul>

    <!-- "Mehr laden" -->
    <div
      v-if="history.hasMore.value"
      class="history-loadmore"
    >
      <Button
        :label="history.loading.value ? 'Lade …' : 'Mehr laden'"
        icon="pi pi-arrow-down"
        severity="secondary"
        outlined
        :loading="history.loading.value"
        :disabled="history.loading.value"
        @click="history.loadMore()"
      />
    </div>

    <template #footer>
      <Button
        type="button"
        label="Schliessen"
        severity="secondary"
        outlined
        @click="close"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.history-loading {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 1.5rem 0;
  color: var(--color-text-muted, #94a3b8);
  font-size: 0.92rem;
  justify-content: center;
}

.history-error {
  margin-bottom: 0.75rem;
}

.history-empty {
  text-align: center;
  padding: 2.5rem 1rem 1.5rem;
  color: var(--color-text-muted, #94a3b8);
}

.history-empty__icon {
  font-size: 2.2rem;
  display: block;
  margin: 0 auto 0.5rem;
  opacity: 0.55;
}

.history-empty__headline {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary, #e2e8f0);
  margin: 0 0 0.3rem;
}

.history-empty__sub {
  font-size: 0.86rem;
  margin: 0;
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: min(60vh, 28rem);
  overflow-y: auto;
}

.history-item {
  display: grid;
  grid-template-columns: minmax(6rem, auto) minmax(7rem, auto) 1fr;
  align-items: baseline;
  gap: 0.5rem 1rem;
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.18));
  background: var(--bg-card-row, rgba(30, 41, 59, 0.4));
  font-size: 0.88rem;
}

@media (max-width: 480px) {
  .history-item {
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'date amount'
      'note note';
    gap: 0.25rem 0.6rem;
  }
  .history-item__date { grid-area: date; }
  .history-item__amount { grid-area: amount; }
  .history-item__note { grid-area: note; }
}

.history-item__date {
  color: var(--color-text-muted, #94a3b8);
  font-size: 0.84rem;
  white-space: nowrap;
}

.history-item__amount {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

.history-item__sign {
  display: inline-block;
  width: 0.85em;
}

.history-item--deposit .history-item__amount {
  color: #34d399; /* gruen */
}

.history-item--withdraw .history-item__amount {
  color: #f87171; /* rot */
}

.history-item__note {
  color: var(--color-text-primary, #e2e8f0);
  font-size: 0.86rem;
  overflow-wrap: anywhere;
}

.history-item__note--muted {
  color: var(--color-text-muted, #94a3b8);
  font-style: italic;
  font-size: 0.82rem;
}

.history-loadmore {
  display: flex;
  justify-content: center;
  margin-top: 0.85rem;
}
</style>
