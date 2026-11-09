<!--
  /budgeting ist nur ein Einstiegspunkt — die Inhalte sind auf Sub-Routen
  (/budgeting/envelopes) aufgeteilt.
  Wir leiten direkt auf /budgeting/envelopes weiter (Issue #4).
-->
<script setup lang="ts">
definePageMeta({ layout: false })
await navigateTo('/budgeting/envelopes', { replace: true })
</script>

<template>
  <div />
</template>