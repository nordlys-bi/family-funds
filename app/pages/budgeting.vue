<!--
  /budgeting ist nur ein Einstiegspunkt — die Inhalte sind auf Sub-Routen
  (/budgeting/budgets, /budgeting/recurring, /budgeting/savings) aufgeteilt.
  Wir leiten direkt auf /budgeting/budgets weiter (Issue #4).
-->
<script setup lang="ts">
definePageMeta({ layout: false })
await navigateTo('/budgeting/budgets', { replace: true })
</script>

<template>
  <div />
</template>