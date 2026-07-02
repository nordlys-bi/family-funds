<!--
  NavSection — hierarchische Sidebar-Section mit Header + eingerückten
  Sub-Links. Wird im Sidebar-Layout (default.vue) verwendet, um
  "Budgetierung" und "Transaktionen" als expandable Module darzustellen.

  Active-State-Logik:
  - Der Section-Header ist hervorgehoben (active), wenn der aktuelle
    Pfad mit `prefix` anfängt (z. B. /budgeting/budgets aktiviert
    die "Budgetierung"-Section).
  - Innerhalb der Section entscheidet jeder Sub-Link (NuxtLink) selbst
    ueber seinen Active-Class (active-class="sub-nav-item-active").

  Slots:
  - default: Section-Content (typischerweise <NuxtLink>-Items).
  - header: Override fuer den Default-Header (Icon + Label + Badge).

  Props:
  - prefix: Pfad-Prefix, das die Section als "active" markiert
    (z. B. "/budgeting"). Wird mit useRoute().path.startsWith(prefix) geprueft.
  - icon: PrimeIcon-Klasse fuer den Section-Header (z. B. "pi pi-calendar-plus").
  - label: Text-Label fuer den Section-Header.
  - badge: Optionaler Text rechts im Header (z. B. "M4").
-->
<script setup lang="ts">
const props = defineProps<{
  prefix: string
  icon: string
  label: string
  badge?: string
}>()

const route = useRoute()
const isActive = computed(() => route.path.startsWith(props.prefix))
</script>

<template>
  <div class="nav-section" :class="{ 'nav-section-active': isActive }">
    <div v-if="$slots.header" class="nav-section__header">
      <slot name="header" :active="isActive" />
    </div>
    <div v-else class="nav-section__header nav-section__header--default">
      <i :class="icon" class="nav-icon" />
      <span>{{ label }}</span>
      <span v-if="badge" class="nav-section__badge">{{ badge }}</span>
    </div>

    <div v-if="$slots.default" class="nav-section__items" :class="{ 'nav-section__items--active': isActive }">
      <slot :active="isActive" />
    </div>
  </div>
</template>

<style scoped>
.nav-section {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

/* Header — flacher Link-Style fuer den Section-Titel, der nicht selbst
   anklickbar ist, aber als Visitenkarte der Section dient. */
.nav-section__header,
.nav-section__header--default {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border-radius: 10px;
  color: #94a3b8;
  font-weight: 500;
  font-size: 0.95rem;
  user-select: none;
}

.nav-section__header--default {
  cursor: default;
}

.nav-section__badge {
  margin-left: auto;
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.2rem 0.4rem;
  border-radius: var(--radius-sm);
  background: var(--color-bg-input);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border-subtle);
}

/* Active-State: wenn irgendeine Sub-Route unter `prefix` aktiv ist. */
.nav-section-active .nav-section__header,
.nav-section__header--default.nav-section-active {
  background: rgba(59, 130, 246, 0.08);
  color: #3b82f6;
  font-weight: 600;
}

/* Sub-Items: eingerueckt, schmaler, transparenter. */
.nav-section__items {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding-left: 1.5rem;
  margin-left: 0.75rem;
  border-left: 1px solid rgba(148, 163, 184, 0.12);
}

.nav-section__items--active {
  border-left-color: rgba(59, 130, 246, 0.32);
}

.nav-section__items :deep(.sub-nav-item) {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  color: #94a3b8;
  text-decoration: none;
  font-weight: 500;
  font-size: 0.88rem;
  transition: background 0.15s ease, color 0.15s ease;
}

.nav-section__items :deep(.sub-nav-item:hover) {
  background: rgba(255, 255, 255, 0.03);
  color: #f1f5f9;
}

.nav-section__items :deep(.sub-nav-item-active) {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
  font-weight: 600;
}
</style>