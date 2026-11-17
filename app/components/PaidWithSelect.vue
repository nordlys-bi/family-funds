<!--
  PaidWithSelect — Feld "Bezahlt mit" (ADR-0006, issue #190).

  Mit Kontobindung des Umschlags zeigt es nur die gebundenen Konten und
  darunter "Anderes Konto…"; ein Klick darauf oeffnet dieselbe Liste mit allen
  Konten (Bargeld auf dem Wochenmarkt fuer einen ans Girokonto gebundenen
  Umschlag). Ohne Bindung alle Konten des Tages.

  `auto-default`: Solange niemand selbst gewaehlt hat, folgt der Wert der
  Vorauswahl (Hauptkonto bzw. Standardkonto) — auch wenn Umschlag oder Datum
  wechseln. Beim Bearbeiten einer Buchung aus, dort bleibt ihr Konto.

  <PaidWithSelect v-model="form.accountId" :accounts="accounts" :date="form.date"
    :binding="binding" :member-default-id="memberDefaultId" auto-default input-id="x" />
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  accountTypeIcon,
  defaultPaidWith,
  OTHER_ACCOUNT,
  paidWithOptions,
  type AccountBinding,
  type AccountType,
  type PaidWithAccount,
} from '~/utils/account-options'

const props = defineProps<{
  modelValue: string | null
  accounts: PaidWithAccount[]
  date: string | Date | null
  binding?: AccountBinding | null
  memberDefaultId?: string | null
  autoDefault?: boolean
  inputId?: string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

const showAll = ref(false)
const touched = ref(false)
const select = ref<{ show?: (isFocus?: boolean) => void } | null>(null)
// PrimeVue-Select haelt den angeklickten Wert intern, auch wenn v-model ihn
// nicht uebernimmt; "Anderes Konto…" stuende sonst als leere Auswahl da. Ein
// neuer Key baut es mit dem echten Wert neu auf.
const selectKey = ref(0)

const options = computed(() =>
  paidWithOptions({ accounts: props.accounts, date: props.date, binding: props.binding, showAll: showAll.value, selectedId: props.modelValue }),
)
// Vor dem Start der Konten (alte Belege vor dem Stichtag) gibt es nichts zu
// waehlen; der Server nimmt die Buchung dort ohne Konto an.
const noAccountThatDay = computed(() => options.value.length === 0)

// Anderer Umschlag = andere Bindung: wieder mit der kurzen Liste beginnen.
watch(() => props.binding, () => { showAll.value = false })

watch(
  () => [props.binding, props.date, props.accounts, props.memberDefaultId] as const,
  () => {
    if (!props.autoDefault || touched.value) return
    const next = defaultPaidWith({ accounts: props.accounts, date: props.date, binding: props.binding, memberDefaultId: props.memberDefaultId })
    if (next !== props.modelValue) emit('update:modelValue', next)
  },
  { immediate: true },
)

// Ein Konto, das es am neuen Datum nicht gibt, nicht still behalten.
watch(noAccountThatDay, (none) => {
  if (none && props.modelValue) emit('update:modelValue', null)
})

async function onChange(value: string | null) {
  if (value === OTHER_ACCOUNT) {
    showAll.value = true
    selectKey.value += 1
    await nextTick()
    select.value?.show?.(true)
    return
  }
  touched.value = true
  emit('update:modelValue', value)
}

function iconOf(type: AccountType | undefined) {
  return type ? accountTypeIcon(type) : 'pi pi-ellipsis-h'
}
</script>

<template>
  <Select
    :key="selectKey"
    ref="select"
    :input-id="inputId"
    :model-value="modelValue"
    :options="options"
    option-label="label"
    option-value="value"
    :placeholder="noAccountThatDay ? 'Vor den Konten – ohne Konto' : 'Konto wählen'"
    :disabled="disabled || noAccountThatDay"
    fluid
    @update:model-value="onChange"
  >
    <template #option="{ option }">
      <span class="paid-with-option" :class="{ 'paid-with-option--other': option.value === OTHER_ACCOUNT }">
        <i :class="iconOf(option.type)" aria-hidden="true" />
        <span>{{ option.label }}</span>
      </span>
    </template>
  </Select>
</template>

<style scoped>
.paid-with-option {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.paid-with-option i {
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.paid-with-option--other {
  color: var(--color-text-muted);
}
</style>
