<!--
  TransactionTypeSwitch — Segment-Control "Ausgaben | Einnahmen" oben auf den
  beiden Buchungsseiten (issue #101).

  Ausgaben (taeglich) und Einnahmen (~1x im Monat) waren gleichrangige
  Geschwister in der Navigation. Jetzt ist "Buchungen" EIN Bereich, und dieses
  Control wechselt darin die Art. Die beiden Routen bleiben bestehen
  (Deep-Links, ?new=1, Onboarding-Ziel) — der Wechsel ist eine normale
  Navigation, die `?month=` und den Person-Filter mitnimmt und alles
  Ausgaben-Spezifische verwirft (siehe `transactionSwitchQuery`).

  Die aktive Art kommt aus dem Pfad, nicht aus lokalem State: Browser-Back
  und Deep-Links zeigen damit immer das richtige Segment.

  Verwendung (ListPageShell-Slot):
  <template #segment><TransactionTypeSwitch /></template>
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from '#app'
import {
  transactionSwitchTarget,
  transactionTypeFromPath,
  type TransactionType,
} from '~/utils/transaction-nav'

const route = useRoute()
const router = useRouter()

const options: Array<{ label: string; value: TransactionType }> = [
  { label: 'Ausgaben', value: 'expenses' },
  { label: 'Einnahmen', value: 'income' },
]

// Ausgaben ist der Default (auch fuer Pfade, die keine der beiden Arten sind).
const current = computed<TransactionType>(() => transactionTypeFromPath(route.path) ?? 'expenses')

async function onChange(next: TransactionType | null) {
  if (!next || next === current.value) return
  await router.push(transactionSwitchTarget(next, route.query))
}
</script>

<template>
  <SelectButton
    class="transaction-type-switch"
    :model-value="current"
    :options="options"
    option-label="label"
    option-value="value"
    :allow-empty="false"
    aria-label="Art der Buchungen"
    @update:model-value="onChange"
  />
</template>

<style scoped>
/* Mobil ueber die volle Breite: grosse Touch-Ziele, kein loses Widget. */
@media (max-width: 639px) {
  .transaction-type-switch {
    display: flex;
    width: 100%;
  }

  .transaction-type-switch :deep(.p-togglebutton) {
    flex: 1 1 0;
    min-height: var(--touch-target-min, 44px);
  }
}
</style>
