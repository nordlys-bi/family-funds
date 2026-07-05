<!--
  RoleTag — vereinheitlichte Darstellung von Haushalts-/Mitgliedsrollen.

  Verwendung:
  <RoleTag role="OWNER" />
  <RoleTag role="MEMBER" />

  Visuelle Logik:
  - OWNER: success (grün) — der Haushalt-Owner
  - MEMBER: info (blau) — normales Mitglied
  - Aktiv-Badge: success (gleicher Token wie OWNER, daher getrennt verwendet)

  Migration: ersetzt <Tag :value="member.role" :severity="..." /> Streuung,
  die in members.vue, settings.vue, index.vue, etc. dupliziert war.
-->
<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    role: 'OWNER' | 'MEMBER' | string
    /** Optional: Severity-Override. Default richtet sich nach role. */
    severity?: 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'
  }>(),
  { severity: undefined },
)

const resolvedSeverity = computed(() => {
  if (props.severity) return props.severity
  return props.role === 'OWNER' ? 'success' : 'info'
})
</script>

<template>
  <Tag :value="role" :severity="resolvedSeverity" rounded />
</template>
