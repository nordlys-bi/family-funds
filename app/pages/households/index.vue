<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { HouseholdInfo } from '~/composables/useHousehold'

definePageMeta({
  layout: 'default',
})

type HouseholdMember = {
  id: string
  role: 'OWNER' | 'MEMBER'
  createdAt: string
  user: {
    id: string
    email: string
    displayName: string | null
    oidcSubject: string
  }
}

type HouseholdInvitation = {
  id: string
  email: string
  role: 'OWNER' | 'MEMBER'
  createdAt: string
  invitedBy: {
    id: string
    email: string
    displayName: string | null
  }
}

type HouseholdDetail = {
  id: string
  name: string
  currency: string
  members: HouseholdMember[]
  invitations: HouseholdInvitation[]
}

const { user } = useAppAuth()
const { households, activeHousehold, loading: householdsLoading, fetchHouseholds, setActiveHousehold } = useHousehold()

const currentHousehold = ref<HouseholdDetail | null>(null)
const currentLoading = ref(false)
const createHouseholdLoading = ref(false)
const createDialogOpen = ref(false)
const message = ref<{ severity: 'success' | 'warn' | 'error'; text: string } | null>(null)

const createForm = ref({
  name: '',
  currency: 'EUR',
})

const activeHouseholdId = computed(() => activeHousehold.value?.id ?? null)
const canManageHousehold = computed(() => {
  const role = currentHousehold.value?.members.find((member) => member.user.id === user.value?.id)?.role
  return role === 'OWNER'
})

const openCreateHouseholdDialog = () => {
  createForm.value.name = ''
  createForm.value.currency = 'EUR'
  createDialogOpen.value = true
}

const closeCreateHouseholdDialog = () => {
  createDialogOpen.value = false
  createForm.value.name = ''
  createForm.value.currency = 'EUR'
}

const loadCurrentHousehold = async () => {
  currentLoading.value = true
  try {
    const data = await $fetch<{ household: HouseholdDetail | null }>('/api/households/current')
    currentHousehold.value = data.household
  } catch (error: any) {
    message.value = {
      severity: 'error',
      text: 'Haushalt konnte nicht geladen werden: ' + (error.statusMessage || error.message),
    }
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
    message.value = {
      severity: 'success',
      text: 'Haushalt wurde erstellt.',
    }
  } catch (error: any) {
    message.value = {
      severity: 'error',
      text: 'Haushalt konnte nicht erstellt werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    createHouseholdLoading.value = false
  }
}

useDesktopShortcut('n', () => {
  if (!createDialogOpen.value) {
    openCreateHouseholdDialog()
  }
})

onMounted(async () => {
  await fetchHouseholds()
  await loadCurrentHousehold()
})

watch(activeHouseholdId, async () => {
  await loadCurrentHousehold()
})
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
      <div class="toolbar-note">
        <span class="toolbar-note__label">Neu</span>
        <Tag value="N" severity="secondary" rounded />
      </div>
      <div class="toolbar-actions">
        <Button
          label="Neuer Haushalt"
          icon="pi pi-plus"
          severity="success"
          @click="openCreateHouseholdDialog"
        />
        <NuxtLink to="/households/members" class="toolbar-link">
          <Button label="Mitglieder" icon="pi pi-users" severity="secondary" outlined />
        </NuxtLink>
        <NuxtLink to="/households/settings" class="toolbar-link">
          <Button label="Settings" icon="pi pi-cog" severity="secondary" outlined :disabled="!currentHousehold" />
        </NuxtLink>
      </div>
    </template>

    <Message v-if="message" :severity="message.severity" variant="simple">
      {{ message.text }}
    </Message>

    <section v-if="currentLoading || householdsLoading" class="empty-state">
      <div class="empty-state__card">
        <Kicker>Lädt</Kicker>
        <h2>Haushaltsdaten werden geladen</h2>
        <p>Wir holen den aktiven Haushalt und seine Eckdaten.</p>
        <ProgressSpinner style="width: 42px; height: 42px" strokeWidth="4" />
      </div>
    </section>

    <section v-else-if="!currentHousehold" class="empty-state">
      <div class="empty-state__card">
        <Kicker>Kein Haushalt aktiv</Kicker>
        <h2>Erstelle oder wähle zuerst einen Haushalt aus</h2>
        <p>Danach kannst du Mitglieder einladen und Settings anpassen.</p>
        <Button label="Neuen Haushalt erstellen" icon="pi pi-plus" @click="openCreateHouseholdDialog" />
      </div>
    </section>

    <section v-else class="household-overview">
      <article class="list-panel">
        <div class="list-panel__head">
          <div>
            <p class="list-panel__kicker">Aktiv</p>
            <h2>{{ currentHousehold.name }}</h2>
            <p class="list-panel__description">Währung: {{ currentHousehold.currency }}</p>
          </div>
          <Tag :value="currentHousehold.id.slice(0, 8)" severity="secondary" rounded />
        </div>

        <div class="detail-strip">
          <NuxtLink to="/households/members" class="detail-card">
            <span>Mitglieder</span>
            <strong>{{ currentHousehold.members.length }}</strong>
          </NuxtLink>
          <NuxtLink to="/households/members" class="detail-card">
            <span>Einladungen</span>
            <strong>{{ currentHousehold.invitations.length }}</strong>
          </NuxtLink>
          <div class="detail-card detail-card--accent">
            <span>Rolle</span>
            <strong>{{ canManageHousehold ? 'Owner' : 'Member' }}</strong>
          </div>
        </div>

        <Message v-if="canManageHousehold" severity="info" variant="simple">
          Änderungen an diesem Haushalt gelten für alle Mitglieder sofort.
        </Message>
      </article>
    </section>

    <Dialog
      v-model:visible="createDialogOpen"
      modal
      header="Neuen Haushalt erstellen"
      :style="{ width: 'min(34rem, 94vw)' }"
      :dismissableMask="true"
      @hide="closeCreateHouseholdDialog"
    >
      <form class="dialog-form" @submit.prevent="handleCreateHousehold">
        <div class="field field--wide">
          <label for="household-create-name">Name</label>
          <InputText id="household-create-name" v-model="createForm.name" placeholder="z. B. Gemeinsamer Haushalt" class="w-full" />
        </div>
        <div class="field field--wide">
          <label for="household-create-currency">Währung</label>
          <InputText id="household-create-currency" v-model="createForm.currency" placeholder="EUR" class="w-full" />
        </div>

        <div class="dialog-actions">
          <Button type="button" label="Abbrechen" severity="secondary" outlined @click="closeCreateHouseholdDialog" />
          <Button type="submit" label="Haushalt erstellen" icon="pi pi-check" :loading="createHouseholdLoading" :disabled="!createForm.name.trim()" />
        </div>
      </form>
    </Dialog>
  </ListPageShell>
</template>

<style scoped>
.household-overview {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.toolbar-note {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: #cbd5e1;
}

.toolbar-note__label {
  font-size: 0.85rem;
  color: #94a3b8;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.toolbar-link {
  text-decoration: none;
}

.list-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
  border-radius: 24px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.88), rgba(15, 23, 42, 0.66));
  box-shadow: 0 18px 40px rgba(2, 6, 23, 0.22);
}

.list-panel__head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  flex-wrap: wrap;
}

.list-panel__kicker {
  margin: 0 0 0.25rem;
  color: #94a3b8;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.list-panel__head h2 {
  margin: 0;
  font-size: 1.35rem;
  letter-spacing: -0.02em;
}

.list-panel__description {
  margin: 0.3rem 0 0;
  color: #94a3b8;
}

.detail-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.detail-card {
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

.detail-card:hover {
  border-color: rgba(96, 165, 250, 0.4);
  background: rgba(15, 23, 42, 0.6);
}

.detail-card span {
  color: #94a3b8;
  font-size: 0.82rem;
}

.detail-card strong {
  font-size: 1.1rem;
}

.detail-card--accent {
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.16), rgba(15, 23, 42, 0.48));
}

.empty-state {
  display: grid;
  place-items: center;
  min-height: 260px;
  text-align: center;
}

.empty-state__card {
  max-width: 32rem;
  padding: 1.2rem 1rem;
}

.empty-state__card h2 {
  margin: 0;
  font-size: 1.4rem;
}

.empty-state__card p {
  margin: 0.65rem 0 1rem;
  color: #94a3b8;
}

.dialog-form {
  display: grid;
  gap: 0.95rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.field label {
  color: #e2e8f0;
  font-size: 0.88rem;
  font-weight: 700;
}

.field--wide {
  grid-column: 1 / -1;
}

.dialog-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 0.25rem;
}

:deep(.p-inputtext),
:deep(.p-select),
:deep(.p-datepicker-input),
:deep(.p-inputnumber-input) {
  width: 100%;
}

:deep(.p-select),
:deep(.p-datepicker),
:deep(.p-inputnumber) {
  width: 100%;
}

:deep(.p-button) {
  border-radius: 14px;
}

@media (max-width: 1120px) {
  .detail-strip {
    grid-template-columns: 1fr;
  }

  .toolbar-actions {
    width: 100%;
  }

  .dialog-actions {
    grid-template-columns: 1fr;
  }
}
</style>