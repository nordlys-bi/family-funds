<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const { user, logout } = useAppAuth()
const { households, activeHousehold, setActiveHousehold } = useHousehold()
const onboarding = useOnboarding()
const config = useRuntimeConfig()
const isClerkMode = config.public.authMode === 'clerk'

const householdOptions = computed(() =>
  households.value.map((household) => ({
    label: `${household.name} (${household.currency})`,
    value: household.id,
  })),
)

const handleHouseholdChange = (value: string | null) => {
  if (value) {
    setActiveHousehold(value)
  }
}

const handleLogout = async () => {
  await logout()
}

// === Layout-Modus (Mobile+Tablet vs. Desktop) ====================
// Mobile+Tablet (< 1024px): MobileBottomNav statt Sidebar.
// Desktop (>= 1024px): Sidebar als persistente Spalte mit Collapse-Toggle.
// Issue #14: Tablet-Bereich (640-1024px) bekommt Bottom-Nav statt
// Sidebar, weil das Sidebar-Layout auf Tablet-Mid-Size unbenutzt wirkt.
const isCompactLayout = ref(false)
let compactQuery: MediaQueryList | null = null
const isDesktopCollapsed = ref(false)

function syncCompactMode(event: MediaQueryListEvent | MediaQueryList) {
  isCompactLayout.value = event.matches
  if (!event.matches) {
    isDesktopCollapsed.value = false
  }
}

const toggleDesktopSidebar = () => {
  isDesktopCollapsed.value = !isDesktopCollapsed.value
}

// === FAB-Aktionen ================================================
// Mobile-only. Auf Desktop übernimmt der Split-Button im Page-Toolbar.
// Quick-Add (issue #29): "Ausgabe" und "Einnahme" navigieren mit
// ?new=1, die jeweilige Page öffnet den Create-Dialog dann page-lokal
// via useQueryTrigger({ queryKey: 'new', onTrigger: openCreateDialog })
// und putzt die URL sofort wieder. Pattern bleibt page-lokal, kein
// globaler Event-Bus.
//
// "Sparziel" bleibt bewusst Navigation-only: die Savings-Seite hat drei
// verschiedene Dialoge (Sparziel anlegen / History pro Goal / Booking
// pro Goal), es gibt keinen einzelnen primären Create-Flow. Wer ein
// neues Sparziel anlegen will, klickt auf der Savings-Seite den
// Inline-CTA. Quick-Add ueber den FAB wäre hier mehrdeutig.
const fabActions = [
  {
    key: 'expense',
    label: 'Ausgabe',
    icon: 'pi pi-arrow-up-right',
    tone: 'danger',
    onSelect: () => navigateTo({ path: '/transactions/expenses', query: { new: '1' } }),
  },
  {
    key: 'income',
    label: 'Einnahme',
    icon: 'pi pi-arrow-down-left',
    tone: 'success',
    onSelect: () => navigateTo({ path: '/transactions/income', query: { new: '1' } }),
  },
  {
    key: 'savings',
    label: 'Sparziel',
    icon: 'pi pi-star',
    tone: 'accent',
    onSelect: () => navigateTo('/budgeting/savings'),
  },
] as const

onMounted(async () => {
  if (import.meta.client) {
    compactQuery = window.matchMedia('(max-width: 1023px)')
    syncCompactMode(compactQuery)
    compactQuery.addEventListener('change', syncCompactMode)
  }

  // Onboarding-Auto-Trigger (issue #16): Wenn der User eingeloggt ist
  // UND der Haushalt "leer" wirkt (keine Mitglieder/Budgets/Transaktionen)
  // UND der User nicht explizit geskippt hat → Tour starten.
  if (user.value) {
    await onboarding.load()
    if (activeHousehold.value) {
      try {
        const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
        const data = await $fetch<{
          data: { memberCount: number; budgetCount: number; transactionCount: number }
        }>(`/api/households/${activeHousehold.value.id}/activity`, { headers })
        if (onboarding.shouldAutoTrigger(data.data)) {
          onboarding.start()
        }
      } catch {
        // Kein Household-Zugriff (z. B. noch kein aktiver Haushalt gewaehlt)
        // → Onboarding triggert ueber shouldAutoTrigger(null) automatisch.
        if (onboarding.shouldAutoTrigger(null)) {
          onboarding.start()
        }
      }
    } else if (onboarding.shouldAutoTrigger(null)) {
      onboarding.start()
    }
  }
})

watch(
  () => user.value?.id,
  async (newId, oldId) => {
    // Nur beim Login-Transition triggern (id-Wechsel von undefined/other auf Wert).
    if (newId && newId !== oldId) {
      await onboarding.load()
      onboarding.start() // visibility-Check passiert in shouldAutoTrigger
    }
  },
)

// === Onboarding-Tour Step-Completion =================================
// Per Step: persistiere + navigiere zur passenden Seite (falls zutreffend).
const stepNavTargets: Record<string, string | null> = {
  household: null,
  invite: '/households/members',
  budget: '/budgeting/budgets',
  transaction: '/transactions/expenses',
}

async function handleOnboardingCompleteStep(step: 'household' | 'invite' | 'budget' | 'transaction') {
  await onboarding.markComplete(step)
  const target = stepNavTargets[step]
  if (target) {
    onboarding.close()
    await navigateTo(target)
  }
}

onBeforeUnmount(() => {
  compactQuery?.removeEventListener('change', syncCompactMode)
})
</script>

<template>
  <div
    class="layout-wrapper"
    :class="{
      'layout-wrapper--compact': isCompactLayout,
      'layout-wrapper--collapsed': !isCompactLayout && isDesktopCollapsed,
    }"
  >
    <!-- Skip-Link (A11y / WCAG 2.4.1): sichtbar nur bei Tastatur-Fokus,
         springt direkt zum Hauptinhalt. -->
    <a href="#main-content" class="skip-link">Zum Hauptinhalt springen</a>

    <!-- Sidebar (nur Desktop, >= 1024px). Auf Mobile+Tablet ersetzt durch
         <MobileBottomNav /> am Layout-Boden. -->
    <aside v-if="!isCompactLayout" class="sidebar" aria-label="Hauptnavigation">
      <div class="sidebar-header">
        <div class="brand-logo">
          <i class="pi pi-wallet text-primary"></i>
          <span class="brand-name">Family Funds</span>
        </div>
      </div>

      <div class="user-profile">
        <div class="avatar">
          {{ user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'U' }}
        </div>
        <div class="user-details">
          <span class="user-name">{{ user?.displayName || 'Benutzer' }}</span>
          <span class="user-email">{{ user?.email }}</span>
        </div>
      </div>

      <nav class="sidebar-nav">
        <NuxtLink to="/" class="nav-item" active-class="nav-item-active">
          <i class="pi pi-chart-bar nav-icon"></i>
          <span>Dashboard</span>
        </NuxtLink>

        <div class="nav-section-title">Module</div>

        <NuxtLink to="/households" class="nav-item" active-class="nav-item-active">
          <i class="pi pi-users nav-icon"></i>
          <span>Haushalte</span>
        </NuxtLink>

        <NavSection prefix="/budgeting" icon="pi pi-calendar-plus" label="Budgetierung">
          <NuxtLink to="/budgeting/budgets" class="sub-nav-item" active-class="sub-nav-item-active">
            <i class="pi pi-wallet"></i>
            <span>Budgets</span>
          </NuxtLink>
          <NuxtLink to="/budgeting/recurring" class="sub-nav-item" active-class="sub-nav-item-active">
            <i class="pi pi-sync"></i>
            <span>Wiederkehrend</span>
          </NuxtLink>
          <NuxtLink to="/budgeting/savings" class="sub-nav-item" active-class="sub-nav-item-active">
            <i class="pi pi-flag"></i>
            <span>Sparziele</span>
          </NuxtLink>
        </NavSection>

        <NavSection prefix="/transactions" icon="pi pi-list" label="Transaktionen">
          <NuxtLink to="/transactions/expenses" class="sub-nav-item" active-class="sub-nav-item-active">
            <i class="pi pi-arrow-down"></i>
            <span>Ausgaben</span>
          </NuxtLink>
          <NuxtLink to="/transactions/income" class="sub-nav-item" active-class="sub-nav-item-active">
            <i class="pi pi-arrow-up"></i>
            <span>Einnahmen</span>
          </NuxtLink>
        </NavSection>
      </nav>

      <div class="sidebar-footer">
        <div v-if="isClerkMode" class="clerk-user-button">
          <UserButton :show-name="true" />
        </div>
        <Button
          v-else
          label="Abmelden"
          icon="pi pi-power-off"
          severity="secondary"
          outlined
          class="logout-btn"
          @click="handleLogout"
        />
      </div>
    </aside>

    <!-- Main Content Area -->
    <div class="main-container">
      <!-- Top Header -->
      <header class="header">
        <div class="header-left">
          <!-- Desktop: Sidebar ein-/ausklappen (Mobile/Tablet: versteckt via @media) -->
          <Button
            v-show="!isCompactLayout"
            class="toggle-btn"
            :icon="isDesktopCollapsed ? 'pi pi-bars' : 'pi pi-align-left'"
            severity="secondary"
            text
            rounded
            :aria-label="isDesktopCollapsed ? 'Sidebar einblenden' : 'Sidebar ausblenden'"
            @click="toggleDesktopSidebar"
          />

          <!-- Household Switcher in Header -->
          <div
            v-if="households.length > 0"
            class="household-switcher"
            :title="activeHousehold ? `${activeHousehold.name} (${activeHousehold.currency})` : undefined"
          >
            <i class="pi pi-home switcher-icon"></i>
            <Select
              :modelValue="activeHousehold?.id ?? null"
              :options="householdOptions"
              optionLabel="label"
              optionValue="value"
              class="switcher-select"
              @update:modelValue="handleHouseholdChange"
            />
          </div>
        </div>

        <div class="header-right">
          <!-- Mock-Mode-Badge: nur sichtbar, solange Clerk-Keys nicht gesetzt sind.
               In Production (Clerk-Mode) für End-User ausgeblendet — der Hinweis
               ist ein Dev-Marker und gehört nicht in die User-Facing-UI. -->
          <span v-if="!isClerkMode" class="env-tag">Sandbox Mode</span>
          <div v-if="isClerkMode" class="header-user-button">
            <UserButton />
          </div>
        </div>
      </header>

      <!-- Page Content -->
      <main id="main-content" tabindex="-1" class="content">
        <slot />
      </main>
    </div>

    <!-- Mobile Bottom-Nav (Mobile+Tablet, < 1024px). Versteckt sich selbst
         via @media auf Desktop. Logout lebt jetzt hier, im Mehr-Bottom-Sheet. -->
    <MobileBottomNav />

    <!-- FAB Speed-Dial (Mobile-only, @media versteckt sich selbst auf Desktop) -->
    <FabSpeedDial :actions="fabActions" />

    <!-- Onboarding-Tour (issue #16): 4-Step-Modal, auto-getriggert fuer
         neue User mit leerem Haushalt. Persistiert pro User, ueberlebt
         Reloads. -->
    <OnboardingTour
      :active="onboarding.isActive.value"
      :completed-steps="onboarding.completedSteps.value"
      :progress="onboarding.progress.value"
      @complete-step="handleOnboardingCompleteStep"
      @skip="onboarding.skipTour"
      @close="onboarding.close"
    />
  </div>
</template>

<style scoped>
.layout-wrapper {
  display: flex;
  min-height: 100vh;
  background-color: #0b0f19;
  color: #f1f5f9;
  font-family: var(--font-family, 'Inter', sans-serif);
}

/* === Sidebar Desktop-Layout === */
.sidebar {
  width: 260px;
  background: #111827;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 200;
}

.layout-wrapper--collapsed .sidebar {
  width: 0;
  overflow: hidden;
  border-right: none;
}

/* === Mobile+Tablet Layout (< 1024px): Sidebar ausgeblendet, Bottom-Nav
   übernimmt die Hauptnavigation. Volle Breite für main-container. === */
.layout-wrapper--compact {
  /* Sidebar-Spalte existiert nicht — main-container dehnt sich aus. */
}

.layout-wrapper--compact .sidebar {
  display: none;
}

.layout-wrapper--compact .toggle-btn {
  display: none;
}

/* === Sidebar intern === */
.sidebar-header {
  padding: 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.brand-logo {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand-logo i {
  font-size: 1.5rem;
  color: #3b82f6;
}

.brand-name {
  font-weight: 800;
  font-size: 1.15rem;
  letter-spacing: -0.025em;
  background: linear-gradient(to right, #3b82f6, #8b5cf6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  white-space: nowrap;
}

.user-profile {
  padding: 1.25rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  overflow: hidden;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6 0%, #a855f7 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
  box-shadow: 0 4px 10px rgba(59, 130, 246, 0.2);
}

.user-details {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.user-name {
  font-weight: 600;
  font-size: 0.9rem;
  color: #f1f5f9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-email {
  font-size: 0.75rem;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-nav {
  padding: 1.5rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex-grow: 1;
  overflow-y: auto;
}

.nav-section-title {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #4b5563;
  margin-top: 1rem;
  margin-bottom: 0.25rem;
  padding-left: 0.75rem;
  letter-spacing: 0.05em;
}

.nav-item,
.sub-nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0.75rem;
  border-radius: 10px;
  color: #94a3b8;
  text-decoration: none;
  font-weight: 500;
  font-size: 0.95rem;
  transition: all 0.2s;
  cursor: pointer;
  /* Touch-Target: mindestens 44pt hoch */
  min-height: var(--touch-target-min);
}

.nav-item:hover:not(.nav-item-disabled),
.sub-nav-item:hover {
  background: rgba(255, 255, 255, 0.03);
  color: #f1f5f9;
}

.nav-item-active {
  background: rgba(59, 130, 246, 0.1) !important;
  color: #3b82f6 !important;
  font-weight: 600;
}

.nav-icon {
  font-size: 1.1rem;
  flex-shrink: 0;
}

.nav-item-disabled {
  opacity: 0.4;
  cursor: not-allowed;
  position: relative;
}

.sidebar-footer {
  padding: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.clerk-user-button {
  display: flex;
  justify-content: center;
}

.logout-btn {
  width: 100%;
}

/* === Main Container === */
.main-container {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-width: 0;
}

/* === Header === */
.header {
  height: 64px;
  background: #111827;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.5rem;
  z-index: 100;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.toggle-btn,
.hamburger-btn {
  width: 2.75rem;
  height: 2.75rem;
}

.household-switcher {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 0.4rem 0.75rem;
  color: #f1f5f9;
}

.switcher-icon {
  color: #3b82f6;
  font-size: 0.95rem;
}

.switcher-select {
  min-width: 240px;
}

:deep(.switcher-select.p-select) {
  background: transparent;
  border: none;
}

:deep(.switcher-select .p-select-label) {
  color: #f8fafc;
  font-weight: 600;
  /* Lange Haushaltsnamen auf Mobile sauber mit Ellipsis kürzen statt
     umzubrechen oder den Layout-Container zu sprengen. title-Attribut
     kommt via Tooltip auf der .household-switcher, sodass der volle
     Name bei Long-Press / Hover sichtbar bleibt. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

:deep(.switcher-select .p-select-dropdown) {
  color: #f8fafc;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.header-user-button {
  display: flex;
  align-items: center;
}

.env-tag {
  font-size: 0.75rem;
  font-weight: 700;
  background: rgba(168, 85, 247, 0.15);
  color: #c084fc;
  padding: 0.3rem 0.6rem;
  border-radius: 6px;
  border: 1px solid rgba(168, 85, 247, 0.2);
  white-space: nowrap;
}

/* === Content === */
.content {
  flex-grow: 1;
  padding: 2rem;
  overflow-y: auto;
  background-color: #0b0f19;
}

/* === Mobile+Tablet: Header- & Content-Anpassung === */
@media (max-width: 1023px) {
  .header {
    padding: 0 1rem;
  }
  .content {
    padding: 1rem;
    /* Platz für FAB (5.5rem Offset + 3.5rem Hoehe = 9rem) + Bottom-Nav
       (~4.75rem) + Safe-Area-Inset. Issue #31 hat den FAB nach oben
       gesetzt, daher muss der Scroll-Bereich hier nachziehen, sonst
       scrollt der letzte Content unter den FAB. */
    padding-bottom: calc(9.5rem + env(safe-area-inset-bottom, 0px));
  }
  .switcher-select {
    min-width: 0;
    max-width: 180px;
  }
}
</style>
