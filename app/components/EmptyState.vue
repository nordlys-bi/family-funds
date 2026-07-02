<!--
  EmptyState — zentrale Komponente fuer Lade- und "Kein-Daten"-Zustaende.

  Drei Varianten:
  - loading:    wird gerade geladen (Spinner-Card)
  - no-household: kein aktiver Haushalt gewaehlt
  - default:    die normalen Daten rendern (Slot)

  Verwendung:
  <EmptyState :loading="loading">
    <h2>Meine Daten</h2>
    <p>Inhalt...</p>
  </EmptyState>
-->
<script setup lang="ts">
withDefaults(
  defineProps<{
    loading?: boolean
    noHousehold?: boolean
    loadingTitle?: string
    loadingText?: string
    noHouseholdTitle?: string
    noHouseholdText?: string
  }>(),
  {
    loading: false,
    noHousehold: false,
    loadingTitle: 'Daten werden geladen',
    loadingText: 'Wir holen die aktuellen Informationen.',
    noHouseholdTitle: 'Wähle zuerst einen Haushalt aus',
    noHouseholdText: 'Danach kannst du hier arbeiten.',
  },
)
</script>

<template>
  <section v-if="loading" class="empty-state">
    <div class="empty-state__card">
      <Kicker>Lädt</Kicker>
      <h2>{{ loadingTitle }}</h2>
      <p>{{ loadingText }}</p>
      <slot name="loading-cta" />
    </div>
  </section>

  <section v-else-if="noHousehold" class="empty-state">
    <div class="empty-state__card">
      <Kicker>Kein Haushalt aktiv</Kicker>
      <h2>{{ noHouseholdTitle }}</h2>
      <p>{{ noHouseholdText }}</p>
      <slot name="no-household-cta">
        <NuxtLink to="/households" class="empty-state__button">Zu den Haushalten</NuxtLink>
      </slot>
    </div>
  </section>

  <slot v-else />
</template>

<style scoped>
.empty-state {
  display: flex;
  justify-content: center;
  align-items: center;
}

.empty-state__card {
  width: min(640px, 100%);
  padding: 2rem;
  text-align: center;
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.18), transparent 32%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(10, 14, 24, 0.98));
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 28px;
  box-shadow:
    0 30px 80px rgba(2, 6, 23, 0.44),
    inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.empty-state__card h2 {
  margin: 0;
  font-size: 1.7rem;
  color: #f8fafc;
}

.empty-state__card p {
  margin: 0.75rem auto 0;
  max-width: 48ch;
  color: #94a3b8;
  line-height: 1.65;
}

.empty-state__button {
  display: inline-flex;
  margin-top: 1.2rem;
  padding: 0.85rem 1.1rem;
  border-radius: 14px;
  background: linear-gradient(135deg, #2563eb, #60a5fa);
  color: #fff;
  text-decoration: none;
  font-weight: 800;
}
</style>