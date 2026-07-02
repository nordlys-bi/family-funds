<!--
  Kicker — kompakte, getrackte Mini-Überschrift über Panel- oder Section-Titeln.
  Ersetzt drei vorher verstreute Klassen:
    - .panel-kicker (in budgeting.vue für "Budget", "Einnahmen" etc.)
    - .empty-state__eyebrow (für "Lädt", "Kein Haushalt aktiv")
    - .list-page-shell__eyebrow (im ListPageShell-Wrapper)
  Plus die nicht mehr verwendete Klasse .eyebrow in budgeting.vue.

  Visuell: uppercase, breites Letter-Spacing, kleine Schrift, gedämpfte
  Akzentfarbe. Soll nicht mit der Haupt-Headline konkurrieren, sondern
  Kontext liefern ("MEILENSTEIN 4" über "Budgetierung & Sparpläne").

  Props:
    - as: HTML-Tag (default 'p'). 'span' für Inline-Kontext.
    - size: 'sm' (default, in Panels) | 'lg' (Page-Header-Eyebrow).
    - tone: 'accent' (default, bläulich) | 'muted' (grau) | 'success'/'warning'/'danger'.
-->
<script setup lang="ts">
withDefaults(
  defineProps<{
    as?: 'p' | 'span' | 'div'
    size?: 'sm' | 'lg'
    tone?: 'accent' | 'muted' | 'success' | 'warning' | 'danger'
  }>(),
  { as: 'p', size: 'sm', tone: 'accent' },
)
</script>

<template>
  <component
    :is="as"
    class="kicker"
    :class="[`kicker--${size}`, `kicker--${tone}`]"
  >
    <slot />
  </component>
</template>

<style scoped>
.kicker {
  /* Layout */
  margin: 0;
  display: inline-block;

  /* Typography */
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 0.72rem;
  line-height: 1.2;
  font-weight: 800;

  /* Spacing below — der Wert, den die alte .panel-kicker-Regel gesetzt hat */
  margin-bottom: 0.6rem;
}

.kicker--lg {
  /* Größer, weiter getrackt, leichter im Gewicht — für den Page-Header-Eyebrow
     (ehemals .list-page-shell__eyebrow). */
  font-size: 0.78rem;
  letter-spacing: 0.22em;
  font-weight: 700;
  margin-bottom: 0.4rem;
}

.kicker--accent {
  color: var(--color-accent-primary-text);
}

.kicker--muted {
  color: var(--color-text-muted);
}

.kicker--success {
  color: var(--color-accent-success-text);
}

.kicker--warning {
  color: var(--color-accent-warning-text);
}

.kicker--danger {
  color: var(--color-accent-danger-text);
}
</style>