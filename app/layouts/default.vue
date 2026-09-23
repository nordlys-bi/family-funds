<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isTransactionsPath } from '~/utils/transaction-nav'

const route = useRoute()
const { user, logout } = useAppAuth()
const { households, activeHousehold, canManageHousehold, setActiveHousehold } = useHousehold()
const onboarding = useOnboarding()
const quickCapture = useQuickCapture()
const config = useRuntimeConfig()
const isClerkMode = config.public.authMode === 'clerk'

// Issue #91: globales Erfassen von jeder Seite aus. Nur moeglich, wenn
// ein aktiver Haushalt gewaehlt ist (sonst fehlt das POST-Ziel).
const canQuickCapture = computed(() => Boolean(activeHousehold.value))
const openQuickCapture = (kind: 'expense' | 'income' = 'expense') => {
  if (!canQuickCapture.value) return
  quickCapture.open(kind)
}

// Tastenkuerzel "e" (Desktop): neue Ausgabe erfassen. Der Helper feuert
// nur bei physischer Tastatur und ignoriert Eingabefelder.
useDesktopShortcut('e', () => openQuickCapture('expense'))

const householdOptions = computed(() =>
  households.value.map((household) => ({
    label: `${household.name} (${household.currency})`,
    value: household.id,
  })),
)

// Issue #94: Der Haushaltswechsler belegt den prominentesten Slot im
// Header. Fuer die grosse Mehrheit mit genau EINEM Haushalt ist das
// breite <Select> ohne Funktion — dann zeigen wir nur ein statisches
// Label. Das Dropdown erscheint erst ab zwei Haushalten.
const hasMultipleHouseholds = computed(() => households.value.length > 1)

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

// Issue #128: Die Tour richtet einen Haushalt ein (Haushalt benennen, Mitglied
// einladen, erstes Budget anlegen) — das sind Owner-Aktionen, die MEMBERn
// serverseitig verwehrt sind. Also startet sie nur fuer Owner. Ohne aktiven
// Haushalt bleibt sie an: dort legt der User gerade seinen ersten Haushalt an
// und wird dessen Owner.
const canStartOnboarding = computed(() => !activeHousehold.value || canManageHousehold.value)

onMounted(async () => {
  if (import.meta.client) {
    compactQuery = window.matchMedia('(max-width: 1023px)')
    syncCompactMode(compactQuery)
    compactQuery.addEventListener('change', syncCompactMode)
  }

  // Onboarding-Auto-Trigger (issue #16): Wenn der User eingeloggt ist
  // UND der Haushalt "leer" wirkt (keine Mitglieder/Budgets/Transaktionen)
  // UND der User nicht explizit geskippt hat → Tour starten.
  if (user.value && canStartOnboarding.value) {
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
    if (newId && newId !== oldId && canStartOnboarding.value) {
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
        </div>
      </div>

      <!-- Issue #93: flache, frequenzsortierte Navigation analog
           <MobileBottomNav />. Alltags-Module oben in der Reihenfolge, in der
           sie tatsaechlich genutzt werden; Haushalts-Setup als entwertete
           "Verwaltung"-Gruppe unten. Keine <NavSection>-Verschachtelung mehr —
           bei sechs flachen Items bringt die Ebene keinen Gewinn. -->
      <nav class="sidebar-nav">
        <NuxtLink to="/" class="nav-item" active-class="nav-item-active">
          <i class="pi pi-chart-bar nav-icon"></i>
          <span>Dashboard</span>
        </NuxtLink>
        <!-- Issue #101: Ausgaben und Einnahmen sind EIN Bereich "Buchungen"
             (Segment-Control auf den Seiten). Aktiv-Zustand manuell, weil
             active-class von NuxtLink auf /transactions/income sonst nicht
             greift (Ziel ist /transactions/expenses). -->
        <NuxtLink
          to="/transactions/expenses"
          class="nav-item"
          :class="{ 'nav-item-active': isTransactionsPath(route.path) }"
          :aria-current="isTransactionsPath(route.path) ? 'page' : undefined"
        >
          <i class="pi pi-list nav-icon"></i>
          <span>Buchungen</span>
        </NuxtLink>
        <NuxtLink to="/budgeting/budgets" class="nav-item" active-class="nav-item-active">
          <i class="pi pi-wallet nav-icon"></i>
          <span>Budgets</span>
        </NuxtLink>
        <NuxtLink to="/budgeting/savings" class="nav-item" active-class="nav-item-active">
          <i class="pi pi-star nav-icon"></i>
          <span>Sparziele</span>
        </NuxtLink>
        <NuxtLink to="/budgeting/recurring" class="nav-item" active-class="nav-item-active">
          <i class="pi pi-sync nav-icon"></i>
          <span>Wiederkehrend</span>
        </NuxtLink>

        <div class="nav-divider" role="separator"></div>
        <div class="nav-section-title">Verwaltung</div>

        <!-- exact-active-class statt active-class: sonst leuchtet "Haushalt"
             auch auf /households/members und /households/settings mit. -->
        <NuxtLink to="/households" class="nav-item nav-item--muted" exact-active-class="nav-item-active">
          <i class="pi pi-users nav-icon"></i>
          <span>Haushalt</span>
        </NuxtLink>
        <NuxtLink to="/households/members" class="nav-item nav-item--muted" active-class="nav-item-active">
          <i class="pi pi-user-plus nav-icon"></i>
          <span>Mitglieder</span>
        </NuxtLink>
        <NuxtLink to="/households/settings" class="nav-item nav-item--muted" active-class="nav-item-active">
          <i class="pi pi-cog nav-icon"></i>
          <span>Einstellungen</span>
        </NuxtLink>
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

          <!-- Household Switcher in Header. Issue #94: <Select> nur bei
               mehreren Haushalten, sonst statisches Label. -->
          <div
            v-if="households.length > 0"
            class="household-switcher"
            :class="{ 'household-switcher--static': !hasMultipleHouseholds }"
            :title="activeHousehold ? `${activeHousehold.name} (${activeHousehold.currency})` : undefined"
          >
            <i class="pi pi-home switcher-icon"></i>
            <Select
              v-if="hasMultipleHouseholds"
              :modelValue="activeHousehold?.id ?? null"
              :options="householdOptions"
              optionLabel="label"
              optionValue="value"
              class="switcher-select"
              @update:modelValue="handleHouseholdChange"
            />
            <span v-else class="switcher-static">
              <span class="switcher-static__name">{{ activeHousehold?.name ?? '' }}</span>
              <span v-if="activeHousehold" class="switcher-static__currency">{{ activeHousehold.currency }}</span>
            </span>
          </div>
        </div>

        <div class="header-right">
          <!-- Issue #91: globales Erfassen, auf allen Viewport-Groessen
               sichtbar (der FAB Speed-Dial, der das auf Mobile mal
               uebernommen hat, ist wieder ausgebaut). Tastenkuerzel "e"
               macht dasselbe auf Desktop. -->
          <Button
            v-if="canQuickCapture"
            class="header-capture-btn"
            label="Erfassen"
            icon="pi pi-plus"
            severity="success"
            @click="openQuickCapture('expense')"
          />
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

    <!-- Globaler Toast-Container (issue #58). Wird vom PrimeVue ToastService
         befüllt, den useUndoableDelete (und spaeter andere Actions) nutzen.
         position="top-right" haelt den Toast ausserhalb der Bottom-Nav
         (Mobile) und der Sidebar (Desktop). -->
    <Toast position="top-right" />
  </div>
</template>

<style scoped>
.layout-wrapper {
  display: flex;
  min-height: 100vh;
  background-color: var(--color-bg-page);
  color: var(--color-text-primary);
  font-family: var(--font-family, 'Inter', sans-serif);
}

/* === Sidebar Desktop-Layout === */
.sidebar {
  width: 260px;
  background: var(--color-bg-panel);
  border-right: 1px solid var(--color-border-subtle);
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
  border-bottom: 1px solid var(--color-border-subtle);
}

.brand-logo {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand-logo i {
  font-size: 1.5rem;
  color: var(--color-accent-primary);
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
  border-bottom: 1px solid var(--color-border-subtle);
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
  color: var(--color-text-primary);
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
  color: var(--color-text-subtle);
  margin-top: 0.35rem;
  margin-bottom: 0.25rem;
  padding-left: 0.75rem;
  letter-spacing: 0.05em;
}

/* Issue #93: Trenner zwischen Alltags-Modulen und der "Verwaltung"-Gruppe. */
.nav-divider {
  height: 1px;
  background: var(--color-overlay-hover);
  margin: 1rem 0.75rem 0;
}

/* Issue #93: Haushalts-Setup ist selten genutzt — visuell zuruecknehmen,
   ohne es zu verstecken. Der Active-State (blau) sticht weiterhin durch. */
.nav-item--muted {
  color: var(--color-text-subtle);
}

.nav-item--muted .nav-icon {
  opacity: 0.75;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0.75rem;
  border-radius: 10px;
  color: var(--color-text-muted);
  text-decoration: none;
  font-weight: 500;
  font-size: 0.95rem;
  transition: all 0.2s;
  cursor: pointer;
  /* Touch-Target: mindestens 44pt hoch */
  min-height: var(--touch-target-min);
}

.nav-item:hover:not(.nav-item-disabled) {
  background: var(--color-overlay-subtle);
  color: var(--color-text-primary);
}

.nav-item-active {
  background: var(--color-accent-primary-soft) !important;
  color: var(--color-accent-primary) !important;
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
  border-top: 1px solid var(--color-border-subtle);
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
  background: var(--color-bg-panel);
  border-bottom: 1px solid var(--color-border-subtle);
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
  background: var(--color-overlay-subtle);
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  padding: 0.4rem 0.75rem;
  color: var(--color-text-primary);
}

.switcher-icon {
  color: var(--color-accent-primary);
  font-size: 0.95rem;
}

.switcher-select {
  min-width: 240px;
}

/* Issue #94: Statik-Variante (genau ein Haushalt) — kein Dropdown-Chrome,
   nur Icon + Name + Waehrung. Ruhiger und gibt Header-Platz frei. */
.household-switcher--static {
  background: transparent;
  border-color: transparent;
  padding-left: 0.25rem;
}

.switcher-static {
  display: inline-flex;
  align-items: baseline;
  gap: 0.45rem;
  min-width: 0;
}

.switcher-static__name {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}

.switcher-static__currency {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--color-text-muted);
}

:deep(.switcher-select.p-select) {
  background: transparent;
  border: none;
}

:deep(.switcher-select .p-select-label) {
  color: var(--color-text-primary);
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
  color: var(--color-text-primary);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.header-capture-btn {
  flex-shrink: 0;
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
  background-color: var(--color-bg-page);
}

/* === Mobile+Tablet: Header- & Content-Anpassung === */
@media (max-width: 1023px) {
  .header {
    padding: 0 1rem;
  }
  .content {
    padding: 1rem;
    /* Platz fuer die fixed Bottom-Nav (~4.75rem), damit der letzte
       Content nicht darunter verschwindet. */
    padding-bottom: calc(4.75rem + env(safe-area-inset-bottom, 0px));
  }
  .switcher-select {
    min-width: 0;
    max-width: 180px;
  }
  .switcher-static__name {
    max-width: 46vw;
  }
}
</style>
