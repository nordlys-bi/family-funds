<!--
  AccountFormDialog — Konto anlegen oder bearbeiten (ADR-0006, #189).

  Herausgeloest aus der Konten-Seite (#198): Anlegen bleibt dort, Bearbeiten
  und Schliessen sind auf die Kontoseite gewandert. Mit `account` bearbeitet
  der Dialog, ohne legt er an. Nach dem Speichern `saved` mit einer Meldung.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ACCOUNT_TYPES, accountErrorText, type AccountType } from '~/utils/account-options'

type EditableAccount = {
  id: string
  name: string
  type: AccountType
  openingBalance: number
  startDate: string
  closedAt: string | null
}

const props = defineProps<{
  visible: boolean
  householdId: string
  currency: string
  /** Zu bearbeitendes Konto; ohne = anlegen. */
  account?: EditableAccount | null
  /** Fruehester Start eines neuen Kontos (Start von "Zu verteilen"). */
  minStartDate?: Date
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: [message: string]
}>()

type AccountForm = { name: string; type: AccountType; balance: number | null; startDate: Date; closed: boolean; closedAt: Date }

const typeOptions = ACCOUNT_TYPES.map(({ value, label }) => ({ value, label }))
const today = () => {
  const value = new Date()
  value.setHours(12, 0, 0, 0)
  return value
}

const saving = ref(false)
const error = ref<string | null>(null)
const form = ref<AccountForm>({ name: '', type: 'CASH', balance: null, startDate: today(), closed: false, closedAt: today() })
const editing = computed(() => props.account ?? null)

/** Schliessen geht fruehestens am Tag nach dem Start (Stichtag exklusiv). */
const minCloseDate = computed(() => {
  if (!editing.value) return undefined
  const value = new Date(editing.value.startDate)
  value.setDate(value.getDate() + 1)
  value.setHours(12, 0, 0, 0)
  return value
})

// Bei jedem Oeffnen frisch befuellen.
watch(
  () => props.visible,
  (open) => {
    if (!open) return
    error.value = null
    const account = editing.value
    form.value = account
      ? {
          name: account.name,
          type: account.type,
          balance: account.openingBalance / 100,
          startDate: new Date(account.startDate),
          closed: account.closedAt !== null,
          closedAt: account.closedAt ? new Date(account.closedAt) : today(),
        }
      : { name: '', type: 'CASH', balance: null, startDate: today(), closed: false, closedAt: today() }
    if (minCloseDate.value && form.value.closedAt < minCloseDate.value) form.value.closedAt = minCloseDate.value
  },
  { immediate: true },
)

async function save() {
  saving.value = true
  error.value = null
  const base = `/api/households/${props.householdId}/accounts`
  try {
    if (editing.value) {
      await $fetch(`${base}/${editing.value.id}`, {
        method: 'PATCH',
        body: {
          name: form.value.name,
          type: form.value.type,
          openingBalance: form.value.balance ?? 0,
          closedAt: form.value.closed ? formatDateToInputString(form.value.closedAt) : null,
        },
      })
    } else {
      await $fetch(base, {
        method: 'POST',
        body: {
          name: form.value.name,
          type: form.value.type,
          openingBalance: form.value.balance ?? 0,
          startDate: formatDateToInputString(form.value.startDate),
        },
      })
    }
    emit('update:visible', false)
    emit('saved', editing.value ? 'Konto wurde gespeichert.' : 'Konto wurde angelegt.')
  } catch (caught: any) {
    error.value = accountErrorText(caught)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <FormDialog
    :visible="visible"
    :header="editing ? 'Konto bearbeiten' : 'Konto anlegen'"
    :submit-label="editing ? 'Speichern' : 'Anlegen'"
    :saving="saving"
    width="min(34rem, 94vw)"
    @update:visible="(value: boolean) => emit('update:visible', value)"
    @save="save"
    @cancel="emit('update:visible', false)"
  >
    <FormFieldRow label="Name" html-for="account-name" wide>
      <InputText id="account-name" v-model="form.name" placeholder="z. B. Sparschwein" />
    </FormFieldRow>
    <FormFieldRow label="Art" html-for="account-type" wide>
      <Select id="account-type" v-model="form.type" :options="typeOptions" option-label="label" option-value="value" />
    </FormFieldRow>
    <FormFieldRow :label="editing ? 'Anfangsbestand' : 'Stand zu Beginn'" html-for="account-balance">
      <MoneyInput id="account-balance" v-model="form.balance" :currency="currency" />
      <small class="account-form-hint">
        <template v-if="editing">Eine Korrektur verschiebt „Zu verteilen“ um denselben Betrag.</template>
        <template v-else>Dieses Geld kommt zu „Zu verteilen“ hinzu.</template>
      </small>
    </FormFieldRow>
    <FormFieldRow v-if="!editing" label="Seit" html-for="account-start">
      <DatePicker
        id="account-start"
        v-model="form.startDate"
        show-icon
        date-format="dd.mm.yy"
        :max-date="today()"
        :min-date="minStartDate"
      />
    </FormFieldRow>
    <template v-if="editing">
      <FormFieldRow label="Geschlossen" html-for="account-closed" wide>
        <ToggleSwitch input-id="account-closed" v-model="form.closed" />
      </FormFieldRow>
      <FormFieldRow v-if="form.closed" label="Ab" html-for="account-closed-at">
        <DatePicker id="account-closed-at" v-model="form.closedAt" show-icon date-format="dd.mm.yy" :min-date="minCloseDate" />
        <small class="account-form-hint">Ab diesem Tag nimmt das Konto keine Buchungen mehr an.</small>
      </FormFieldRow>
    </template>
    <Message v-if="error" severity="error" variant="simple">{{ error }}</Message>
  </FormDialog>
</template>

<style scoped>
.account-form-hint {
  display: block;
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: 0.8rem;
  line-height: 1.5;
}
</style>
