<!--
  EnvelopeSelect — Select fuer Umschlaege, zeigt die Gruppe als Badge
  (ADR-0005). Namen allein sind mehrdeutig: "Auto" kann eine Ruecklage oder
  eine laufende Ausgabe sein. Der Eintrag "Zu verteilen" hat keine Gruppe und
  bleibt ohne Badge.

  Verwendung wie <Select>, Optionen mit `label`, `value` und optional `group`:
  <EnvelopeSelect id="x" v-model="form.envelopeId" :options="options" placeholder="Zu verteilen" />
-->
<script setup lang="ts">
import { ENVELOPE_GROUPS, type EnvelopeGroup } from '~/utils/envelope-options'

function groupLabel(group: EnvelopeGroup) {
  return ENVELOPE_GROUPS.find((item) => item.value === group)?.label ?? ''
}
</script>

<template>
  <Select option-label="label" option-value="value">
    <template #option="{ option }">
      <span class="envelope-option">
        <span class="envelope-option__name">{{ option.label }}</span>
        <span v-if="option.group" class="envelope-option__group">{{ groupLabel(option.group) }}</span>
      </span>
    </template>
  </Select>
</template>

<style scoped>
.envelope-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  min-width: 0;
}

.envelope-option__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.envelope-option__group {
  flex-shrink: 0;
  padding: 0.1rem 0.45rem;
  border: 1px solid var(--color-border-subtle);
  border-radius: 999px;
  color: var(--color-text-muted);
  font-size: 0.7rem;
  font-weight: 600;
  white-space: nowrap;
}
</style>
