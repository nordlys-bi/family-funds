<!--
  ListTable — kompakte Tabelle für gleichförmige Listen (C-Stil).

  Verwendung:
  <ListTable dense accent="primary">
    <template #head>
      <th>Name</th>
      <th>Datum</th>
      <th class="num">Betrag</th>
      <th></th>
    </template>

    <tr v-for="tx in transactions" :key="tx.id">
      <td class="name">
        Nudeln
        <span class="sub">von Jan</span>
      </td>
      <td class="muted">02.07.2026</td>
      <td class="num">4,50 €</td>
      <td class="actions">
        <button>✎</button>
        <button>🗑</button>
      </td>
    </tr>
  </ListTable>

  Auf Mobile (< 768px) bricht die Tabelle oft — Spalten werden abgeschnitten.
  Dafür kann ein optionaler `#mobile`-Slot definiert werden, der Card-Markup
  enthält. ListTable rendert dann unterhalb 768px die Cards statt der
  Tabelle. Auf Desktop bleibt die Tabelle unverändert sichtbar.

  <ListTable dense accent="primary">
    <template #head>...</template>
    <tr v-for="tx in transactions">...</tr>

    <template #mobile>
      <div v-for="tx in transactions" :key="tx.id" class="data-table__card">
        <strong>{{ tx.description }}</strong>
        <span>{{ formatMoney(tx.amount) }}</span>
      </div>
    </template>
  </ListTable>
-->
<script setup lang="ts">
/**
 * ListTable rendert eine Tabelle mit einheitlichem Header und Body.
 * Spalten werden komplett im Slot definiert — der Wrapper liefert nur
 * Styling + Hover-State + Sonderzeilen-Varianten.
 *
 * Hinweis: Wir nennen die Komponente bewusst NICHT "DataTable", weil
 * PrimeVue bereits einen DataTable global registriert (p-datatable).
 * Würden wir den Namen teilen, würde Nuxt-Auto-Import PrimeVues
 * DataTable auflösen statt unserer Liste-Variante.
 */
defineProps<{
  /** Schmalere Padding-Variante für sehr dichte Listen. */
  dense?: boolean
  /** Erste Spalte links mit Border-Akzent (z. B. Primary-Listen). */
  accent?: 'primary' | 'muted' | null
}>()
</script>

<template>
  <!-- Desktop / Tablet: Tabelle. -->
  <div
    class="data-table-wrapper data-table-wrapper--desktop"
    :class="[`data-table-wrapper--${dense ? 'dense' : 'default'}`, accent ? `accent-${accent}` : '']"
  >
    <table class="data-table">
      <thead v-if="$slots.head" class="data-table__head">
        <tr>
          <slot name="head" />
        </tr>
      </thead>
      <tbody class="data-table__body">
        <slot />
      </tbody>
      <tfoot v-if="$slots.foot" class="data-table__foot">
        <tr>
          <slot name="foot" />
        </tr>
      </tfoot>
    </table>
  </div>

  <!-- Mobile (< 768px): Card-View, nur wenn #mobile-Slot definiert ist. -->
  <div v-if="$slots.mobile" class="data-table-mobile">
    <slot name="mobile" />
  </div>
</template>

<style scoped>
.data-table-wrapper {
  background: var(--bg-card-row);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  overflow: hidden;
}

.data-table-wrapper--dense :deep(td),
.data-table-wrapper--dense :deep(th) {
  padding-top: 8px;
  padding-bottom: 8px;
}

.data-table-wrapper.accent-primary {
  border-left: 3px solid var(--accent);
}

.data-table-wrapper.accent-muted {
  border-style: dashed;
  border-color: var(--border-muted);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  line-height: 1.4;
}

.data-table :deep(th) {
  text-align: left;
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  padding: 12px 14px;
  background: rgba(15, 23, 42, 0.5);
  border-bottom: 1px solid var(--border-subtle);
  white-space: nowrap;
}

.data-table :deep(th.num) {
  text-align: right;
}

.data-table :deep(td) {
  padding: 12px 14px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.06);
  vertical-align: middle;
}

.data-table :deep(tbody tr:last-child td) {
  border-bottom: none;
}

.data-table :deep(tbody tr) {
  transition: background 0.12s ease;
}

.data-table :deep(tbody tr:hover td) {
  background: rgba(96, 165, 250, 0.08);
}

.data-table :deep(td.num) {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  white-space: nowrap;
}

.data-table :deep(td.muted) {
  color: var(--text-muted);
}

.data-table :deep(td.name) {
  font-weight: 600;
  color: var(--text);
}

.data-table :deep(td.name .sub) {
  display: block;
  color: var(--text-muted);
  font-weight: 400;
  font-size: 0.78rem;
  margin-top: 2px;
}

.data-table :deep(td.actions) {
  text-align: right;
  white-space: nowrap;
}

.data-table :deep(td.actions button) {
  width: 26px;
  height: 26px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  margin-left: 4px;
  font-size: 11px;
  transition: background 0.1s, color 0.1s;
}

.data-table :deep(td.actions button:hover) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}

.data-table :deep(td.actions button.is-danger:hover) {
  color: var(--danger);
}

.data-table :deep(.data-table__empty) {
  padding: 32px 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.88rem;
  border-bottom: none;
}

.data-table :deep(.data-table__empty a) {
  color: var(--accent);
  text-decoration: none;
}

/* === Mobile Card-View ====================================================
   Wenn die Page einen #mobile-Slot definiert, rendert ListTable unterhalb
   768px Cards statt der Tabelle. Auf Desktop ist nur die Tabelle sichtbar.
*/
.data-table-wrapper--desktop { display: block; }
.data-table-mobile { display: none; }

@media (max-width: 767px) {
  .data-table-wrapper--desktop { display: none; }
  .data-table-mobile {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
}

/* Styling-Hooks für Cards, die der Mobile-Slot rendert.
   Pages legen ihre Card-Markup frei, hier ist nur Spacing + Border. */
.data-table-mobile :deep(.data-table__card) {
  background: var(--bg-card-row);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.data-table-mobile :deep(.data-table__card:hover) {
  background: var(--bg-card-row-hover);
  border-color: var(--border-row-hover);
}
.data-table-mobile :deep(.data-table__card-line) {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.data-table-mobile :deep(.data-table__card-amount) {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  font-size: 1rem;
  color: var(--text);
}
.data-table-mobile :deep(.data-table__card-meta) {
  font-size: 0.78rem;
  color: var(--text-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: center;
}
.data-table-mobile :deep(.data-table__card-name) {
  font-weight: 600;
  color: var(--text);
  font-size: 0.92rem;
}
.data-table-mobile :deep(.data-table__card-actions) {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 4px;
  border-top: 1px solid var(--border-subtle);
  padding-top: 8px;
}
.data-table-mobile :deep(.data-table__empty) {
  background: var(--bg-card-row);
  border: 1px dashed var(--border-subtle);
  border-radius: 12px;
  padding: 24px 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.88rem;
}
</style>