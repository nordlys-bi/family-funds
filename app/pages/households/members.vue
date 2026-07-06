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

/**
 * Pending state für den ConfirmDialog. Statt window.confirm() wird ein eigener
 * Dialog gezeigt (ConfirmDialog.vue). Eine laufende Aktion hängt als Promise
 * an `pendingConfirm.resolve` — Bestätigen löst true aus, Abbrechen false.
 */
const pendingConfirm = ref<{
  title: string
  message: string
  tone: 'primary' | 'danger'
  resolve: (ok: boolean) => void
} | null>(null)
const confirmOpen = computed(() => pendingConfirm.value !== null)

function askConfirm(opts: {
  title: string
  message: string
  tone?: 'primary' | 'danger'
}): Promise<boolean> {
  return new Promise((resolve) => {
    pendingConfirm.value = {
      title: opts.title,
      message: opts.message,
      tone: opts.tone ?? 'danger',
      resolve,
    }
  })
}

function handleConfirmOk() {
  pendingConfirm.value?.resolve(true)
  pendingConfirm.value = null
}

function handleConfirmCancel() {
  pendingConfirm.value?.resolve(false)
  pendingConfirm.value = null
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
  const ok = await askConfirm({
    title: 'Mitglied entfernen?',
    message: 'Diese Person verliert sofort den Zugriff auf den Haushalt.',
    tone: 'danger',
  })
  if (!ok) return
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
  const ok = await askConfirm({
    title: 'Einladung löschen?',
    message: 'Die eingeladene Person kann diese Einladung danach nicht mehr annehmen.',
    tone: 'danger',
  })
  if (!ok) return
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

const formatMemberSince = (createdAt: string) =>
  new Intl.DateTimeFormat('de-DE', { month: 'short', year: 'numeric' }).format(new Date(createdAt))

const memberInitials = (member: HouseholdMember) => {
  const source = member.user.displayName || member.user.email
  return source.charAt(0).toUpperCase()
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
      <ListPanel kicker="Mitglieder" title="Aktive Mitglieder" compact :badge="`${currentHousehold.members.length}`">
        <ListTable dense accent="primary">
          <template #head>
            <th>Name</th>
            <th class="muted">E-Mail</th>
            <th>Rolle</th>
            <th class="muted">Dabei seit</th>
            <th class="actions"></th>
          </template>

          <tr v-for="member in currentHousehold.members" :key="member.id">
            <td class="name">
              <span class="member-cell">
                <Avatar :label="memberInitials(member)" shape="circle" class="member-avatar" />
                <span>{{ member.user.displayName || member.user.email }}</span>
              </span>
            </td>
            <td class="muted">{{ member.user.email }}</td>
            <td>
              <RoleTag :role="member.role" />
            </td>
            <td class="muted">{{ formatMemberSince(member.createdAt) }}</td>
            <td class="actions">
              <Button
                v-if="canManageHousehold && member.user.id !== user?.id"
                icon="pi pi-trash"
                severity="danger"
                outlined
                size="small"
                text
                :loading="removeLoadingId === member.id"
                @click="removeMember(member.id)"
              />
            </td>
          </tr>

          <tr v-if="currentHousehold.members.length === 0">
            <td colspan="5" class="data-table__empty">Noch keine Mitglieder vorhanden.</td>
          </tr>

          <!-- Mobile (< 768px): Cards statt Tabelle. Rolle-Tag voll sichtbar. -->
          <template #mobile>
            <div v-if="currentHousehold.members.length === 0" class="data-table__empty">
              Noch keine Mitglieder vorhanden.
            </div>
            <div
              v-for="member in currentHousehold.members"
              v-else
              :key="`m-${member.id}`"
              class="data-table__card"
            >
              <div class="data-table__card-line">
                <span class="data-table__card-name" style="display: inline-flex; align-items: center; gap: 10px;">
                  <Avatar :label="memberInitials(member)" shape="circle" class="member-avatar" />
                  {{ member.user.displayName || member.user.email }}
                </span>
                <RoleTag :role="member.role" />
              </div>
              <div class="data-table__card-meta">
                <span>{{ member.user.email }}</span>
                <span>·</span>
                <span>Dabei seit {{ formatMemberSince(member.createdAt) }}</span>
              </div>
              <div v-if="canManageHousehold && member.user.id !== user?.id" class="data-table__card-actions">
                <Button
                  icon="pi pi-trash"
                  severity="danger"
                  outlined
                  size="small"
                  text
                  :loading="removeLoadingId === member.id"
                  @click="removeMember(member.id)"
                />
              </div>
            </div>
          </template>
        </ListTable>
      </ListPanel>

      <ListPanel kicker="Offen" title="Offene Einladungen" compact :badge="`${currentHousehold.invitations.length}`">
        <ListTable dense>
          <template #head>
            <th>E-Mail</th>
            <th>Rolle</th>
            <th class="muted">Eingeladen von</th>
            <th class="actions"></th>
          </template>

          <tr v-for="invitation in currentHousehold.invitations" :key="invitation.id">
            <td class="name">{{ invitation.email }}</td>
            <td>
              <RoleTag :role="invitation.role" />
            </td>
            <td class="muted">{{ invitation.invitedBy.displayName || invitation.invitedBy.email }}</td>
            <td class="actions">
              <Button
                v-if="canManageHousehold"
                icon="pi pi-times"
                severity="secondary"
                outlined
                size="small"
                text
                :loading="cancelInvitationLoadingId === invitation.id"
                @click="cancelInvitation(invitation.id)"
              />
            </td>
          </tr>

          <tr v-if="currentHousehold.invitations.length === 0">
            <td colspan="4" class="data-table__empty">Keine offenen Einladungen.</td>
          </tr>

          <!-- Mobile: Cards für offene Einladungen. -->
          <template #mobile>
            <div v-if="currentHousehold.invitations.length === 0" class="data-table__empty">
              Keine offenen Einladungen.
            </div>
            <div
              v-for="invitation in currentHousehold.invitations"
              v-else
              :key="`m-inv-${invitation.id}`"
              class="data-table__card"
            >
              <div class="data-table__card-line">
                <span class="data-table__card-name">{{ invitation.email }}</span>
                <RoleTag :role="invitation.role" />
              </div>
              <div class="data-table__card-meta">
                <span>Eingeladen von {{ invitation.invitedBy.displayName || invitation.invitedBy.email }}</span>
              </div>
              <div v-if="canManageHousehold" class="data-table__card-actions">
                <Button
                  icon="pi pi-times"
                  severity="secondary"
                  outlined
                  size="small"
                  text
                  :loading="cancelInvitationLoadingId === invitation.id"
                  @click="cancelInvitation(invitation.id)"
                />
              </div>
            </div>
          </template>
        </ListTable>
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
      <FormFieldRow label="E-Mail" html-for="household-invite-email" wide>
        <InputText id="household-invite-email" v-model="inviteForm.email" type="email" placeholder="person@beispiel.de" />
      </FormFieldRow>
      <FormFieldRow label="Rolle" html-for="household-invite-role" wide>
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
      </FormFieldRow>
    </FormDialog>

    <ConfirmDialog
      v-if="pendingConfirm"
      :visible="confirmOpen"
      :title="pendingConfirm.title"
      :message="pendingConfirm.message"
      :tone="pendingConfirm.tone"
      @confirm="handleConfirmOk"
      @cancel="handleConfirmCancel"
      @update:visible="(v) => { if (!v) handleConfirmCancel() }"
    />
  </ListPageShell>
</template>

<style scoped>
.member-cell {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.member-avatar {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.28), rgba(16, 185, 129, 0.24));
  color: white;
  font-weight: 700;
  width: 28px;
  height: 28px;
  font-size: 0.78rem;
}
</style>