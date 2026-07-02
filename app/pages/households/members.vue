<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

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
const { activeHouseholdId, fetchHouseholds } = useHousehold()

const currentHousehold = ref<HouseholdDetail | null>(null)
const currentLoading = ref(false)
const inviteLoading = ref(false)
const removeLoadingId = ref<string | null>(null)
const cancelInvitationLoadingId = ref<string | null>(null)
const inviteDialogOpen = ref(false)
const message = ref<{ severity: 'success' | 'warn' | 'error'; text: string } | null>(null)

const inviteForm = ref({
  email: '',
  role: 'MEMBER' as 'OWNER' | 'MEMBER',
})

const canManageHousehold = computed(() => {
  const role = currentHousehold.value?.members.find((member) => member.user.id === user.value?.id)?.role
  return role === 'OWNER'
})

const openInviteDialog = () => {
  inviteDialogOpen.value = true
}

const closeInviteDialog = () => {
  inviteDialogOpen.value = false
  inviteForm.value.email = ''
  inviteForm.value.role = 'MEMBER'
}

const confirmDestructiveAction = (title: string, message: string) => {
  if (typeof window === 'undefined') return true
  return window.confirm(`${title}\n\n${message}`)
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
    closeInviteDialog()
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
  if (!confirmDestructiveAction('Mitglied entfernen?', 'Diese Person verliert sofort den Zugriff auf den Haushalt.')) return

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
  if (!confirmDestructiveAction('Einladung löschen?', 'Die eingeladene Person kann diese Einladung danach nicht mehr annehmen.')) return

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
  <ListPageShell
    eyebrow="Meilenstein 3 / Mitglieder"
    title="Mitglieder & Einladungen"
    description="Lade andere Personen per E-Mail in deinen Haushalt ein, entferne Mitglieder oder ziehe offene Einladungen zurück."
  >
    <template #summary>
      <Tag severity="success" :value="`Mitglieder ${currentHousehold?.members.length ?? 0}`" />
      <Tag severity="warning" :value="`Einladungen ${currentHousehold?.invitations.length ?? 0}`" />
    </template>

    <template #toolbar>
      <Button
        v-if="currentHousehold"
        label="Einladen"
        icon="pi pi-user-plus"
        severity="success"
        :disabled="!canManageHousehold"
        @click="openInviteDialog"
      />
    </template>

    <Message v-if="message" :severity="message.severity" variant="simple">
      {{ message.text }}
    </Message>

    <section v-if="currentLoading" class="empty-state">
      <div class="empty-state__card">
        <Kicker>Lädt</Kicker>
        <h2>Mitglieder werden geladen</h2>
        <p>Wir holen den aktiven Haushalt und alle Mitglieder.</p>
      </div>
    </section>

    <section v-else-if="!currentHousehold" class="empty-state">
      <div class="empty-state__card">
        <Kicker>Kein Haushalt aktiv</Kicker>
        <h2>Wähle zuerst einen Haushalt aus</h2>
        <p>Danach kannst du Mitglieder einladen und verwalten.</p>
        <NuxtLink to="/households" class="empty-state__button">Zur Haushaltsübersicht</NuxtLink>
      </div>
    </section>

    <section v-else class="list-panels">
      <article class="list-panel">
        <div class="list-panel__head">
          <div>
            <p class="list-panel__kicker">Mitglieder</p>
            <h2>Mitglieder</h2>
          </div>
          <span class="panel-badge">{{ currentHousehold.members.length }}</span>
        </div>

        <div class="item-list">
          <div v-for="member in currentHousehold.members" :key="member.id" class="item-card">
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
            <div class="item-actions">
              <Tag :value="member.role" :severity="member.role === 'OWNER' ? 'success' : 'info'" />
              <Button
                v-if="canManageHousehold && member.user.id !== user?.id"
                label="Entfernen"
                icon="pi pi-trash"
                severity="danger"
                outlined
                size="small"
                :loading="removeLoadingId === member.id"
                @click="removeMember(member.id)"
              />
            </div>
          </div>

          <div v-if="currentHousehold.members.length === 0" class="empty-list">
            Noch keine Mitglieder vorhanden.
          </div>
        </div>
      </article>

      <article class="list-panel">
        <div class="list-panel__head">
          <div>
            <p class="list-panel__kicker">Offen</p>
            <h2>Offene Einladungen</h2>
          </div>
          <span class="panel-badge">{{ currentHousehold.invitations.length }}</span>
        </div>

        <div class="item-list">
          <div v-for="invitation in currentHousehold.invitations" :key="invitation.id" class="item-card">
            <div>
              <strong>{{ invitation.email }}</strong>
              <div class="subtle">Eingeladen von {{ invitation.invitedBy.displayName || invitation.invitedBy.email }}</div>
            </div>
            <div class="item-actions">
              <Tag :value="invitation.role" :severity="invitation.role === 'OWNER' ? 'success' : 'info'" />
              <Button
                v-if="canManageHousehold"
                label="Löschen"
                icon="pi pi-times"
                severity="secondary"
                outlined
                size="small"
                :loading="cancelInvitationLoadingId === invitation.id"
                @click="cancelInvitation(invitation.id)"
              />
            </div>
          </div>

          <div v-if="currentHousehold.invitations.length === 0" class="empty-list">
            Keine offenen Einladungen.
          </div>
        </div>
      </article>
    </section>

    <Dialog
      v-model:visible="inviteDialogOpen"
      modal
      header="Mitglied einladen"
      :style="{ width: 'min(34rem, 94vw)' }"
      :dismissableMask="true"
      @hide="closeInviteDialog"
    >
      <form class="dialog-form" @submit.prevent="handleInviteMember">
        <div class="field field--wide">
          <label for="household-invite-email">E-Mail</label>
          <InputText
            id="household-invite-email"
            v-model="inviteForm.email"
            type="email"
            placeholder="person@beispiel.de"
            class="w-full"
          />
        </div>
        <div class="field field--wide">
          <label for="household-invite-role">Rolle</label>
          <Select
            id="household-invite-role"
            v-model="inviteForm.role"
            :options="[
              { label: 'Member', value: 'MEMBER' },
              { label: 'Owner', value: 'OWNER' },
            ]"
            optionLabel="label"
            optionValue="value"
            class="w-full"
          />
        </div>

        <div class="dialog-actions">
          <Button type="button" label="Abbrechen" severity="secondary" outlined @click="closeInviteDialog" />
          <Button
            type="submit"
            label="Einladung senden"
            icon="pi pi-send"
            :loading="inviteLoading"
            :disabled="!inviteForm.email.trim()"
          />
        </div>
      </form>
    </Dialog>
  </ListPageShell>
</template>

<style scoped>
.list-panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
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

.panel-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2rem;
  padding: 0.45rem 0.7rem;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.18);
  color: #bfdbfe;
  font-size: 0.84rem;
  font-weight: 700;
}

.item-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.item-card {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  padding: 1rem 1.05rem;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.48);
}

.member-meta {
  display: flex;
  gap: 0.85rem;
  align-items: center;
}

.subtle {
  color: #94a3b8;
  font-size: 0.88rem;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-shrink: 0;
}

.empty-list {
  color: #94a3b8;
  text-align: center;
  padding: 1.2rem 0.75rem;
  border: 1px dashed rgba(148, 163, 184, 0.2);
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.45);
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

.empty-state__button {
  display: inline-flex;
  padding: 0.85rem 1.1rem;
  border-radius: 14px;
  background: linear-gradient(135deg, #2563eb, #60a5fa);
  color: #fff;
  text-decoration: none;
  font-weight: 800;
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

.member-avatar {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.28), rgba(16, 185, 129, 0.24));
  color: white;
  font-weight: 700;
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
  .list-panels {
    grid-template-columns: 1fr;
  }

  .item-card {
    flex-direction: column;
    align-items: flex-start;
  }

  .item-actions {
    width: 100%;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .dialog-actions {
    grid-template-columns: 1fr;
  }
}
</style>