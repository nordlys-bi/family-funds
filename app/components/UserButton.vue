<!--
  UserButton — Wrapper/Stub fuer Clerk's <UserButton>.

  Problem: in app/layouts/default.vue wird <UserButton :show-name="..." />
  in v-if="isClerkMode"-Bloecken verwendet. Im Mock-Mode (keine Clerk-Keys)
  ist @clerk/nuxt NICHT geladen, also hat Vue die Komponente nicht im
  Registry. Result: Vue-Warnung "Failed to resolve component: UserButton"
  bei jedem Render — kein Crash, aber Console-Spam.

  Fix: lokale Komponente in app/components/, die Nuxt per Auto-Import
  als <UserButton> registriert. Im Mock-Mode rendert sie nichts (Stub).
  Im Clerk-Mode wird sie durch @clerk/nuxt's Plugin-Komponente
  ueberschrieben (Plugins werden nach Auto-Imports geladen), sodass
  Clerk's echte User-Button-Funktion erhaelt bleibt.

  Reihenfolge in Nuxt:
    1. Built-ins
    2. Auto-Imports (app/components/)
    3. Module-Components (@clerk/nuxt)
  → Schritt 3 gewinnt im Clerk-Mode, Schritt 2 im Mock-Mode.
-->
<script setup lang="ts">
const config = useRuntimeConfig()
const isClerkMode = config.public.authMode === 'clerk'
</script>

<template>
  <!-- Mock-Mode: nichts rendern, damit das Layout keine leere
       User-Button-Box anzeigt. Im Clerk-Mode ueberschreibt @clerk/nuxt
       diese Komponente komplett. -->
  <span v-if="!isClerkMode" class="user-button-stub" aria-hidden="true" />
</template>

<style scoped>
.user-button-stub {
  display: none;
}
</style>
