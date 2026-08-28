<!--
  FilterDisclosure — Toggle-Button, der eine Filter-Leiste ein-/ausklappt
  (issue #95).

  Die sekundären Filter auf den Listen-Seiten (Person / Budget / „ohne
  Budget") waren dauerhaft in der Toolbar und haben die eigentliche Liste
  unter den Fold gedrückt. Sie leben jetzt hinter diesem Toggle; die
  Anzahl aktiver Filter steht als Zähler im Label, damit auch im
  eingeklappten Zustand sichtbar ist, dass gefiltert wird.

  Verwendung:
    <FilterDisclosure v-model:open="filtersOpen" :active-count="activeFilterCount" />
    <div v-if="filtersOpen" class="filter-panel"> … Filter-Controls … </div>
-->
<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    activeCount?: number
  }>(),
  { activeCount: 0 },
)

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const label = computed(() => {
  if (props.open) return 'Filter ausblenden'
  return props.activeCount > 0 ? `Filter (${props.activeCount})` : 'Filter'
})
</script>

<template>
  <Button
    :label="label"
    :icon="open ? 'pi pi-chevron-up' : 'pi pi-filter'"
    :severity="activeCount > 0 ? 'warn' : 'secondary'"
    :outlined="activeCount === 0"
    size="small"
    :aria-expanded="open"
    aria-label="Filter ein- oder ausblenden"
    @click="emit('update:open', !open)"
  />
</template>
