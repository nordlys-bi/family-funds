<!--
  /transactions ist nur ein Einstiegspunkt — die Inhalte sind auf Sub-Routen
  (/transactions/expenses, /transactions/income) aufgeteilt. Wir leiten
  direkt auf /transactions/expenses weiter (Issue #4).
-->
<script setup lang="ts">
definePageMeta({ layout: false })
await navigateTo('/transactions/expenses', { replace: true })
</script>

<template>
  <div />
</template>