<!--
  EmptyState — zentrale Komponente fuer Lade- und "Kein-Daten"-Zustaende.

  Modi (Prioritaet von oben nach unten):
  1. loading:    wird gerade geladen (Spinner-Card, mit optionalem Skeleton-Slot)
  2. noHousehold: kein aktiver Haushalt gewaehlt
  3. variant:    first-time | no-data | no-results — wenn KEIN Slot-Inhalt
                 kommt, wird die Variant-Card mit icon/headline/description/cta
                 gerendert
  4. default:    wenn Slot-Inhalt vorhanden ist, wird es gerendert (rueckwaerts-
                 kompatibel mit der urspruenglichen "wrap content"-Verwendung)

  Verwendung (klassisch, rueckwaertskompatibel):
  <EmptyState :loading="loading">
    <h2>Meine Daten</h2>
    <p>Inhalt...</p>
  </EmptyState>

  Verwendung (neu, First-Time / No-Data / No-Results):
  <EmptyState
    variant="first-time"
    icon="pi pi-wallet"
    icon-tone="accent"
    headline="Noch keine Buchungen"
    description="Erfasse deine erste Ausgabe, um Auswertungen zu sehen."
    :cta="{ label: 'Ausgabe anlegen', onClick: openDialog }"
  />

  Skeleton-Pattern:
  <EmptyState :loading="loading" loading-variant="skeleton">
    <template #loading-skeleton>
      <Skeleton ... />
    </template>
  </EmptyState>
-->
<script setup lang="ts">
export type EmptyStateVariant = 'first-time' | 'no-data' | 'no-results'
export type EmptyStateIconTone = 'muted' | 'accent' | 'success' | 'warning'

export type EmptyStateCta = {
  label: string
  /** Wird gerendert als Button (onClick) — meist useTemplateRef-Pattern. */
  onClick?: () => void
  /** Optional: NuxtLink-Ziel. Hat Vorrang vor onClick, wenn gesetzt. */
  to?: string
  /** Severity entspricht PrimeVue-Button-Stilen. */
  severity?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger'
}

const props = withDefaults(
  defineProps<{
    // === Legacy-Props (loading + noHousehold) ===
    loading?: boolean
    noHousehold?: boolean
    loadingTitle?: string
    loadingText?: string
    noHouseholdTitle?: string
    noHouseholdText?: string

    // === Neu (issue #13) ===
    variant?: EmptyStateVariant
    icon?: string
    iconTone?: EmptyStateIconTone
    headline?: string
    description?: string
    cta?: EmptyStateCta

    // === Loading-Variante ===
    /** 'spinner' (default) oder 'skeleton' (Issue #13, fuehrt #loading-skeleton-Slot). */
    loadingVariant?: 'spinner' | 'skeleton'
  }>(),
  {
    loading: false,
    noHousehold: false,
    loadingTitle: 'Daten werden geladen',
    loadingText: 'Wir holen die aktuellen Informationen.',
    noHouseholdTitle: 'Wähle zuerst einen Haushalt aus',
    noHouseholdText: 'Danach kannst du hier arbeiten.',
    variant: undefined,
    icon: undefined,
    iconTone: 'muted',
    headline: undefined,
    description: undefined,
    cta: undefined,
    loadingVariant: 'spinner',
  },
)

const slots = defineSlots<{
  default(): unknown
  'loading-skeleton'(): unknown
  'loading-cta'(): unknown
  'no-household-cta'(): unknown
  'variant-cta'(): unknown
}>()

// Variant-Copy-Fallbacks: wenn Pages nur `icon` + `variant` setzen,
// bekommen sie sinnvolle Default-Texte (Issue #13 Out-of-Scope:
// Per-User-Customization, also Defaults sind okay).
const variantCopy: Record<EmptyStateVariant, { kicker: string; defaultHeadline: string; defaultDescription: string }> = {
  'first-time': {
    kicker: 'Loslegen',
    defaultHeadline: 'Willkommen!',
    defaultDescription: 'Hier entstehen gleich deine ersten Einträge.',
  },
  'no-data': {
    kicker: 'Keine Daten',
    defaultHeadline: 'Noch nichts da',
    defaultDescription: 'Sobald du etwas erfasst, erscheint es hier.',
  },
  'no-results': {
    kicker: 'Keine Treffer',
    defaultHeadline: 'Nichts gefunden',
    defaultDescription: 'Versuche es mit einem anderen Filter oder Zeitraum.',
  },
}

const resolvedHeadline = computed(() => props.headline ?? variantCopy[props.variant ?? 'no-data']?.defaultHeadline ?? '')
const resolvedDescription = computed(() => props.description ?? variantCopy[props.variant ?? 'no-data']?.defaultDescription ?? '')
const resolvedKicker = computed(() => variantCopy[props.variant ?? 'no-data']?.kicker ?? '')
</script>

<template>
  <section v-if="loading" class="empty-state">
    <div v-if="loadingVariant === 'skeleton' && slots['loading-skeleton']" class="empty-state__skeleton">
      <slot name="loading-skeleton" />
    </div>
    <div v-else class="empty-state__card">
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

  <!-- Variante first-time / no-data / no-results: nur rendern, wenn KEIN
       Slot-Default-Inhalt vorhanden ist (sonst gewinnt der Slot, weil der
       klassische "wrap content"-Use-Case unterstuetzt werden soll). -->
  <section v-else-if="variant && !slots.default" class="empty-state empty-state--variant">
    <div :class="['empty-state__card', `empty-state__card--${variant}`]">
      <Kicker>{{ resolvedKicker }}</Kicker>
      <i v-if="icon" :class="['empty-state__icon', `empty-state__icon--${iconTone}`, icon]" aria-hidden="true" />
      <h2>{{ resolvedHeadline }}</h2>
      <p>{{ resolvedDescription }}</p>
      <slot name="variant-cta">
        <NuxtLink
          v-if="cta?.to"
          :to="cta.to"
          :class="['empty-state__button', `empty-state__button--${cta.severity ?? 'primary'}`]"
        >
          {{ cta.label }}
        </NuxtLink>
        <button
          v-else-if="cta?.onClick"
          :class="['empty-state__button', `empty-state__button--${cta.severity ?? 'primary'}`]"
          type="button"
          @click="cta.onClick"
        >
          {{ cta.label }}
        </button>
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

/* Variant-spezifische zarte Tönung: first-time ist warmer, no-data kühler. */
.empty-state__card--first-time {
  background:
    radial-gradient(circle at top right, rgba(96, 165, 250, 0.22), transparent 36%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(10, 14, 24, 0.98));
}

.empty-state__card--no-results {
  background:
    radial-gradient(circle at top right, rgba(148, 163, 184, 0.14), transparent 32%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(10, 14, 24, 0.98));
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

.empty-state__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  margin: 0.5rem auto 1rem;
  border-radius: 18px;
  font-size: 1.8rem;
  background: rgba(148, 163, 184, 0.12);
  color: #cbd5e1;
}

.empty-state__icon--muted {
  background: rgba(148, 163, 184, 0.12);
  color: #cbd5e1;
}

.empty-state__icon--accent {
  background: rgba(59, 130, 246, 0.18);
  color: #93c5fd;
}

.empty-state__icon--success {
  background: rgba(34, 197, 94, 0.18);
  color: #86efac;
}

.empty-state__icon--warning {
  background: rgba(245, 158, 11, 0.18);
  color: #fcd34d;
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
  border: none;
  cursor: pointer;
  font-size: 0.95rem;
}

.empty-state__button--secondary {
  background: rgba(148, 163, 184, 0.16);
  color: #e2e8f0;
}

.empty-state__button--success {
  background: linear-gradient(135deg, #16a34a, #4ade80);
}

.empty-state__button--warning {
  background: linear-gradient(135deg, #d97706, #fbbf24);
}

a.empty-state__button {
  text-decoration: none;
}
</style>
