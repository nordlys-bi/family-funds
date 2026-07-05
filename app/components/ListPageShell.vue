<script setup lang="ts">
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
.list-page-shell {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.list-page-shell__header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  padding: 1.3rem 1.35rem;
  border-radius: 28px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background:
    linear-gradient(135deg, rgba(15, 23, 42, 0.97), rgba(17, 24, 39, 0.9)),
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.14), transparent 32%);
  box-shadow:
    0 26px 70px rgba(2, 6, 23, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.list-page-shell__copy {
  max-width: 58ch;
}

.list-page-shell__title {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3.15rem);
  line-height: 0.98;
  letter-spacing: -0.05em;
}

.list-page-shell__description {
  margin: 0.8rem 0 0;
  color: #94a3b8;
  font-size: 0.98rem;
  line-height: 1.55;
  max-width: 65ch;
}

.list-page-shell__summary {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.6rem;
  min-width: min(26rem, 100%);
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
  min-height: 0;
}

@media (max-width: 639px) {
  .list-page-shell__header {
    flex-direction: column;
    padding: 1rem 1rem 1.1rem;
    gap: 0.85rem;
  }

  /* Mobile: kleinerer Titel, dichter — Desktop hat 3rem-Headline, Mobile
     reichen 1.5rem (immer noch groesser als Standard-Text). Spart ~50px. */
  .list-page-shell__title {
    font-size: 1.5rem;
    line-height: 1.05;
    letter-spacing: -0.03em;
  }

  .list-page-shell__description {
    font-size: 0.85rem;
    line-height: 1.45;
    margin-top: 0.5rem;
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
