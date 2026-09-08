<script setup lang="ts">
// Milestone-Eyebrows ("Meilenstein 4 / Budgets") waren reine interne
// Roadmap-Marker und gehören nicht in die User-Facing-UI. Das `eyebrow`-Prop
// bleibt für Inhalte erhalten, die echte Section-Beschriftungen sind
// (z. B. "Budget", "Einnahmen" auf ListPanels — die werden weiter genutzt),
// aber Seiten-Header mit "MEILENSTEIN X / Y" sind per Page rausgenommen.
defineProps<{
  eyebrow?: string
  title: string
  description?: string
}>()
</script>

<template>
  <section class="list-page-shell">
    <header class="list-page-shell__header">
      <div class="list-page-shell__copy">
        <Kicker v-if="eyebrow" size="lg" as="p">{{ eyebrow }}</Kicker>
        <h1 class="list-page-shell__title">{{ title }}</h1>
        <p v-if="description" class="list-page-shell__description">
          {{ description }}
        </p>
      </div>

      <div v-if="$slots.summary" class="list-page-shell__summary">
        <slot name="summary" />
      </div>
    </header>

    <div v-if="$slots.toolbar" class="list-page-shell__toolbar">
      <slot name="toolbar" />
    </div>

    <div class="list-page-shell__content">
      <slot />
    </div>
  </section>
</template>

<style scoped>
/*
 * Issue #93 Folgearbeit: Der Seiten-Header ist ein schlanker Titel-Balken,
 * keine Hero-Karte mehr. Die Navigation sagt bereits, wo man ist — der
 * Header muss das nicht mit 3rem-Headline, Verlauf und Schatten wiederholen.
 * Spart ~90px (Desktop) / ~140px (Mobile) auf jeder Listenseite.
 */
.list-page-shell {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.list-page-shell__header {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem 1.5rem;
  align-items: baseline;
  flex-wrap: wrap;
  padding: 0.15rem 0.1rem 0;
}

.list-page-shell__copy {
  max-width: 70ch;
  min-width: 0;
}

.list-page-shell__title {
  margin: 0;
  font-size: 1.4rem;
  line-height: 1.2;
  letter-spacing: -0.02em;
  font-weight: 700;
}

.list-page-shell__description {
  margin: 0.3rem 0 0;
  color: var(--color-text-muted, #94a3b8);
  font-size: 0.85rem;
  line-height: 1.5;
  max-width: 70ch;
}

.list-page-shell__summary {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.6rem;
  min-width: 0;
}

.list-page-shell__toolbar {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
  padding: 0 0.1rem;
}

.list-page-shell__content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
}

@media (max-width: 639px) {
  .list-page-shell__header {
    flex-direction: column;
    padding: 0;
    gap: 0.5rem;
  }

  .list-page-shell__title {
    font-size: 1.2rem;
    line-height: 1.15;
    letter-spacing: -0.02em;
  }

  .list-page-shell__description {
    font-size: 0.82rem;
    line-height: 1.45;
    margin-top: 0.35rem;
  }

  .list-page-shell__summary {
    justify-content: flex-start;
    /* Horizontal scrollen wenn mehr als 2 Tags — vermeidet erzwungenes
       3-Reihen-Layout, das sonst 90px frisst. */
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    flex-wrap: wrap; /* Wenn 2-3 Tags passen, normal umbrechen statt scrollen */
  }

  .list-page-shell__summary::-webkit-scrollbar { display: none; }

  .list-page-shell__toolbar {
    padding: 0;
  }
}
</style>
