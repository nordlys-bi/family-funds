<!--
  ItemCard — kompakte Listen-Card (A-Stil: Tight & Dense).

  Slots:
    - default:       kompletter Body-Inhalt (wenn kein main/actions-Format gewuenscht)
    - #main:         linke Seite, Title + Meta
    - #progress:     optionaler Progress-Bar-Slot zwischen Main und Actions
    - #meta:         zusaetzliche Meta-Info unter dem Main-Inhalt
    - #actions:      rechte Seite, Buttons (default unsichtbar, sichtbar bei Row-Hover)
    - #aside:        optionaler Aside-Block zwischen Meta und Actions (z. B. Amount)

  Props:
    - variant:        'default' | 'primary' (Border-Left-Akzent) | 'muted' (Sonstiges-Bucket)
    - density:        'compact' (default, 36px) | 'cozy' (44px) | 'spacious' (52px)
    - hoverActions:   'true' (default) | 'false' — ob Actions nur bei Hover sichtbar sind

  Verwendung:
  <ItemCard variant="primary">
    <template #main>
      <strong>Lebensmittel</strong>
      <span>Wöchentlich · 4 Perioden</span>
    </template>
    <template #progress>
      <ListProgressBar :percent="1.8" tone="warning" />
    </template>
    <template #aside>
      <div class="amount">18,06 € / 1.000,00 €</div>
    </template>
    <template #actions>
      <button>✎</button>
      <button>🗑</button>
    </template>
  </ItemCard>
-->
<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'default' | 'primary' | 'muted'
    density?: 'compact' | 'cozy' | 'spacious'
    hoverActions?: boolean
  }>(),
  {
    variant: 'default',
    density: 'compact',
    hoverActions: true,
  },
)
</script>

<template>
  <article
    class="item-card"
    :class="[`item-card--${variant}`, `item-card--${density}`, { 'item-card--hover-actions': hoverActions }]"
  >
    <div v-if="$slots.main || $slots.default" class="item-card__main">
      <slot name="main">
        <slot />
      </slot>
      <div v-if="$slots.meta" class="item-card__meta">
        <slot name="meta" />
      </div>
    </div>

    <div v-if="$slots.progress" class="item-card__progress">
      <slot name="progress" />
    </div>

    <div v-if="$slots.aside" class="item-card__aside">
      <slot name="aside" />
    </div>

    <div v-if="$slots.actions" class="item-card__actions">
      <slot name="actions" />
    </div>
  </article>
</template>

<style scoped>
.item-card {
  display: flex;
  align-items: center;
  gap: 14px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-card-row);
  transition: background 0.12s ease, border-color 0.12s ease;
  position: relative;
}

.item-card--compact { padding: 10px 14px; min-height: 48px; }
.item-card--cozy    { padding: 14px 18px; min-height: 56px; }
.item-card--spacious { padding: 18px 22px; min-height: 64px; }

/* Mobile: Spalten-Layout statt horizontaler Row.
   Auf < 360px Inhalts-Breite wuerden die Aside (min-width 100px) und die
   Action-Buttons sonst den Main-Block auf ~76px zusammenquetschen. Stack
   ist lesbarer und Touch-Target-freundlicher.

   Reihenfolge (top → bottom):
     1. Main (Title + Meta)
     2. Progress (optional)
     3. Aside (Amount)
     4. Actions (Edit/Delete), abgesetzt durch Trennlinie */
@media (max-width: 639px) {
  .item-card {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .item-card__main,
  .item-card__progress,
  .item-card__aside,
  .item-card__actions {
    min-width: 0;
    flex: 0 0 auto;
  }

  /* Amount rechtsbuendig in eigener Row — wichtig genug, dass es
     prominent sein soll, aber auf Mobile nicht direkt am Title kleben muss. */
  .item-card__aside {
    text-align: right;
    align-self: stretch;
  }

  /* Actions als Footer rechtsbuendig, mit feiner Trennlinie drueber. */
  .item-card__actions {
    justify-content: flex-end;
    border-top: 1px solid var(--border-subtle);
    padding-top: 8px;
    margin-top: 2px;
  }

  /* Progress full-width in eigener Row, falls vorhanden. */
  .item-card__progress {
    max-width: 100%;
    min-width: 0;
  }
}

.item-card:hover {
  background: var(--bg-card-row-hover);
  border-color: var(--border-row-hover);
}

/* Border-Left-Akzent auf der linken Seite fuer Hervorhebungen */
.item-card--primary {
  border-left: 3px solid var(--accent);
  padding-left: 12px;
}

.item-card--muted {
  border-style: dashed;
  border-color: var(--border-muted);
  background: var(--bg-card-row-muted);
}

.item-card__main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item-card__main :deep(strong),
.item-card__main :deep(.item-card__title) {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text);
  line-height: 1.3;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.item-card__main :deep(.item-card__sub) {
  color: var(--text-muted);
  font-size: 0.78rem;
  line-height: 1.4;
}

.item-card__meta {
  color: var(--text-muted);
  font-size: 0.78rem;
  margin-top: 2px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.item-card__progress {
  flex: 0 0 auto;
  min-width: 100px;
  max-width: 200px;
}

.item-card__aside {
  flex: 0 0 auto;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 0.88rem;
  color: var(--text);
  white-space: nowrap;
  min-width: 100px;
}

.item-card__aside :deep(.amount-secondary) {
  display: block;
  font-weight: 500;
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 2px;
}

.item-card__actions {
  flex: 0 0 auto;
  display: flex;
  gap: 4px;
  align-items: center;
  opacity: 1;
  transition: opacity 0.12s ease;
}

/* Hover-Actions-Variante: Actions per Default versteckt, auf Row-Hhover sichtbar */
.item-card--hover-actions .item-card__actions {
  opacity: 0;
}

.item-card--hover-actions:hover .item-card__actions,
.item-card--hover-actions:focus-within .item-card__actions {
  opacity: 1;
}

/* Touch-Devices haben keinen Hover. Actions sind dort immer sichtbar,
   sonst kann der User die Edit/Delete-Buttons gar nicht erreichen. */
@media (hover: none) {
  .item-card--hover-actions .item-card__actions {
    opacity: 1;
  }
}

.item-card__actions :deep(button) {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
}

@media (max-width: 639px) {
  /* Touch-Target: 44pt auf Mobile, Desktop bleibt 36px fürs visuelle Layout */
  .item-card__actions :deep(button) {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
  }
}

.item-card__actions :deep(button:hover) {
  background: var(--bg-card-button-hover);
  border-color: var(--border-button-hover);
  color: var(--text);
}

.item-card__actions :deep(button.is-danger:hover) {
  color: var(--danger);
  border-color: var(--danger);
}
</style>