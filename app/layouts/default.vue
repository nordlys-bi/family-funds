<script setup lang="ts">
import { computed, ref } from 'vue'

const { user, logout } = useAppAuth()
const { households, activeHousehold, setActiveHousehold } = useHousehold()
const config = useRuntimeConfig()
const isClerkMode = config.public.authMode === 'clerk'

const isSidebarOpen = ref(true)
const householdOptions = computed(() =>
  households.value.map((household) => ({
    label: `${household.name} (${household.currency})`,
    value: household.id,
  })),
)

const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value
}

const handleHouseholdChange = (value: string | null) => {
  if (value) {
    setActiveHousehold(value)
  }
}

const handleLogout = async () => {
  await logout()
}
</script>

<template>
  <div class="layout-wrapper">
    <!-- Sidebar -->
    <aside class="sidebar" :class="{ 'sidebar-collapsed': !isSidebarOpen }">
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
          <Badge>M3</Badge>
        </NuxtLink>

        <NavSection prefix="/budgeting" icon="pi pi-calendar-plus" label="Budgetierung" badge="M4">
          <NuxtLink to="/budgeting/budgets" class="sub-nav-item" active-class="sub-nav-item-active">
            <i class="pi pi-wallet"></i>
            <span>Budgets</span>
          </NuxtLink>
          <NuxtLink to="/budgeting/recurring" class="sub-nav-item" active-class="sub-nav-item-active">
            <i class="pi pi-sync"></i>
            <span>Recurring</span>
          </NuxtLink>
          <NuxtLink to="/budgeting/savings" class="sub-nav-item" active-class="sub-nav-item-active">
            <i class="pi pi-flag"></i>
            <span>Savings</span>
          </NuxtLink>
        </NavSection>

        <NavSection prefix="/transactions" icon="pi pi-list" label="Transaktionen" badge="M5">
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
          <Button
            class="toggle-btn"
            :icon="isSidebarOpen ? 'pi pi-align-left' : 'pi pi-bars'"
            severity="secondary"
            text
            rounded
            aria-label="Sidebar umschalten"
            @click="toggleSidebar"
          />
          
          <!-- Household Switcher in Header -->
          <div v-if="households.length > 0" class="household-switcher">
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
          <span class="env-tag">{{ isClerkMode ? 'Clerk Mode' : 'Sandbox Mode' }}</span>
          <div v-if="isClerkMode" class="header-user-button">
            <UserButton />
          </div>
        </div>
      </header>

      <!-- Page Content -->
      <main class="content">
        <slot />
      </main>
    </div>
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

/* Sidebar Styles */
.sidebar {
  width: 260px;
  background: #111827;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 100;
}

.sidebar-collapsed {
  width: 0;
  overflow: hidden;
  border-right: none;
}

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

.nav-item {
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
}

.nav-item:hover:not(.nav-item-disabled) {
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

/* Main Container Styles */
.main-container {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-width: 0;
}

/* Header Styles */
.header {
  height: 64px;
  background: #111827;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.5rem;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.toggle-btn {
  width: 2.5rem;
  height: 2.5rem;
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
}

/* Content Area */
.content {
  flex-grow: 1;
  padding: 2rem;
  overflow-y: auto;
  background-color: #0b0f19;
}

/* Responsive styles */
@media (max-width: 768px) {
  .sidebar {
    position: absolute;
    height: 100vh;
  }
  .sidebar-collapsed {
    width: 0;
  }
}
</style>
