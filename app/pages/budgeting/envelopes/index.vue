<!--
  Umschlag-Liste (ADR-0005): eine Ansicht je Gruppe, die Gruppe steht in
  `?group=`, damit Links aus dem Dashboard und der Zurueck-Button passen. Pro
  Umschlag Saldo (gross), Trend und was zum Anwendungsfall gehoert (siehe
  EnvelopeListRow); alles Weitere — Verlauf, Ereignisse, Schliessen, Loeschen —
  liegt auf der Detailseite.

  Owner-only (#128): Anlegen, Bearbeiten und Loeschen nur fuer Owner.
  Umbuchen ist eine Buchung und fuer alle Mitglieder direkt in der Liste
  erreichbar: mobil per Swipe nach links, auf Desktop als kleiner Button in der
  Zeile. Swipe nach rechts bleibt Bearbeiten (#140, nur Owner). Loeschen ist
  aus dem Swipe raus — es scheitert bei jedem Umschlag mit Buchungen ohnehin und
  liegt (mit Begruendung, wenn gesperrt) im Menue der Detailseite.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Notice } from '~/types/planning'
import type { EnvelopeItem } from '~/types/envelope'
import { isFirstRun } from '~/utils/household-age'
import { MOBILE_LIST_QUERY } from '~/composables/useListSwipe'
import { ENVELOPE_GROUPS, isEnvelopeGroup, type EnvelopeGroup } from '~/utils/envelope-options'

definePageMeta({ layout: 'default' })

const { activeHousehold, canManageHousehold, fetchHouseholds } = useHousehold()
// Eigene Swipe-Entscheidung statt useListSwipe: Umbuchen duerfen auch
// MEMBER, deshalb ist Swipe mobil fuer alle an (Bearbeiten nur fuer Owner).
const isMobileList = useMediaQuery(MOBILE_LIST_QUERY)

const envelopes = ref<EnvelopeItem[]>([])
// SSR-Initial-Render: `loading` startet auf true, damit EmptyState sofort
// den Spinner zeigt statt eines leeren Renders bis zur Hydration.
const loading = ref(true)
const notice = ref<Notice | null>(null)
const showClosed = ref(false)
const dialogs = ref<{
  openCreate: (group?: EnvelopeGroup) => void
  openEdit: (envelope: EnvelopeItem) => void
  openTransfer: (envelope: EnvelopeItem) => void
} | null>(null)

const route = useRoute()
const router = useRouter()
const activeGroup = computed<EnvelopeGroup>(() => (isEnvelopeGroup(route.query.group) ? route.query.group : 'RUNNING'))
const groupOptions = ENVELOPE_GROUPS.map((group) => ({ label: group.label, value: group.value }))
const activeGroupInfo = computed(() => ENVELOPE_GROUPS.find((group) => group.value === activeGroup.value)!)
function selectGroup(group: EnvelopeGroup | null) {
  if (group) router.replace({ query: { group } })
}

const householdId = computed(() => activeHousehold.value?.id ?? null)
const currencyCode = computed(() => activeHousehold.value?.currency ?? 'EUR')
const formatMoney = (value: number) => formatMoneyFromCents(value, currencyCode.value)

const envelopesById = computed(() => new Map(envelopes.value.map((envelope) => [envelope.id, envelope] as const)))
const targetName = (envelope: EnvelopeItem) =>
  envelope.carryoverToEnvelopeId ? envelopesById.value.get(envelope.carryoverToEnvelopeId)?.name ?? null : null

// Geschlossen = Stichtag erreicht. Ein Umschlag mit Stichtag in der Zukunft
// laeuft noch und gehoert zu den offenen.
const isClosedNow = (envelope: EnvelopeItem) => !isEnvelopeOpenOn(envelope)
const groupEnvelopes = computed(() => envelopes.value.filter((envelope) => envelope.group === activeGroup.value))
const openEnvelopes = computed(() => groupEnvelopes.value.filter((envelope) => !isClosedNow(envelope)))
// Geschlossene ans Ende und standardmaessig eingeklappt: Ihr Saldo lebt im
// Ziel weiter, sie sind nur noch Historie.
const closedEnvelopes = computed(() => groupEnvelopes.value.filter(isClosedNow))

const totalBalance = computed(() =>
  openEnvelopes.value.reduce((sum, envelope) => sum + envelope.balance.balance, 0),
)

// Empty-State (issue #13): First-Time fuer neue Haushalte, No-Data sonst.
const showFirstTimeEmpty = computed(() => envelopes.value.length === 0 && isFirstRun(activeHousehold.value))

async function loadEnvelopes() {
  if (!householdId.value) {
    envelopes.value = []
    loading.value = false
    return
  }
  loading.value = true
  try {
    const data = await $fetch<{ envelopes: EnvelopeItem[] }>(`/api/households/${householdId.value}/envelopes`)
    envelopes.value = sortEnvelopes(data.envelopes)
  } catch (error: any) {
    notice.value = { severity: 'error', text: 'Umschläge konnten nicht geladen werden: ' + (error.statusMessage || error.message) }
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await fetchHouseholds()
  await loadEnvelopes()
  // Dashboard "Sparziel anlegen" verlinkt mit ?new=1 hierher.
  if (route.query.new === '1' && canManageHousehold.value) {
    dialogs.value?.openCreate(activeGroup.value)
    router.replace({ query: { group: activeGroup.value } })
  }
})
watch(householdId, loadEnvelopes)

function openTransfer(envelope: EnvelopeItem) {
  dialogs.value?.openTransfer(envelope)
}
</script>

<template>
  <ListPageShell title="Umschläge">
    <template v-if="openEnvelopes.length > 0" #summary>
      <Tag :severity="totalBalance < 0 ? 'danger' : 'success'" :value="`Saldo gesamt ${formatMoney(totalBalance)}`" />
    </template>
    <template #toolbar>
      <!-- Issue #99: ein Anlegen-Affordance pro Seite — im First-Time-
           EmptyState hat die CTA dort Vorrang. -->
      <Button
        v-if="canManageHousehold && !showFirstTimeEmpty && !loading"
        label="Umschlag anlegen"
        icon="pi pi-plus"
        severity="success"
        @click="dialogs?.openCreate(activeGroup)"
      />
    </template>

    <div class="group-switch">
      <SelectButton
        :model-value="activeGroup"
        :options="groupOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        aria-label="Gruppe der Umschläge"
        @update:model-value="selectGroup"
      />
    </div>
    <p class="group-hint">{{ activeGroupInfo.hint }}</p>

    <Message v-if="notice" :severity="notice.severity" variant="simple">
      {{ notice.text }}
    </Message>

    <!-- OWNER-only Erklaerung (issue #128). -->
    <Message v-if="activeHousehold && !canManageHousehold" severity="warn" variant="simple">
      Nur Owner können Umschläge anlegen, bearbeiten, schließen und löschen. Umbuchen geht für alle Mitglieder – direkt in der Liste (auf dem Handy nach links wischen) oder auf der Detailseite.
    </Message>

    <EmptyState
      :loading="loading"
      :no-household="!loading && !activeHousehold"
      loading-title="Umschläge werden geladen"
      loading-text="Wir holen die Umschläge und ihre Salden."
    />

    <EmptyState
      v-if="!loading && activeHousehold && showFirstTimeEmpty"
      variant="first-time"
      icon="pi pi-chart-line"
      icon-tone="accent"
      headline="Noch keine Umschläge"
      :description="canManageHousehold
        ? 'Lege deinen ersten Umschlag an, um dein Geld aufzuteilen — z. B. Lebensmittel, Miete, Freizeit.'
        : 'Ein Owner des Haushalts kann Umschläge anlegen, um das Geld aufzuteilen.'"
      :cta="canManageHousehold
        ? { label: 'Umschlag anlegen', onClick: () => dialogs?.openCreate(activeGroup), severity: 'primary' }
        : undefined"
    />
    <EmptyState
      v-else-if="!loading && activeHousehold && groupEnvelopes.length === 0"
      variant="no-data"
      icon="pi pi-chart-line"
      icon-tone="muted"
      :headline="`Keine Umschläge in „${activeGroupInfo.label}“`"
      :description="canManageHousehold
        ? 'Lege einen Umschlag an, um dein Geld aufzuteilen.'
        : 'Ein Owner des Haushalts kann einen Umschlag anlegen.'"
    />

    <ListPanel
      v-if="!loading && activeHousehold && openEnvelopes.length > 0"
      variant="primary"
      compact
      :badge="`${openEnvelopes.length} aktiv`"
    >
      <ul class="envelope-list">
        <li v-for="envelope in openEnvelopes" :key="envelope.id">
          <SwipeableListItem
            :disabled="!isMobileList"
            swipe-right-icon="pi pi-pen-to-square"
            :swipe-right-label="canManageHousehold ? 'Bearbeiten' : undefined"
            swipe-left-icon="pi pi-arrow-right-arrow-left"
            swipe-left-label="Umbuchen"
            swipe-left-severity="warning"
            @swipe-right="dialogs?.openEdit(envelope)"
            @swipe-left="openTransfer(envelope)"
          >
            <EnvelopeListRow :envelope="envelope" :format-money="formatMoney" :target-name="targetName(envelope)">
              <template #actions>
                <Button
                  v-if="!isMobileList"
                  icon="pi pi-arrow-right-arrow-left"
                  text
                  rounded
                  size="small"
                  severity="secondary"
                  class="row-transfer"
                  :aria-label="`${envelope.name} umbuchen`"
                  title="Umbuchen"
                  @click.stop.prevent="openTransfer(envelope)"
                />
              </template>
            </EnvelopeListRow>
          </SwipeableListItem>
        </li>
      </ul>
    </ListPanel>

    <!-- ADR-0005: Fixkosten-Plaene liegen bei den Umschlaegen, deren Zuteilung
         sie bestimmen. Aus ihnen entsteht auch die Buchung. Bewusst nicht an
         `loading` gekoppelt: Das Neuladen nach einer Buchung wuerde das Panel
         samt Erfolgsmeldung abbauen. -->
    <RecurringPlansPanel v-if="activeHousehold && activeGroup === 'FIXED'" kind="fixedCost" @changed="loadEnvelopes" />

    <section v-if="!loading && closedEnvelopes.length > 0" class="closed-section">
      <button
        type="button"
        class="closed-section__toggle"
        :aria-expanded="showClosed"
        @click="showClosed = !showClosed"
      >
        <i class="pi" :class="showClosed ? 'pi-chevron-down' : 'pi-chevron-right'" aria-hidden="true" />
        Geschlossene Umschläge ({{ closedEnvelopes.length }})
      </button>
      <ul v-if="showClosed" class="envelope-list">
        <li v-for="envelope in closedEnvelopes" :key="envelope.id">
          <EnvelopeListRow :envelope="envelope" :format-money="formatMoney" :target-name="targetName(envelope)" />
        </li>
      </ul>
    </section>

    <EnvelopeActionDialogs
      v-if="householdId"
      ref="dialogs"
      :household-id="householdId"
      :envelopes="envelopes"
      :currency="currencyCode"
      @changed="loadEnvelopes"
      @notice="notice = $event"
    />
  </ListPageShell>
</template>

<style scoped>
/* Fuenf Gruppen passen mobil nicht nebeneinander: seitlich scrollen statt umbrechen. */
.group-switch {
  overflow-x: auto;
  margin-bottom: 0.25rem;
}

.group-switch :deep(.p-selectbutton) {
  flex-wrap: nowrap;
  white-space: nowrap;
}

.group-hint {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.envelope-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.row-transfer {
  flex-shrink: 0;
  min-width: var(--touch-target-min);
  min-height: var(--touch-target-min);
}


.closed-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.closed-section__toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  align-self: flex-start;
  padding: 0.35rem 0.2rem;
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.closed-section__toggle .pi {
  font-size: 0.7rem;
}

.closed-section__toggle:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}
</style>
