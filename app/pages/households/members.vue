<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({ layout: 'default' })

type HouseholdMember = {
  id: string
  role: 'OWNER' | 'MEMBER'
  createdAt: string
  user: { id: string; email: string; displayName: string | null; oidcSubject: string }
}

type HouseholdInvitation = {
  id: string
  email: string
  role: 'OWNER' | 'MEMBER'
  createdAt: string
  invitedBy: { id: string; email: string; displayName: string | null }
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

const inviteForm = ref({ email: '', role: 'MEMBER' as 'OWNER' | 'MEMBER' })

const canManageHousehold = computed(() => {
  const role = currentHousehold.value?.members.find((member) => member.user.id === user.value?.id)?.role
  return role === 'OWNER'
})

const openInviteDialog = () => { inviteDialogOpen.value = true }
const closeInviteDialog = () => {
  inviteDialogOpen.value = false
  inviteForm.value = { email: '', role: 'MEMBER' }
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
    message.value = { severity: 'error', text: 'Haushalt konnte nicht geladen werden: ' + (error.statusMessage || error.message) }
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
    message.value = { severity: 'success', text: 'Einladung oder Mitgliedschaft wurde angelegt.' }
  } catch (error: any) {
    message.value = { severity: 'error', text: 'Mitglied konnte nicht hinzugefügt werden: ' + (error.statusMessage || error.message) }
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
    await $fetch(`/api/households/${activeHouseholdId.value}/members/${membershipId}`, { method: 'DELETE' })
    await loadCurrentHousehold()
    message.value = { severity: 'success', text: 'Mitglied wurde entfernt.' }
  } catch (error: any) {
    message.value = { severity: 'error', text: 'Mitglied konnte nicht entfernt werden: ' + (error.statusMessage || error.message) }
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
    await $fetch(`/api/households/${activeHouseholdId.value}/invitations/${invitationId}`, { method: 'DELETE' })
    await loadCurrentHousehold()
    message.value = { severity: 'success', text: 'Einladung wurde gelöscht.' }
  } catch (error: any) {
    message.value = { severity: 'error', text: 'Einladung konnte nicht gelöscht werden: ' + (error.statusMessage || error.message) }
  } finally {
    cancelInvitationLoadingId.value = null
  }
}

onMounted(async () => {
  await fetchHouseholds()
  await loadCurrentHousehold()
})
watch(activeHouseholdId, async () => { await loadCurrentHousehold() })
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

    <Message v-if="message" :severity="message.severity" variant="simple">{{ message.text }}</Message>

    <EmptyState
      :loading="currentLoading"
      :no-household="!currentLoading && !currentHousehold"
      loading-title="Mitglieder werden geladen"
    />

    <template v-if="!currentLoading && currentHousehold">
      <ListPanel kicker="Mitglieder" title="Mitglieder" :badge="`${currentHousehold.members.length}`">
        <ItemCard v-for="member in currentHousehold.members" :key="member.id">
          <template #main>
            <div class="member-row">
              <Avatar
                :label="member.user.displayName?.charAt(0)?.toUpperCase() || member.user.email.charAt(0).toUpperCase()"
                shape="circle"
                class="member-avatar"
              />
              <div>
                <strong>{{ member.user.displayName || member.user.email }}</strong>
                <p>{{ member.user.email }}</p>
              </div>
            </div>
          </template>
          <template #actions>
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
          </template>
        </ItemCard>

        <div v-if="currentHousehold.members.length === 0" class="empty-list">Noch keine Mitglieder vorhanden.</div>
      </ListPanel>

      <ListPanel kicker="Offen" title="Offene Einladungen" :badge="`${currentHousehold.invitations.length}`">
        <ItemCard v-for="invitation in currentHousehold.invitations" :key="invitation.id">
          <template #main>
            <strong>{{ invitation.email }}</strong>
            <p>Eingeladen von {{ invitation.invitedBy.displayName || invitation.invitedBy.email }}</p>
          </template>
          <template #actions>
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
          </template>
        </ItemCard>

        <div v-if="currentHousehold.invitations.length === 0" class="empty-list">Keine offenen Einladungen.</div>
      </ListPanel>
    </template>

    <FormDialog
      v-model:visible="inviteDialogOpen"
      header="Mitglied einladen"
      submit-label="Einladung senden"
      :saving="inviteLoading"
      @save="handleInviteMember"
      @cancel="closeInviteDialog"
      width="min(34rem, 94vw)"
    >
      <FormField label="E-Mail" html-for="household-invite-email" wide>
        <InputText id="household-invite-email" v-model="inviteForm.email" type="email" placeholder="person@beispiel.de" />
      </FormField>
      <FormField label="Rolle" html-for="household-invite-role" wide>
        <Select
          id="household-invite-role"
          v-model="inviteForm.role"
          :options="[
            { label: 'Member', value: 'MEMBER' },
            { label: 'Owner', value: 'OWNER' },
          ]"
          optionLabel="label"
          optionValue="value"
        />
      </FormField>
    </FormDialog>
  </ListPageShell>
</template>

<style scoped>
.member-row {
  display: flex;
  gap: 0.85rem;
  align-items: center;
}

.member-avatar {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.28), rgba(16, 185, 129, 0.24));
  color: white;
  font-weight: 700;
}

.empty-list {
  color: #94a3b8;
  text-align: center;
  padding: 1.2rem 0.75rem;
  border: 1px dashed rgba(148, 163, 184, 0.2);
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.45);
}
</style>