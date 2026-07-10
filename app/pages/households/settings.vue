<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({ layout: 'default' })

type HouseholdMember = {
  id: string
  role: 'OWNER' | 'MEMBER'
  user: { id: string; email: string; displayName: string | null }
}

type HouseholdDetail = {
  id: string
  name: string
  currency: string
  members: HouseholdMember[]
  invitations: { id: string }[]
}

const { user } = useAppAuth()
const { activeHouseholdId, fetchHouseholds } = useHousehold()
const onboarding = useOnboarding()

const currentHousehold = ref<HouseholdDetail | null>(null)
const currentLoading = ref(false)
const saveHouseholdLoading = ref(false)
const editDialogOpen = ref(false)
const message = ref<{ severity: 'success' | 'warn' | 'error'; text: string } | null>(null)

const editForm = ref({ name: '', currency: 'EUR' })

const canManageHousehold = computed(() => {
  const role = currentHousehold.value?.members.find((member) => member.user.id === user.value?.id)?.role
  return role === 'OWNER'
})

const syncEditForm = () => {
  if (!currentHousehold.value) return
  editForm.value.name = currentHousehold.value.name
  editForm.value.currency = currentHousehold.value.currency
}

const openEditHouseholdDialog = () => {
  if (!currentHousehold.value) return
  syncEditForm()
  editDialogOpen.value = true
}
const closeEditHouseholdDialog = () => {
  editDialogOpen.value = false
  syncEditForm()
}

const loadCurrentHousehold = async () => {
  currentLoading.value = true
  try {
    const data = await $fetch<{ household: HouseholdDetail | null }>('/api/households/current')
    currentHousehold.value = data.household
    syncEditForm()
  } catch (error: any) {
    message.value = { severity: 'error', text: 'Haushalt konnte nicht geladen werden: ' + (error.statusMessage || error.message) }
  } finally {
    currentLoading.value = false
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
    await fetchHouseholds()
    await loadCurrentHousehold()
    closeEditHouseholdDialog()
    message.value = { severity: 'success', text: 'Haushalt wurde aktualisiert.' }
  } catch (error: any) {
    message.value = { severity: 'error', text: 'Haushalt konnte nicht gespeichert werden: ' + (error.statusMessage || error.message) }
  } finally {
    saveHouseholdLoading.value = false
  }
}

onMounted(async () => {
  await fetchHouseholds()
  await loadCurrentHousehold()
})
watch(activeHouseholdId, async () => { await loadCurrentHousehold() })

// === Onboarding-Tour wiederholen (issue #16) =========================
// User koennen die Tour jederzeit erneut starten — Reset von skipped-
// Flag + completedSteps, dann Modal im Layout wird sichtbar.
const restartOnboarding = async () => {
  await onboarding.restartTour()
  message.value = { severity: 'success', text: 'Onboarding-Tour wird erneut gestartet.' }
}
</script>

<template>
  <ListPageShell
    title="Haushalt-Einstellungen"
    description="Bearbeite Name und Währung des aktiven Haushalts. Nur Owner können diese Werte ändern."
  >
    <template #summary>
      <Tag severity="info" :value="`Mitglieder ${currentHousehold?.members.length ?? 0}`" />
      <Tag severity="secondary" :value="`Rolle ${roleLabel(canManageHousehold ? 'OWNER' : 'MEMBER')}`" />
    </template>

    <template #toolbar>
      <Button
        v-if="currentHousehold"
        label="Bearbeiten"
        icon="pi pi-pen-to-square"
        severity="success"
        :disabled="!canManageHousehold"
        @click="openEditHouseholdDialog"
      />
    </template>

    <Message v-if="message" :severity="message.severity" variant="simple">{{ message.text }}</Message>

    <EmptyState
      :loading="currentLoading"
      :no-household="!currentLoading && !currentHousehold"
      loading-title="Einstellungen werden geladen"
      no-household-title="Wähle zuerst einen Haushalt aus"
      no-household-text="Danach kannst du hier Name und Währung anpassen."
    />

    <article v-if="!currentLoading && currentHousehold" class="settings-card">
      <div class="settings-row">
        <span class="settings-label">Name</span>
        <span class="settings-value">{{ currentHousehold.name }}</span>
      </div>
      <div class="settings-row">
        <span class="settings-label">Währung</span>
        <span class="settings-value">{{ currentHousehold.currency }}</span>
      </div>
      <div class="settings-row">
        <span class="settings-label">ID</span>
        <span class="settings-value settings-value--mono">{{ currentHousehold.id.slice(0, 8) }}</span>
      </div>

      <Message v-if="canManageHousehold" severity="info" variant="simple">
        Änderungen an diesem Haushalt gelten für alle Mitglieder sofort.
      </Message>
      <Message v-else severity="warn" variant="simple">
        Nur Owner können den Haushalt bearbeiten.
      </Message>
    </article>

    <article v-if="!currentLoading && currentHousehold" class="settings-card settings-card--help">
      <h3 class="settings-help-title">Hilfe</h3>
      <p class="settings-help-text">
        Du kannst die 4-Schritte-Onboarding-Tour jederzeit erneut durchlaufen, um
        die wichtigsten Funktionen von Family Funds kennenzulernen.
      </p>
      <Button
        label="Onboarding-Tour wiederholen"
        icon="pi pi-replay"
        severity="secondary"
        outlined
        size="small"
        @click="restartOnboarding"
      />
    </article>

    <FormDialog
      v-model:visible="editDialogOpen"
      header="Haushalt bearbeiten"
      submit-label="Änderungen speichern"
      :saving="saveHouseholdLoading"
      @save="handleSaveHousehold"
      @cancel="closeEditHouseholdDialog"
      width="min(34rem, 94vw)"
    >
      <FormFieldRow label="Name" html-for="household-edit-name" wide>
        <InputText id="household-edit-name" v-model="editForm.name" :disabled="!canManageHousehold" />
      </FormFieldRow>
      <FormFieldRow label="Währung" html-for="household-edit-currency" wide>
        <InputText id="household-edit-currency" v-model="editForm.currency" :disabled="!canManageHousehold" />
      </FormFieldRow>
    </FormDialog>
  </ListPageShell>
</template>

<style scoped>
.settings-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  border-radius: 24px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.88), rgba(15, 23, 42, 0.66));
  box-shadow: 0 18px 40px rgba(2, 6, 23, 0.22);
}

.settings-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  padding: 0.85rem 1rem;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.4);
  border: 1px solid rgba(148, 163, 184, 0.1);
}

.settings-label {
  color: #94a3b8;
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.settings-value {
  color: #f8fafc;
  font-size: 1rem;
  font-weight: 600;
}

.settings-value--mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  font-size: 0.92rem;
  color: #cbd5e1;
}

.settings-card--help {
  margin-top: 1rem;
}

.settings-help-title {
  margin: 0 0 0.5rem;
  font-size: 1rem;
  font-weight: 700;
  color: #f1f5f9;
}

.settings-help-text {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  color: #94a3b8;
  line-height: 1.5;
}
</style>