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
const saveHouseholdLoading = ref(false)
const inviteLoading = ref(false)
const removeLoadingId = ref<string | null>(null)
const cancelInvitationLoadingId = ref<string | null>(null)
const message = ref<{ severity: 'success' | 'warn' | 'error'; text: string } | null>(null)

const createForm = ref({
  name: '',
  currency: 'EUR',
})

const editForm = ref({
  name: '',
  currency: 'EUR',
})

const inviteForm = ref({
  email: '',
  role: 'MEMBER' as 'OWNER' | 'MEMBER',
})

const activeHouseholdId = computed(() => activeHousehold.value?.id ?? null)
const canManageHousehold = computed(() => {
  const role = currentHousehold.value?.members.find((member) => member.user.id === user.value?.id)?.role
  return role === 'OWNER'
})

const syncEditForm = () => {
  if (!currentHousehold.value) return
  editForm.value.name = currentHousehold.value.name
  editForm.value.currency = currentHousehold.value.currency
}

const loadCurrentHousehold = async () => {
  currentLoading.value = true
  try {
    const data = await $fetch<{ household: HouseholdDetail | null }>('/api/households/current')
    currentHousehold.value = data.household
    syncEditForm()
  } catch (error: any) {
    message.value = {
      severity: 'error',
      text: 'Haushalt konnte nicht geladen werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    currentLoading.value = false
  }
}

const refreshAll = async () => {
  await fetchHouseholds()
  await loadCurrentHousehold()
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
    createForm.value.name = ''
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

const handleSaveHousehold = async () => {
  if (!currentHousehold.value) return

  saveHouseholdLoading.value = true
  message.value = null
  try {
    await $fetch(`/api/households/${currentHousehold.value.id}`, {
      method: 'PATCH',
      body: editForm.value,
    })

    await refreshAll()
    message.value = {
      severity: 'success',
      text: 'Haushalt wurde aktualisiert.',
    }
  } catch (error: any) {
    message.value = {
      severity: 'error',
      text: 'Haushalt konnte nicht gespeichert werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    saveHouseholdLoading.value = false
  }
}

const handleInviteMember = async () => {
  if (!activeHouseholdId.value) return

  inviteLoading.value = true
  message.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/members`, {
      method: 'POST',
      body: inviteForm.value,
    })

    await loadCurrentHousehold()
    inviteForm.value.email = ''
    inviteForm.value.role = 'MEMBER'
    message.value = {
      severity: 'success',
      text: 'Einladung oder Mitgliedschaft wurde angelegt.',
    }
  } catch (error: any) {
    message.value = {
      severity: 'error',
      text: 'Mitglied konnte nicht hinzugefügt werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    inviteLoading.value = false
  }
}

const removeMember = async (membershipId: string) => {
  if (!activeHouseholdId.value) return

  removeLoadingId.value = membershipId
  message.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/members/${membershipId}`, {
      method: 'DELETE',
    })

    await loadCurrentHousehold()
    message.value = {
      severity: 'success',
      text: 'Mitglied wurde entfernt.',
    }
  } catch (error: any) {
    message.value = {
      severity: 'error',
      text: 'Mitglied konnte nicht entfernt werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    removeLoadingId.value = null
  }
}

const cancelInvitation = async (invitationId: string) => {
  if (!activeHouseholdId.value) return

  cancelInvitationLoadingId.value = invitationId
  message.value = null
  try {
    await $fetch(`/api/households/${activeHouseholdId.value}/invitations/${invitationId}`, {
      method: 'DELETE',
    })

    await loadCurrentHousehold()
    message.value = {
      severity: 'success',
      text: 'Einladung wurde gelöscht.',
    }
  } catch (error: any) {
    message.value = {
      severity: 'error',
      text: 'Einladung konnte nicht gelöscht werden: ' + (error.statusMessage || error.message),
    }
  } finally {
    cancelInvitationLoadingId.value = null
  }
}

onMounted(async () => {
  await fetchHouseholds()
  await loadCurrentHousehold()
})

watch(activeHouseholdId, async () => {
  await loadCurrentHousehold()
})
</script>

<template>
  <div class="households-page">
    <section class="hero-panel">
      <div class="hero-copy">
        <p class="eyebrow">Meilenstein 3</p>
        <h1>Haushalts- & Mitgliederverwaltung</h1>
        <p class="page-intro">
          Erstelle Haushalte, passe sie an und verwalte Mitglieder sowie Einladungen direkt im System.
        </p>
      </div>

      <div class="hero-stats">
        <div class="stat-chip">
          <span class="stat-label">Haushalte</span>
          <strong>{{ households.length }}</strong>
        </div>
        <div class="stat-chip stat-chip--accent">
          <span class="stat-label">Aktiver Haushalt</span>
          <strong>{{ activeHousehold?.name || 'Keiner' }}</strong>
        </div>
      </div>
    </section>

    <Message v-if="message" :severity="message.severity" variant="simple" class="mb-4">
      {{ message.text }}
    </Message>

    <div class="panel-grid">
      <section class="panel panel-primary panel-accent">
        <div class="panel-header">
          <div>
            <p class="panel-kicker">Haushalt anlegen</p>
            <h2>Neuen Haushalt erstellen</h2>
          </div>
          <Tag value="Owner" severity="success" rounded />
        </div>

        <div class="panel-body">
          <div class="form-grid">
            <label class="field">
              <span>Name</span>
              <InputText v-model="createForm.name" placeholder="z. B. Gemeinsamer Haushalt" class="w-full" />
            </label>
            <label class="field">
              <span>Währung</span>
              <InputText v-model="createForm.currency" placeholder="EUR" class="w-full" />
            </label>
          </div>

          <div class="panel-actions">
            <small class="helper-text">Ein neuer Haushalt startet immer mit dir als Owner.</small>
            <Button
              label="Haushalt erstellen"
              icon="pi pi-plus"
              severity="success"
              :loading="createHouseholdLoading"
              :disabled="!createForm.name.trim()"
              @click="handleCreateHousehold"
            />
          </div>
        </div>
      </section>

      <section class="panel panel-primary panel-strong">
        <div class="panel-header">
          <div>
            <p class="panel-kicker">Aktiv</p>
            <h2>Aktiver Haushalt</h2>
          </div>
          <Tag v-if="currentHousehold" :value="currentHousehold.id.slice(0, 8)" severity="secondary" rounded />
        </div>

        <div class="panel-body">
          <div v-if="currentLoading || householdsLoading" class="loading-block">
            <ProgressSpinner style="width: 42px; height: 42px" strokeWidth="4" />
          </div>

          <div v-else-if="currentHousehold" class="stack">
            <div class="form-grid">
              <label class="field">
                <span>Name</span>
                <InputText v-model="editForm.name" class="w-full" :disabled="!canManageHousehold" />
              </label>
              <label class="field">
                <span>Währung</span>
                <InputText v-model="editForm.currency" class="w-full" :disabled="!canManageHousehold" />
              </label>
            </div>

            <div class="meta-row">
              <div class="meta-pill">
                <span>Mitglieder</span>
                <strong>{{ currentHousehold.members.length }}</strong>
              </div>
              <div class="meta-pill">
                <span>Einladungen</span>
                <strong>{{ currentHousehold.invitations.length }}</strong>
              </div>
            </div>

            <Message v-if="canManageHousehold" severity="info" variant="simple">
              Änderungen werden für alle Mitglieder des Haushalts sichtbar.
            </Message>

            <div class="panel-actions">
              <span class="helper-text" v-if="!canManageHousehold">Nur Owner können diesen Haushalt bearbeiten.</span>
              <Button
                v-if="canManageHousehold"
                label="Änderungen speichern"
                icon="pi pi-save"
                severity="success"
                :loading="saveHouseholdLoading"
                @click="handleSaveHousehold"
              />
            </div>
          </div>

          <Message v-else severity="warn" variant="simple">
            Es ist aktuell kein Haushalt ausgewählt.
          </Message>
        </div>
      </section>
    </div>

    <section class="panel panel-wide panel-muted">
      <div class="panel-header">
        <div>
          <p class="panel-kicker">Zugang</p>
          <h2>Mitglieder einladen</h2>
        </div>
        <Tag value="Clerk-ready" severity="info" rounded />
      </div>

      <div class="panel-body">
        <div v-if="!currentHousehold" class="empty-state">
          Wähle zuerst einen Haushalt aus, dann kannst du Mitglieder einladen.
        </div>

        <div v-else class="stack">
          <div class="form-grid">
            <label class="field">
              <span>E-Mail</span>
              <InputText v-model="inviteForm.email" type="email" placeholder="person@beispiel.de" class="w-full" :disabled="!canManageHousehold" />
            </label>
            <label class="field">
              <span>Rolle</span>
              <Select
                v-model="inviteForm.role"
                :options="[
                  { label: 'Member', value: 'MEMBER' },
                  { label: 'Owner', value: 'OWNER' },
                ]"
                optionLabel="label"
                optionValue="value"
                class="w-full"
                :disabled="!canManageHousehold"
              />
            </label>
          </div>

          <div class="panel-actions">
            <small class="helper-text">Eingeladene Personen werden beim nächsten Clerk-Login automatisch übernommen.</small>
            <Button
              label="Einladung senden"
              icon="pi pi-send"
              severity="success"
              :loading="inviteLoading"
              :disabled="!inviteForm.email.trim() || !canManageHousehold"
              @click="handleInviteMember"
            />
          </div>
        </div>
      </div>
    </section>

    <div class="panel-grid">
      <section class="panel panel-secondary">
        <div class="panel-header">
          <div>
            <p class="panel-kicker">Mitglieder</p>
            <h2>Mitglieder</h2>
          </div>
          <Tag :value="String(currentHousehold?.members?.length || 0)" severity="secondary" rounded />
        </div>

        <div class="panel-body">
          <div v-if="currentHousehold?.members?.length" class="table-list">
            <div v-for="member in currentHousehold.members" :key="member.id" class="list-row">
              <div class="member-meta">
                <Avatar
                  :label="member.user.displayName?.charAt(0)?.toUpperCase() || member.user.email.charAt(0).toUpperCase()"
                  shape="circle"
                  class="member-avatar"
                />
                <div>
                  <strong>{{ member.user.displayName || member.user.email }}</strong>
                  <div class="subtle">{{ member.user.email }}</div>
                </div>
              </div>
              <div class="member-actions">
                <Tag
                  :value="member.role"
                  :severity="member.role === 'OWNER' ? 'success' : 'info'"
                  rounded
                />
                <Button
                  v-if="canManageHousehold && member.user.id !== user?.id"
                  icon="pi pi-trash"
                  severity="danger"
                  outlined
                  size="small"
                  :loading="removeLoadingId === member.id"
                  @click="removeMember(member.id)"
                />
              </div>
            </div>
          </div>
          <div v-else class="empty-state">
            Noch keine Mitglieder vorhanden.
          </div>
        </div>
      </section>

      <section class="panel panel-secondary">
        <div class="panel-header">
          <div>
            <p class="panel-kicker">Offen</p>
            <h2>Offene Einladungen</h2>
          </div>
          <Tag :value="String(currentHousehold?.invitations?.length || 0)" severity="secondary" rounded />
        </div>

        <div class="panel-body">
          <div v-if="currentHousehold?.invitations?.length" class="table-list">
            <div v-for="invitation in currentHousehold.invitations" :key="invitation.id" class="list-row">
              <div>
                <strong>{{ invitation.email }}</strong>
                <div class="subtle">Eingeladen von {{ invitation.invitedBy.displayName || invitation.invitedBy.email }}</div>
              </div>
              <div class="member-actions">
                <Tag
                  :value="invitation.role"
                  :severity="invitation.role === 'OWNER' ? 'success' : 'info'"
                  rounded
                />
                <Button
                  v-if="canManageHousehold"
                  icon="pi pi-times"
                  severity="secondary"
                  outlined
                  size="small"
                  :loading="cancelInvitationLoadingId === invitation.id"
                  @click="cancelInvitation(invitation.id)"
                />
              </div>
            </div>
          </div>
          <div v-else class="empty-state">
            Keine offenen Einladungen.
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.households-page {
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
  padding-bottom: 1rem;
}

.hero-panel {
  display: flex;
  justify-content: space-between;
  gap: 1.25rem;
  align-items: stretch;
  flex-wrap: wrap;
  padding: 1.5rem 1.6rem;
  border-radius: 1.8rem;
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.16), transparent 36%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.72));
  border: 1px solid rgba(148, 163, 184, 0.13);
  box-shadow: 0 22px 54px rgba(2, 6, 23, 0.28);
}

.hero-copy {
  flex: 1 1 42rem;
}

.hero-stats {
  display: flex;
  gap: 0.8rem;
  flex-wrap: wrap;
  align-content: flex-start;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--p-primary-500);
  font-size: 0.78rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
}

h1 {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05;
}

.page-intro {
  max-width: 60ch;
  color: rgb(148 163 184);
  margin: 0.75rem 0 0;
  font-size: 1.02rem;
  line-height: 1.58;
}

.stat-chip {
  min-width: 180px;
  padding: 0.95rem 1rem;
  border-radius: 1.1rem;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
}

.stat-label {
  display: block;
  font-size: 0.8rem;
  color: rgb(148 163 184);
  margin-bottom: 0.35rem;
}

.stat-chip strong {
  display: block;
  font-size: 1.02rem;
  line-height: 1.3;
}

.stat-chip--accent {
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.18), rgba(15, 23, 42, 0.52));
  border-color: rgba(96, 165, 250, 0.22);
}

.panel-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  border-radius: 1.5rem;
  padding: 1.25rem;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.82), rgba(15, 23, 42, 0.64));
  border: 1px solid rgba(148, 163, 184, 0.12);
  box-shadow: 0 18px 40px rgba(2, 6, 23, 0.26);
  backdrop-filter: blur(16px);
}

.panel-wide {
  grid-column: 1 / -1;
}

.panel-primary {
  min-height: 100%;
}

.panel-strong {
  background:
    radial-gradient(circle at top right, rgba(16, 185, 129, 0.12), transparent 34%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.86), rgba(15, 23, 42, 0.68));
}

.panel-accent {
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.14), transparent 34%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.84), rgba(15, 23, 42, 0.65));
}

.panel-muted {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.78), rgba(15, 23, 42, 0.6));
}

.panel-secondary {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.76), rgba(15, 23, 42, 0.6));
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  flex-wrap: wrap;
}

.panel-header h2 {
  margin: 0.18rem 0 0;
  font-size: 1.35rem;
  letter-spacing: -0.02em;
}

.panel-kicker {
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgb(148 163 184);
  font-size: 0.72rem;
  font-weight: 700;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.92rem;
}

.field span {
  color: rgb(226 232 240);
  font-weight: 600;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.meta-row {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.meta-pill {
  min-width: 130px;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.85rem 0.95rem;
  border-radius: 1rem;
  background: rgba(15, 23, 42, 0.45);
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.meta-pill span {
  color: rgb(148 163 184);
  font-size: 0.8rem;
}

.meta-pill strong {
  font-size: 1.15rem;
}

.loading-block,
.empty-state {
  display: grid;
  place-items: center;
  min-height: 160px;
  color: rgb(148 163 184);
  text-align: center;
  padding: 1rem 0.5rem;
}

.table-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.list-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  padding: 1rem 1.05rem;
  border-radius: 1rem;
  background: rgba(15, 23, 42, 0.48);
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.member-meta {
  display: flex;
  gap: 0.85rem;
  align-items: center;
}

.subtle {
  color: rgb(148 163 184);
  font-size: 0.88rem;
}

.member-actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.panel-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  padding-top: 0.1rem;
}

.helper-text {
  color: rgb(148 163 184);
  font-size: 0.88rem;
}

.member-avatar {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.28), rgba(16, 185, 129, 0.24));
  color: white;
  font-weight: 700;
}

@media (max-width: 900px) {
  .hero-panel {
    padding: 1.2rem;
  }

  .panel-grid,
  .form-grid {
    grid-template-columns: 1fr;
  }

  .list-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .member-actions {
    width: 100%;
    justify-content: space-between;
  }

  .panel-actions {
    align-items: flex-start;
  }
}
</style>
