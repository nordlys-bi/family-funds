<!--
  DashboardUnassignedCard — "Zu verteilen" (ADR-0005): das freie Geld des
  Haushalts als Hauptzahl, darunter was fuer den Rest des Monats schon
  vorgemerkt ist. Ersetzt die fruehere Liquiditaets-Karte: Was in Umschlaegen
  liegt, zeigen die Umschlaege selbst; offen ist die Frage "Wie viel kann ich
  noch verteilen?". Ein Klick oeffnet direkt die Umbuchung.
-->
<script setup lang="ts">
defineProps<{
  unassigned: { balance: number; reserved: number; free: number }
  formatMoney: (cents: number) => string
}>()

const quickCapture = useQuickCapture()
</script>

<template>
  <button type="button" class="unassigned" aria-label="Geld aus „Zu verteilen“ umbuchen" @click="quickCapture.open('transfer')">
    <div class="unassigned__head">
      <span class="unassigned__label">Zu verteilen</span>
      <i class="pi pi-arrow-right unassigned__chevron" aria-hidden="true" />
    </div>
    <div class="unassigned__value" :class="{ 'is-negative': unassigned.free < 0 }">{{ formatMoney(unassigned.free) }} frei</div>
    <div v-if="unassigned.reserved > 0" class="unassigned__breakdown">
      <span class="unassigned__part">
        <i class="pi pi-clock unassigned__part-icon" aria-hidden="true" />
        {{ formatMoney(unassigned.reserved) }} vorgemerkt bis Monatsende
      </span>
    </div>
  </button>
</template>

<style scoped>
.unassigned {
  display: block;
  width: 100%;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  padding: 1rem 1.2rem;
  margin-bottom: 1.25rem;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.14), rgba(16, 185, 129, 0.10));
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 16px;
  text-decoration: none;
  color: inherit;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.unassigned:hover {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.20), rgba(16, 185, 129, 0.14));
  border-color: rgba(96, 165, 250, 0.34);
  transform: translateY(-1px);
}

.unassigned__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.35rem;
}

.unassigned__label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted, #94a3b8);
}

.unassigned__chevron {
  font-size: 0.85rem;
  color: var(--color-text-muted, #94a3b8);
  opacity: 0.7;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.unassigned:hover .unassigned__chevron {
  opacity: 1;
  transform: translateX(2px);
}

.unassigned__value {
  font-size: 1.65rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--color-text-primary, #f1f5f9);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.unassigned__breakdown {
  margin-top: 0.55rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.7rem;
  font-size: 0.8rem;
  color: var(--color-text-secondary, #cbd5e1);
  font-variant-numeric: tabular-nums;
}

.unassigned__part {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.unassigned__part-icon {
  font-size: 0.78rem;
  color: var(--color-accent-primary-text, #93c5fd);
}

.unassigned__sep {
  color: var(--color-text-muted, #94a3b8);
}

@media (max-width: 640px) {
  .unassigned {
    padding: 0.9rem 1rem;
  }
  .unassigned__value {
    font-size: 1.4rem;
  }
  .unassigned__breakdown {
    font-size: 0.78rem;
  }
}
.unassigned__value.is-negative {
  color: var(--color-accent-danger-text);
}
</style>
