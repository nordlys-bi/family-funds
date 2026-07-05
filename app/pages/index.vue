<script setup lang="ts">
const { user } = useAppAuth()
const { activeHousehold } = useHousehold()
</script>

<template>
  <div class="dashboard-page">
    <div class="welcome-header mb-6">
      <h1 class="welcome-title">Hallo, {{ user?.displayName || 'Gast' }}! 👋</h1>
      <p class="welcome-subtitle">Willkommen zurück. Hier ist die finanzielle Übersicht für deinen ausgewählten Haushalt.</p>
    </div>

    <!-- Active Household Context Banner -->
    <div v-if="activeHousehold" class="context-banner mb-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <div class="flex items-center gap-3">
          <div class="icon-badge">
            <i class="pi pi-home"></i>
          </div>
          <div>
            <h3 class="font-bold text-lg m-0">{{ activeHousehold.name }}</h3>
            <p class="text-sm m-0 text-slate-400">
              Währung: <strong>{{ activeHousehold.currency }}</strong> &middot; 
              Deine Rolle: 
              <RoleTag :role="activeHousehold.role" />
            </p>
          </div>
        </div>
        <Tag value="Aktiv" severity="success" rounded />
      </div>
    </div>

    <!-- Quick Stats Grid (Mock values for visual design) -->
    <div class="stats-grid mb-8">
      <Card class="stat-card">
        <template #content>
          <div class="flex justify-between items-start">
            <div>
              <span class="stat-label">Geplante Einnahmen</span>
              <div class="stat-value text-green-500">3.500,00 €</div>
              <span class="stat-meta">Monatlicher Durchschnitt</span>
            </div>
            <div class="stat-icon-wrapper bg-green-500/10 text-green-500">
              <i class="pi pi-arrow-up-right"></i>
            </div>
          </div>
        </template>
      </Card>

      <Card class="stat-card">
        <template #content>
          <div class="flex justify-between items-start">
            <div>
              <span class="stat-label">Geplante Fixkosten</span>
              <div class="stat-value text-red-400">1.250,00 €</div>
              <span class="stat-meta">Verträge, Miete etc.</span>
            </div>
            <div class="stat-icon-wrapper bg-red-500/10 text-red-400">
              <i class="pi pi-arrow-down-right"></i>
            </div>
          </div>
        </template>
      </Card>

      <Card class="stat-card">
        <template #content>
          <div class="flex justify-between items-start">
            <div>
              <span class="stat-label">Freies Budget</span>
              <div class="stat-value text-blue-400">1.400,00 €</div>
              <span class="stat-meta">Für diesen Monat</span>
            </div>
            <div class="stat-icon-wrapper bg-blue-500/10 text-blue-400">
              <i class="pi pi-percentage"></i>
            </div>
          </div>
        </template>
      </Card>

      <Card class="stat-card">
        <template #content>
          <div class="flex justify-between items-start">
            <div>
              <span class="stat-label">Sparziele</span>
              <div class="stat-value text-purple-400">850,00 €</div>
              <span class="stat-meta">Zur Seite gelegt</span>
            </div>
            <div class="stat-icon-wrapper bg-purple-500/10 text-purple-400">
              <i class="pi pi-star"></i>
            </div>
          </div>
        </template>
      </Card>
    </div>

    <!-- Future Milestones Panel -->
    <div class="milestones-card mt-6">
      <Card class="custom-panel">
        <template #title>
          <div class="flex items-center gap-2">
            <i class="pi pi-compass text-primary"></i>
            <span>Nächste Entwicklungsschritte</span>
          </div>
        </template>
        <template #content>
          <p class="mb-4 text-slate-300">
            Das Grundgerüst für die Authentifizierung und die Haushaltserkennung steht. In den kommenden Meilensteinen werden wir folgende Funktionen aktivieren:
          </p>
          <ul class="milestones-list">
            <li>
              <div>
                <strong>Haushalts- & Mitgliederverwaltung:</strong>
                Haushalte erstellen und andere Nutzer per E-Mail in deinen Haushalt einladen.
              </div>
            </li>
            <li>
              <div>
                <strong>Finanzplanung (Budgets & Pläne):</strong>
                Erstellen von Budgets, Sparplänen, Fixkosten und Einnahmenplänen.
              </div>
            </li>
            <li>
              <div>
                <strong>Transaktionen & Anrechnung:</strong>
                Buchung von Einnahmen/Ausgaben und automatische Abrechnung gegenüber Budgets und Sparzielen.
              </div>
            </li>
          </ul>
        </template>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.dashboard-page {
  animation: fadeIn 0.5s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.welcome-title {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.025em;
  margin: 0 0 0.5rem 0;
  background: linear-gradient(to right, #f8fafc, #cbd5e1);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.welcome-subtitle {
  color: #94a3b8;
  margin: 0;
  font-size: 1rem;
  line-height: 1.5;
}

.context-banner {
  background: rgba(30, 41, 59, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 1.25rem 1.5rem;
  backdrop-filter: blur(12px);
}

.icon-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
  border-radius: 12px;
  font-size: 1.25rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1.25rem;
}

.stat-card {
  background: rgba(30, 41, 59, 0.3) !important;
  border: 1px solid rgba(255, 255, 255, 0.06) !important;
  border-radius: 16px !important;
  transition: transform 0.2s, border-color 0.2s;
}

.stat-card:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 255, 255, 0.12) !important;
}

.stat-label {
  font-size: 0.85rem;
  color: #94a3b8;
  display: block;
  margin-bottom: 0.35rem;
}

.stat-value {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.2;
}

.stat-meta {
  font-size: 0.75rem;
  color: #64748b;
  display: block;
  margin-top: 0.25rem;
}

.stat-icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
}

.custom-panel {
  background: rgba(30, 41, 59, 0.3) !important;
  border: 1px solid rgba(255, 255, 255, 0.06) !important;
  border-radius: 16px !important;
  color: #e2e8f0 !important;
}

.milestones-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.milestones-list li {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  line-height: 1.5;
  font-size: 0.95rem;
}

.mb-6 {
  margin-bottom: 1.5rem;
}

.mb-8 {
  margin-bottom: 2rem;
}

.mt-6 {
  margin-top: 1.5rem;
}

.flex {
  display: flex;
}

.items-center {
  align-items: center;
}

.justify-between {
  justify-content: space-between;
}

.flex-wrap {
  flex-wrap: wrap;
}

.gap-3 {
  gap: 0.75rem;
}

.gap-4 {
  gap: 1rem;
}

.mr-1 {
  margin-right: 0.25rem;
}
</style>
