<!--
  DashboardHouseholdBanner — der "Aktiver Haushalt"-Banner des Dashboards.

  Zeigt oben auf der Dashboard-Seite (zwischen Header und KPI-Grid)
  den Namen des aktiven Haushalts, die Währung und die Rolle des
  Users im Haushalt. Macht den Haushalts-Kontext direkt sichtbar —
  nicht nur ueber den Header-Switcher.

  Verwendung:
  <DashboardHouseholdBanner :household="activeHousehold" :member-count="N" />
-->
<script setup lang="ts">
defineProps<{
  household: {
    name: string
    currency: string
    role: 'OWNER' | 'MEMBER' | string
  } | null
  /**
   * Optional: Anzahl Mitglieder im Haushalt. Wird dezent rechts
   * angezeigt, wenn vorhanden.
   */
  memberCount?: number | null
}>()
</script>

<template>
  <article v-if="household" class="household-banner">
    <div class="household-banner__icon">
      <i class="pi pi-home" aria-hidden="true" />
    </div>
    <div class="household-banner__main">
      <span class="household-banner__eyebrow">Aktiver Haushalt</span>
      <h2 class="household-banner__name">{{ household.name }}</h2>
    </div>
    <div class="household-banner__meta">
      <span class="household-banner__chip" :title="`Währung des Haushalts: ${household.currency}`">
        <i class="pi pi-wallet" aria-hidden="true" />
        {{ household.currency }}
      </span>
      <RoleTag :role="household.role" />
      <span v-if="memberCount != null" class="household-banner__chip" :title="`${memberCount} Mitglied${memberCount === 1 ? '' : 'er'}`">
        <i class="pi pi-users" aria-hidden="true" />
        {{ memberCount }}
      </span>
    </div>
  </article>
</template>

<style scoped>
.household-banner {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.25rem;
  margin-bottom: 1.25rem;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(139, 92, 246, 0.08));
  border: 1px solid rgba(59, 130, 246, 0.22);
  border-radius: 16px;
  box-shadow: 0 8px 22px rgba(2, 6, 23, 0.18);
}

.household-banner__icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.3rem;
  background: var(--color-accent-primary-soft, rgba(59, 130, 246, 0.16));
  color: var(--color-accent-primary, #3b82f6);
  flex-shrink: 0;
}

.household-banner__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}

.household-banner__eyebrow {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted, #94a3b8);
  line-height: 1;
}

.household-banner__name {
  margin: 0.25rem 0 0;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-text-primary, #f1f5f9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.household-banner__meta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.household-banner__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.18);
  color: var(--color-text-secondary, #cbd5e1);
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
}

.household-banner__chip i {
  font-size: 0.8rem;
  color: var(--color-text-muted, #94a3b8);
}

@media (max-width: 640px) {
  .household-banner {
    flex-wrap: wrap;
  }
  .household-banner__meta {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
