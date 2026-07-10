<!--
  MobileBottomNav — primäre Navigation auf Mobile und Tablet (< 1024px).

  Vier primäre Items (Dashboard, Buchungen, Budgets, Sparziele) +
  "Mehr"-Aktion, die ein Bottom-Sheet mit den sekundären Items öffnet
  (Haushalte, Mitglieder, Wiederkehrend, Einstellungen, Abmelden).
  Active-State wird route-basiert über `route.path.startsWith`
  ermittelt — Items können ein eigenes `matchPrefix` haben, falls die
  exakte Route zu eng ist (z. B. /transactions soll auch fuer
  /transactions/expenses active sein).

  Verwendet das Design-System:
  - PrimeIcons via <i class="pi ..."> + Label
  - Akzentfarbe aus dem globalen Theme
  - Safe-Area-Insets fuer iPhone-Notch (padding-bottom + env())

  Verwendung:
  <MobileBottomNav />
  (Komponente erkennt ihre Sichtbarkeit selbst via @media im <style>.)

  Issue #30: Primär-Stack ist jetzt auf den täglichen Job ausgerichtet
  (Erfassen, Budgets, Sparziele). Admin/Setup-Themen (Haushalte,
  Mitglieder, Einstellungen) wandern in das "Mehr"-Sheet. Logout
  wandert aus dem Sheet-Footer in die Liste als destructive Item —
  einheitliche Optik mit den anderen sekundären Aktionen.
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from '#app'

const route = useRoute()
const router = useRouter()
const { logout } = useAppAuth()

// === Primäre Items ====================================================
// 4 Slots + Mehr. "Buchungen" linkt auf /transactions/expenses als
// Default-Ziel, markiert aber den ganzen /transactions/-Bereich als
// active. "Budgets" markiert /budgeting/* komplett (budgets, recurring,
// savings sind alle "Budgetierung"). Wer eine "Buchung anlegen" will,
// nutzt den FAB Speed-Dial (extra Komponente, nicht teil dieser Nav).
type NavItem = {
  key: string
  label: string
  icon: string
  /** Route, auf die navigiert wird. */
  to: string
  /** Prefix, gegen den fuer active-State geprueft wird (default = `to`). */
  matchPrefix?: string
}

const primaryItems: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'pi pi-home', to: '/' },
  {
    key: 'transactions',
    label: 'Buchungen',
    icon: 'pi pi-list',
    to: '/transactions/expenses',
    matchPrefix: '/transactions',
  },
  {
    key: 'budgets',
    label: 'Budgets',
    icon: 'pi pi-wallet',
    to: '/budgeting/budgets',
    matchPrefix: '/budgeting',
  },
  { key: 'savings', label: 'Sparziele', icon: 'pi pi-star', to: '/budgeting/savings' },
]

// === Sekundäre Items (Mehr-Bottom-Sheet) ==============================
type SecondaryItem = {
  key: string
  label: string
  icon: string
  to?: string
  onClick?: () => void | Promise<void>
  /** Visuell als destruktive Aktion kennzeichnen (z. B. Logout). */
  destructive?: boolean
}

const moreSheetOpen = ref(false)

const closeMore = () => { moreSheetOpen.value = false }

const navigateAndClose = (to: string) => {
  closeMore()
  router.push(to)
}

const secondaryItems: SecondaryItem[] = [
  { key: 'households', label: 'Haushalte', icon: 'pi pi-users', to: '/households' },
  { key: 'members', label: 'Mitglieder', icon: 'pi pi-user-plus', to: '/households/members' },
  { key: 'recurring', label: 'Wiederkehrend', icon: 'pi pi-sync', to: '/budgeting/recurring' },
  { key: 'settings', label: 'Einstellungen', icon: 'pi pi-cog', to: '/households/settings' },
  { key: 'logout', label: 'Abmelden', icon: 'pi pi-power-off', onClick: handleLogout, destructive: true },
]

async function handleLogout() {
  closeMore()
  await logout()
}

// === Active-State =====================================================
function isItemActive(item: NavItem): boolean {
  const prefix = item.matchPrefix ?? item.to
  if (prefix === '/') return route.path === '/'
  return route.path === prefix || route.path.startsWith(`${prefix}/`)
}

const activeKey = computed(() => {
  const found = primaryItems.find(isItemActive)
  return found?.key ?? null
})

// Bottom-Sheet-Sichtbarkeit: "Mehr" gilt als active, wenn der
// secondary-Pfad matched UND kein primary-Item active ist.
const isMoreActive = computed(() => {
  if (activeKey.value) return false
  return secondaryItems.some((item) => item.to && route.path.startsWith(item.to))
})
</script>

<template>
  <nav class="mobile-bottom-nav" aria-label="Hauptnavigation (Mobile)">
    <NuxtLink
      v-for="item in primaryItems"
      :key="item.key"
      :to="item.to"
      :class="['mobile-bottom-nav__item', { 'mobile-bottom-nav__item--active': isItemActive(item) }]"
      :aria-current="isItemActive(item) ? 'page' : undefined"
    >
      <i :class="item.icon" aria-hidden="true" />
      <span>{{ item.label }}</span>
    </NuxtLink>

    <button
      type="button"
      :class="['mobile-bottom-nav__item', 'mobile-bottom-nav__item--more', { 'mobile-bottom-nav__item--active': isMoreActive }]"
      :aria-expanded="moreSheetOpen"
      aria-haspopup="dialog"
      aria-label="Weitere Aktionen"
      @click="moreSheetOpen = true"
    >
      <i class="pi pi-th-large" aria-hidden="true" />
      <span>Mehr</span>
    </button>
  </nav>

  <BottomSheet
    :visible="moreSheetOpen"
    title="Mehr"
    max-width="24rem"
    @update:visible="(value) => (moreSheetOpen = value)"
  >
    <div class="more-list">
      <button
        v-for="item in secondaryItems"
        :key="item.key"
        type="button"
        :class="[
          'more-list__item',
          { 'more-list__item--active': item.to && route.path.startsWith(item.to) },
          { 'more-list__item--destructive': item.destructive },
        ]"
        @click="item.to ? navigateAndClose(item.to) : item.onClick?.()"
      >
        <i :class="item.icon" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </button>
    </div>
  </BottomSheet>
</template>

<style scoped>
.mobile-bottom-nav {
  display: none;
}

@media (max-width: 1023px) {
  .mobile-bottom-nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 100;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    background: rgba(15, 23, 42, 0.96);
    backdrop-filter: blur(12px);
    border-top: 1px solid rgba(148, 163, 184, 0.18);
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.32);
    /* iPhone-Notch: Bottom-Inset für Home-Indicator */
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
}

.mobile-bottom-nav__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 10px 4px;
  min-height: 56px;
  color: #94a3b8;
  text-decoration: none;
  font-size: 0.7rem;
  font-weight: 600;
  background: transparent;
  border: none;
  cursor: pointer;
  position: relative;
  /* Touch-Target: mindestens 44pt */
  min-width: 44px;
  transition: color 0.15s;
}

.mobile-bottom-nav__item i {
  font-size: 1.25rem;
  line-height: 1;
}

.mobile-bottom-nav__item:hover {
  color: #e2e8f0;
}

.mobile-bottom-nav__item--active {
  color: #60a5fa;
}

/* Oberer Akzent-Indikator fuer das active Item. */
.mobile-bottom-nav__item--active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 32px;
  height: 3px;
  border-radius: 0 0 3px 3px;
  background: linear-gradient(135deg, #2563eb, #60a5fa);
}

.mobile-bottom-nav__item--more {
  /* Buttons haben default-Border, der weicht von <a> ab. */
  font-family: inherit;
}

/* === Mehr-Bottom-Sheet-Inhalt === */
.more-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.more-list__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(148, 163, 184, 0.12);
  color: #f1f5f9;
  font-size: 0.95rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  /* Touch-Target: mindestens 44pt */
  min-height: 44px;
  transition: background 0.15s;
}

.more-list__item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.more-list__item--active {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.32);
  color: #93c5fd;
}

/* Destructive Aktionen (z. B. Abmelden): rot getönt, aber nicht
   aufdringlich — die Optik soll klar machen "Vorsicht", nicht
   "Panik-Button". Active-Hover verstärkt den Rotton. */
.more-list__item--destructive {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.18);
}

.more-list__item--destructive:hover {
  background: rgba(248, 113, 113, 0.08);
  color: #fecaca;
}

.more-list__item--destructive i {
  color: #f87171;
}

.more-list__item i {
  font-size: 1.1rem;
  color: #60a5fa;
  flex-shrink: 0;
}
</style>
