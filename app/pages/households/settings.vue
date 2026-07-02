<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

definePageMeta({
  layout: 'default',
})

type HouseholdMember = {
  id: string
  role: 'OWNER' | 'MEMBER'
  user: {
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
  invitations: { id: string }[]
}

const { user } = useAppAuth()
const { activeHouseholdId, fetchHouseholds } = useHousehold()

const currentHousehold = ref<HouseholdDetail | null>(null)
const currentLoading = ref(false)
const saveHouseholdLoading = ref(false)
const editDialogOpen = ref(false)
const message = ref<{ severity: 'success' | 'warn' | 'error'; text: string } | null>(null)

const editForm = ref({
  name: '',
  currency: 'EUR',
})

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
    message.value = {
      severity: 'error',
      text: 'Haushalt konnte nicht geladen werden: ' + (error.statusMessage || error.message),
    }
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
    eyebrow="Meilenstein 3 / Settings"
    title="Haushalt-Einstellungen"
    description="Bearbeite Name und Währung des aktiven Haushalts. Nur Owner können diese Werte ändern — andere Mitglieder sehen sie read-only."
  >
    <template #summary>
      <Tag severity="info" :value="`Mitglieder ${currentHousehold?.members.length ?? 0}`" />
      <Tag severity="secondary" :value="`Rolle ${canManageHousehold ? 'Owner' : 'Member'}`" />
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

    <Message v-if="message" :severity="message.severity" variant="simple">
      {{ message.text }}
    </Message>

    <section v-if="currentLoading" class="empty-state">
      <div class="empty-state__card">
        <Kicker>Lädt</Kicker>
        <h2>Einstellungen werden geladen</h2>
        <p>Wir holen den aktiven Haushalt und seine Stammdaten.</p>
      </div>
    </section>

    <section v-else-if="!currentHousehold" class="empty-state">
      <div class="empty-state__card">
        <Kicker>Kein Haushalt aktiv</Kicker>
        <h2>Wähle zuerst einen Haushalt aus</h2>
        <p>Danach kannst du hier Name und Währung anpassen.</p>
        <NuxtLink to="/households" class="empty-state__button">Zur Haushaltsübersicht</NuxtLink>
      </div>
    </section>

    <article v-else class="settings-panel">
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
        Nur Owner können den Haushalt bearbeiten. Frage einen Owner im Team, falls du etwas ändern möchtest.
      </Message>
    </article>

    <Dialog
      v-model:visible="editDialogOpen"
      modal
      header="Haushalt bearbeiten"
      :style="{ width: 'min(34rem, 94vw)' }"
      :dismissableMask="true"
      @hide="closeEditHouseholdDialog"
    >
      <form class="dialog-form" @submit.prevent="handleSaveHousehold">
        <div class="field field--wide">
          <label for="household-edit-name">Name</label>
          <InputText id="household-edit-name" v-model="editForm.name" class="w-full" :disabled="!canManageHousehold" />
        </div>
        <div class="field field--wide">
          <label for="household-edit-currency">Währung</label>
          <InputText id="household-edit-currency" v-model="editForm.currency" class="w-full" :disabled="!canManageHousehold" />
        </div>

        <div class="dialog-actions">
          <Button type="button" label="Abbrechen" severity="secondary" outlined @click="closeEditHouseholdDialog" />
          <Button type="submit" label="Änderungen speichern" icon="pi pi-check" :loading="saveHouseholdLoading" :disabled="!canManageHousehold" />
        </div>
      </form>
    </Dialog>
  </ListPageShell>
</template>

<style scoped>
.settings-panel {
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

@media (max-width: 720px) {
  .dialog-actions {
    grid-template-columns: 1fr;
  }
}
</style>