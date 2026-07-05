<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { HouseholdInfo } from '~/composables/useHousehold'

definePageMeta({ layout: 'default' })

type HouseholdMember = {
  id: string
  role: 'OWNER' | 'MEMBER'
  user: { id: string; email: string; displayName: string | null; oidcSubject: string }
}

type HouseholdDetail = {
  id: string
  name: string
  currency: string
  members: HouseholdMember[]
  invitations: { id: string }[]
}

const { user } = useAppAuth()
const { households, activeHousehold, loading: householdsLoading, fetchHouseholds, setActiveHousehold } = useHousehold()

const currentHousehold = ref<HouseholdDetail | null>(null)
const currentLoading = ref(false)
const createHouseholdLoading = ref(false)
const createDialogOpen = ref(false)
const message = ref<{ severity: 'success' | 'warn' | 'error'; text: string } | null>(null)

const createForm = ref({ name: '', currency: 'EUR' })

const activeHouseholdId = computed(() => activeHousehold.value?.id ?? null)
const canManageHousehold = computed(() => {
  const role = currentHousehold.value?.members.find((member) => member.user.id === user.value?.id)?.role
  return role === 'OWNER'
})

const openCreateHouseholdDialog = () => {
  createForm.value = { name: '', currency: 'EUR' }
  createDialogOpen.value = true
}
const closeCreateHouseholdDialog = () => {
  createDialogOpen.value = false
  createForm.value = { name: '', currency: 'EUR' }
}

const loadCurrentHousehold = async () => {
  currentLoading.value = true
  try {
    const data = await $fetch<{ household: HouseholdDetail | null }>('/api/households/current')
    currentHousehold.value = data.household
  } catch (error: any) {
    message.value = { severity: 'error', text: 'Haushalt konnte nicht geladen werden: ' + (error.statusMessage || error.message) }
  } finally {
    currentLoading.value = false
  }
}

const handleCreateHousehold = async () => {
  createHouseholdLoading.value = true
  message.value = null
  try {
    const data = await $fetch<{ household: HouseholdInfo }>('/api/households', {
      method: 'POST',
      body: createForm.value,
    })
    await fetchHouseholds()
    if (data.household?.id) {
      setActiveHousehold(data.household.id)
    }
    await loadCurrentHousehold()
    closeCreateHouseholdDialog()
    message.value = { severity: 'success', text: 'Haushalt wurde erstellt.' }
  } catch (error: any) {
    message.value = { severity: 'error', text: 'Haushalt konnte nicht erstellt werden: ' + (error.statusMessage || error.message) }
  } finally {
    createHouseholdLoading.value = false
  }
}

useDesktopShortcut('n', () => {
  if (!createDialogOpen.value) openCreateHouseholdDialog()
})

onMounted(async () => {
  await fetchHouseholds()
  await loadCurrentHousehold()
})
watch(activeHouseholdId, async () => { await loadCurrentHousehold() })
</script>

<template>
  <ListPageShell
    eyebrow="Meilenstein 3"
    title="Haushalts- & Mitgliederverwaltung"
    description="Übersicht über deinen aktiven Haushalt. Mitglieder und Einladungen verwaltest du unter Mitglieder; Name und Währung unter Settings."
  >
    <template #summary>
      <Tag severity="info" :value="`Haushalte ${households.length}`" />
      <Tag severity="success" :value="`Mitglieder ${currentHousehold?.members.length ?? 0}`" />
      <Tag severity="warning" :value="`Einladungen ${currentHousehold?.invitations.length ?? 0}`" />
      <Tag severity="secondary" :value="`Aktiv ${activeHousehold?.name ?? 'Keiner'}`" />
    </template>

    <template #toolbar>
      <Button label="Neuer Haushalt" icon="pi pi-plus" severity="success" @click="openCreateHouseholdDialog" />
      <NuxtLink to="/households/members">
        <Button label="Mitglieder" icon="pi pi-users" severity="secondary" outlined />
      </NuxtLink>
      <NuxtLink to="/households/settings">
        <Button label="Settings" icon="pi pi-cog" severity="secondary" outlined :disabled="!currentHousehold" />
      </NuxtLink>
    </template>

    <Message v-if="message" :severity="message.severity" variant="simple">{{ message.text }}</Message>

    <section v-if="currentLoading || householdsLoading" class="loading-state">
      <div class="loading-state__card">
        <Kicker>Lädt</Kicker>
        <h2>Haushaltsdaten werden geladen</h2>
        <ProgressSpinner style="width: 42px; height: 42px" strokeWidth="4" />
      </div>
    </section>

    <section v-if="!currentLoading && !householdsLoading && !currentHousehold" class="empty-state-empty">
      <div class="empty-card">
        <Kicker>Kein Haushalt aktiv</Kicker>
        <h2>Erstelle oder wähle zuerst einen Haushalt aus</h2>
        <p>Danach kannst du Mitglieder einladen und Settings anpassen.</p>
        <Button label="Neuen Haushalt erstellen" icon="pi pi-plus" @click="openCreateHouseholdDialog" />
      </div>
    </section>

    <article v-else class="overview-card">
      <div class="overview-card__head">
        <div>
          <Kicker>Aktiv</Kicker>
          <h2>{{ currentHousehold.name }}</h2>
          <p class="overview-card__description">Währung: {{ currentHousehold.currency }}</p>
        </div>
        <Tag :value="currentHousehold.id.slice(0, 8)" severity="secondary" rounded />
      </div>

      <div class="overview-card__strip">
        <NuxtLink to="/households/members" class="overview-tile">
          <span>Mitglieder</span>
          <strong>{{ currentHousehold.members.length }}</strong>
        </NuxtLink>
        <NuxtLink to="/households/members" class="overview-tile">
          <span>Einladungen</span>
          <strong>{{ currentHousehold.invitations.length }}</strong>
        </NuxtLink>
        <div class="overview-tile overview-tile--accent">
          <span>Rolle</span>
          <strong>{{ canManageHousehold ? 'Owner' : 'Member' }}</strong>
        </div>
      </div>

      <Message v-if="canManageHousehold" severity="info" variant="simple">
        Änderungen an diesem Haushalt gelten für alle Mitglieder sofort.
      </Message>
    </article>

    <FormDialog
      v-model:visible="createDialogOpen"
      header="Neuen Haushalt erstellen"
      submit-label="Haushalt erstellen"
      :saving="createHouseholdLoading"
      @save="handleCreateHousehold"
      @cancel="closeCreateHouseholdDialog"
      width="min(34rem, 94vw)"
    >
      <FormField label="Name" html-for="household-create-name" wide>
        <InputText id="household-create-name" v-model="createForm.name" placeholder="z. B. Gemeinsamer Haushalt" />
      </FormField>
      <FormField label="Währung" html-for="household-create-currency" wide>
        <InputText id="household-create-currency" v-model="createForm.currency" placeholder="EUR" />
      </FormField>
    </FormDialog>
  </ListPageShell>
</template>

<style scoped>
.overview-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
  border-radius: 24px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.88), rgba(15, 23, 42, 0.66));
  box-shadow: 0 18px 40px rgba(2, 6, 23, 0.22);
}

.overview-card__head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  flex-wrap: wrap;
}

.overview-card__head h2 {
  margin: 0;
  font-size: 1.35rem;
  letter-spacing: -0.02em;
}

.overview-card__description {
  margin: 0.3rem 0 0;
  color: #94a3b8;
}

.overview-card__strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.overview-tile {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.9rem 1rem;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(15, 23, 42, 0.44);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.overview-tile:hover {
  border-color: rgba(96, 165, 250, 0.4);
  background: rgba(15, 23, 42, 0.6);
}

.overview-tile span {
  color: #94a3b8;
  font-size: 0.82rem;
}

.overview-tile strong {
  font-size: 1.1rem;
}

.overview-tile--accent {
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.16), rgba(15, 23, 42, 0.48));
}

.loading-state {
  display: grid;
  place-items: center;
  min-height: 260px;
  text-align: center;
}

.loading-state__card {
  max-width: 32rem;
  padding: 1.2rem 1rem;
}

.empty-state-empty {
  display: grid;
  place-items: center;
  min-height: 260px;
  text-align: center;
}

.empty-card {
  max-width: 32rem;
  padding: 1.2rem 1rem;
}

.empty-card h2 {
  margin: 0;
  font-size: 1.4rem;
}

.empty-card p {
  margin: 0.65rem 0 1rem;
  color: #94a3b8;
}

@media (max-width: 639px) {
  .overview-card__strip {
    grid-template-columns: 1fr;
  }
}
</style>